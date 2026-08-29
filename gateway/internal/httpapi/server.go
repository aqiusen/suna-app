package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/alanchenchen/suna-app/gateway/internal/bridge"
	"github.com/alanchenchen/suna-app/gateway/internal/runtime"
)

type RuntimeProber interface {
	Probe(context.Context) (runtime.HelloResult, error)
}

type Server struct {
	prober       RuntimeProber
	probeTimeout time.Duration
	bridge       *bridge.Service

	// allowRemote 为真时监听非 loopback 地址（远程模式），CSRF 校验从"仅 loopback
	// 同源"放宽为"任意同源"——浏览器仍无法跨站调用，但可信边界从本机扩展到
	// 监听网段（局域网 / Tailscale 虚拟网）。
	allowRemote bool
	// onShutdown 由进程入口注入；仅 loopback 的 POST /api/v1/shutdown 会触发。
	onShutdown func()
	// desktopToken 只给本机 WebView 桌面壳使用：Wails 页面的 origin 与
	// loopback Gateway 不同，必须靠随机 token 放行，不能扩大普通浏览器 CSRF 边界。
	desktopToken string

	probeMu       sync.Mutex
	lastProbe     probeResult
	probeInFlight *probeFlight
}

type probeResult struct {
	hello runtime.HelloResult
	err   error
	at    time.Time
}

type probeFlight struct {
	done   chan struct{}
	result probeResult
}

const probeCacheTTL = 2 * time.Second

const modelDiscoveryErrorBodyLimit = 512

var knownModelCompatSuffixes = []string{
	"/api/claudecode",
	"/api/anthropic",
	"/apps/anthropic",
	"/api/coding",
	"/claudecode",
	"/anthropic",
	"/step_plan",
	"/coding",
	"/claude",
}

// NewServer serves status routes. Supplying a bridge service additionally enables
// browser Runtime bridge routes while preserving the original construction API.
func NewServer(prober RuntimeProber, probeTimeout time.Duration, services ...*bridge.Service) http.Handler {
	var service *bridge.Service
	if len(services) != 0 {
		service = services[0]
	}
	return newServer(prober, probeTimeout, service, false, "", nil)
}

// NewServerWithBridge makes the browser bridge dependency explicit for callers
// that create a public runtime.ConnectionManager. allowRemote 为可选变参：
// 传 true 表示监听非 loopback 地址（远程模式，见 Server.allowRemote 注释）。
func NewServerWithBridge(prober RuntimeProber, probeTimeout time.Duration, service *bridge.Service, allowRemote ...bool) http.Handler {
	remote := len(allowRemote) > 0 && allowRemote[0]
	return newServer(prober, probeTimeout, service, remote, "", nil)
}

// NewServerWithLifecycle 与 NewServerWithBridge 相同，并注册本机退出回调。
func NewServerWithLifecycle(prober RuntimeProber, probeTimeout time.Duration, service *bridge.Service, allowRemote bool, onShutdown func()) http.Handler {
	return newServer(prober, probeTimeout, service, allowRemote, "", onShutdown)
}

// NewServerWithLifecycleAndDesktopToken 与 NewServerWithLifecycle 相同，但允许
// 本机桌面 WebView 用随机 token 跨 origin 访问 loopback Gateway。
func NewServerWithLifecycleAndDesktopToken(prober RuntimeProber, probeTimeout time.Duration, service *bridge.Service, allowRemote bool, desktopToken string, onShutdown func()) http.Handler {
	return newServer(prober, probeTimeout, service, allowRemote, desktopToken, onShutdown)
}

func newServer(prober RuntimeProber, probeTimeout time.Duration, service *bridge.Service, allowRemote bool, desktopToken string, onShutdown func()) http.Handler {
	s := &Server{prober: prober, probeTimeout: probeTimeout, bridge: service, allowRemote: allowRemote, desktopToken: strings.TrimSpace(desktopToken), onShutdown: onShutdown}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.health)
	mux.HandleFunc("GET /api/v1/runtime/status", s.runtimeStatus)
	mux.HandleFunc("POST /api/v1/models/discover", s.discoverModels)
	mux.HandleFunc("POST /api/v1/shutdown", s.handleShutdown)
	if service != nil {
		mux.HandleFunc("POST /api/v1/bridge/connect", s.bridgeConnect)
		mux.HandleFunc("POST /api/v1/bridge/{id}/rpc", s.bridgeRPC)
		mux.HandleFunc("GET /api/v1/bridge/{id}/events", s.bridgeEvents)
		mux.HandleFunc("DELETE /api/v1/bridge/{id}", s.bridgeDisconnect)
	}
	return s.securityHeaders(mux)
}

func (s *Server) discoverModels(w http.ResponseWriter, r *http.Request) {
	if !s.sameOriginUnsafe(r) {
		bridgeError(w, http.StatusForbidden, "origin_denied", "Request origin is not allowed.")
		return
	}
	var request struct {
		BaseURL   string `json:"base_url"`
		APIKey    string `json:"api_key"`
		Protocol  string `json:"protocol"`
		AuthMode  string `json:"auth_mode"`
		FullURL   bool   `json:"full_url"`
		ModelsURL string `json:"models_url"`
	}
	if err := decodeLimitedJSON(w, r, 32<<10, &request); err != nil {
		bridgeError(w, http.StatusBadRequest, "invalid_request", "Request must be a valid JSON object.")
		return
	}
	if strings.TrimSpace(request.APIKey) == "" {
		bridgeError(w, http.StatusBadRequest, "api_key_required", "请先填写 API Key 再拉取模型列表。已保存的 Key 不会回显，也不能直接拿来发这次测试请求。")
		return
	}
	endpoints, err := modelListEndpoints(request.BaseURL, request.FullURL, request.ModelsURL)
	if err != nil {
		bridgeError(w, http.StatusBadRequest, "invalid_request", "Base URL must be a valid http(s) URL.")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()
	var lastErr error
	for _, endpoint := range endpoints {
		models, err := fetchModelList(ctx, endpoint, request.APIKey, request.Protocol, request.AuthMode)
		if err == nil {
			writeJSON(w, http.StatusOK, map[string]any{"models": models})
			return
		}
		lastErr = err
		if !errors.Is(err, errModelEndpointNotFound) {
			break
		}
	}
	message := "无法从模型服务拉取列表。已尝试：" + strings.Join(endpoints, "、") + "。请确认 Endpoint 和 API Key。"
	if lastErr != nil {
		message += " 最后错误：" + lastErr.Error()
	}
	bridgeError(w, http.StatusBadGateway, "model_discovery_failed", message)
}

func modelListEndpoints(raw string, fullURL bool, modelsURL string) ([]string, error) {
	if trimmed := strings.TrimSpace(modelsURL); trimmed != "" {
		endpoint, err := cleanHTTPURL(trimmed)
		if err != nil {
			return nil, err
		}
		return []string{endpoint}, nil
	}

	base, err := cleanHTTPURL(raw)
	if err != nil {
		return nil, err
	}
	if fullURL {
		return modelListEndpointsFromFullURL(base)
	}

	parsed, _ := url.Parse(base)
	path := strings.TrimRight(parsed.Path, "/")
	if strings.HasSuffix(path, "/models") {
		parsed.Path = path
		return []string{parsed.String()}, nil
	}

	var endpoints []string
	if endsWithVersionSegment(path) {
		endpoints = append(endpoints, withURLPath(parsed, path+"/models"))
		if !strings.HasSuffix(path, "/v1") {
			endpoints = append(endpoints, withURLPath(parsed, path+"/v1/models"))
		}
	} else {
		nextPath := "/v1/models"
		if path != "" {
			nextPath = path + "/v1/models"
		}
		endpoints = append(endpoints, withURLPath(parsed, nextPath))
	}
	if stripped, ok := stripModelCompatSuffix(path); ok {
		root := strings.TrimRight(stripped, "/")
		endpoints = append(endpoints, withURLPath(parsed, root+"/v1/models"))
		endpoints = append(endpoints, withURLPath(parsed, root+"/models"))
	}
	return uniqueStrings(endpoints), nil
}

func cleanHTTPURL(raw string) (string, error) {
	parsed, err := url.Parse(strings.TrimRight(strings.TrimSpace(raw), "/"))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" || parsed.User != nil {
		return "", errors.New("invalid model endpoint")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", errors.New("invalid model endpoint")
	}
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String(), nil
}

func modelListEndpointsFromFullURL(raw string) ([]string, error) {
	if idx := strings.Index(raw, "/v1/"); idx >= 0 {
		return []string{raw[:idx] + "/v1/models"}, nil
	}
	idx := strings.LastIndex(raw, "/")
	schemeIdx := strings.Index(raw, "://")
	if idx > schemeIdx+2 {
		return []string{raw[:idx] + "/v1/models"}, nil
	}
	return nil, errors.New("cannot derive model endpoint")
}

func withURLPath(parsed *url.URL, path string) string {
	next := *parsed
	next.Path = path
	return next.String()
}

func endsWithVersionSegment(path string) bool {
	last := path
	if idx := strings.LastIndex(path, "/"); idx >= 0 {
		last = path[idx+1:]
	}
	digits := strings.TrimPrefix(last, "v")
	return last != digits && digits != "" && strings.IndexFunc(digits, func(r rune) bool {
		return r < '0' || r > '9'
	}) == -1
}

func stripModelCompatSuffix(path string) (string, bool) {
	for _, suffix := range knownModelCompatSuffixes {
		if strings.HasSuffix(path, suffix) {
			return strings.TrimSuffix(path, suffix), true
		}
	}
	return "", false
}

func uniqueStrings(values []string) []string {
	unique := make([]string, 0, len(values))
	seen := map[string]bool{}
	for _, value := range values {
		if !seen[value] {
			seen[value] = true
			unique = append(unique, value)
		}
	}
	return unique
}

var errModelEndpointNotFound = errors.New("models endpoint not found")

func fetchModelList(ctx context.Context, endpoint, apiKey, protocol, authMode string) ([]string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	key := strings.TrimSpace(apiKey)
	if key != "" {
		if protocol == "anthropic" && authMode != "bearer" {
			req.Header.Set("X-Api-Key", key)
			req.Header.Set("Anthropic-Version", "2023-06-01")
		} else {
			req.Header.Set("Authorization", "Bearer "+key)
		}
	}
	req.Header.Set("Accept", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		message := modelDiscoveryErrorMessage(resp.StatusCode, resp.Body, apiKey)
		if resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusMethodNotAllowed {
			return nil, fmtError(errModelEndpointNotFound, message)
		}
		return nil, errors.New(message)
	}
	var payload struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
		Models []struct {
			Name string `json:"name"`
		} `json:"models"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&payload); err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	var models []string
	for _, item := range payload.Data {
		id := strings.TrimSpace(item.ID)
		if id != "" && !seen[id] {
			seen[id] = true
			models = append(models, id)
		}
	}
	for _, item := range payload.Models {
		name := strings.TrimSpace(item.Name)
		if name != "" && !seen[name] {
			seen[name] = true
			models = append(models, name)
		}
	}
	if len(models) == 0 {
		return nil, errors.New("empty model list")
	}
	sort.Strings(models)
	return models, nil
}

func modelDiscoveryErrorMessage(status int, body io.Reader, apiKey string) string {
	raw, _ := io.ReadAll(io.LimitReader(body, modelDiscoveryErrorBodyLimit+1))
	text := strings.TrimSpace(string(raw))
	if key := strings.TrimSpace(apiKey); key != "" {
		text = strings.ReplaceAll(text, key, "[REDACTED]")
		text = strings.ReplaceAll(text, "Bearer "+key, "Bearer [REDACTED]")
	}
	if len(text) > modelDiscoveryErrorBodyLimit {
		text = text[:modelDiscoveryErrorBodyLimit] + "..."
	}
	if text == "" {
		return http.StatusText(status)
	}
	return "HTTP " + http.StatusText(status) + ": " + text
}

func fmtError(kind error, message string) error {
	return errors.Join(kind, errors.New(message))
}

func (s *Server) handleShutdown(w http.ResponseWriter, r *http.Request) {
	// 关闭必须由坐在这台电脑前的人发起；局域网/手机远程一律 403。
	if !requestIsLoopback(r) {
		bridgeError(w, http.StatusForbidden, "shutdown_denied", "Shutdown is only allowed from this computer.")
		return
	}
	if !s.sameOriginUnsafe(r) {
		bridgeError(w, http.StatusForbidden, "origin_denied", "Request origin is not allowed.")
		return
	}
	if s.onShutdown == nil {
		bridgeError(w, http.StatusNotImplemented, "shutdown_unavailable", "This process does not support shutdown.")
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "stopping"})
	go s.onShutdown()
}

func requestIsLoopback(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) runtimeStatus(w http.ResponseWriter, r *http.Request) {
	hello, err := s.probe(r.Context())
	if err == nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"status": "ready",
			"runtime": map[string]any{
				"runtime_version": hello.RuntimeVersion,
				"catalog": map[string]any{
					"methods":       hello.Catalog.Methods,
					"notifications": hello.Catalog.Notifications,
					"features":      hello.Catalog.Features,
				},
			},
		})
		return
	}

	kind := runtime.ErrorUnavailable
	if typed, ok := err.(*runtime.Error); ok {
		kind = typed.Kind
	}
	status := http.StatusServiceUnavailable
	if kind == runtime.ErrorProtocol {
		status = http.StatusBadGateway
	}
	if kind == runtime.ErrorCapability {
		status = http.StatusNotImplemented
	}
	writeJSON(w, status, map[string]any{
		"status": string(kind),
		"error": map[string]string{
			"code":    string(kind),
			"message": safeMessage(kind),
		},
	})
}

func (s *Server) probe(ctx context.Context) (runtime.HelloResult, error) {
	s.probeMu.Lock()
	if !s.lastProbe.at.IsZero() && time.Since(s.lastProbe.at) < probeCacheTTL {
		result := s.lastProbe
		s.probeMu.Unlock()
		return result.hello, result.err
	}
	if flight := s.probeInFlight; flight != nil {
		s.probeMu.Unlock()
		select {
		case <-ctx.Done():
			return runtime.HelloResult{}, ctx.Err()
		case <-flight.done:
			return flight.result.hello, flight.result.err
		}
	}
	flight := &probeFlight{done: make(chan struct{})}
	s.probeInFlight = flight
	s.probeMu.Unlock()

	probeCtx, cancel := context.WithTimeout(context.Background(), s.probeTimeout)
	hello, err := s.prober.Probe(probeCtx)
	cancel()
	result := probeResult{hello: hello, err: err, at: time.Now()}

	s.probeMu.Lock()
	// Client cancellation must not make a healthy Runtime look unavailable to
	// other browser requests. The leader probe is detached from request context,
	// and only the bounded probe result is shared briefly.
	s.lastProbe = result
	s.probeInFlight = nil
	flight.result = result
	close(flight.done)
	s.probeMu.Unlock()
	return hello, err
}

func (s *Server) bridgeConnect(w http.ResponseWriter, r *http.Request) {
	if !s.sameOriginUnsafe(r) {
		bridgeError(w, http.StatusForbidden, "origin_denied", "Request origin is not allowed.")
		return
	}
	id, hello, err := s.bridge.Connect(r.Context())
	if err != nil {
		bridgeRuntimeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"id":    id,
		"hello": json.RawMessage(hello),
	})
}

func (s *Server) bridgeRPC(w http.ResponseWriter, r *http.Request) {
	if !s.sameOriginUnsafe(r) {
		bridgeError(w, http.StatusForbidden, "origin_denied", "Request origin is not allowed.")
		return
	}
	id := r.PathValue("id")
	if !bridge.ValidID(id) {
		bridgeError(w, http.StatusNotFound, "bridge_not_found", "Bridge connection was not found.")
		return
	}
	var request struct {
		Method string          `json:"method"`
		Params json.RawMessage `json:"params"`
	}
	if err := decodeLimitedJSON(w, r, s.bridge.MaxRequestBody(), &request); err != nil {
		bridgeError(w, http.StatusBadRequest, "invalid_request", "Request must be a valid JSON object.")
		return
	}
	result, err := s.bridge.Request(r.Context(), id, request.Method, request.Params)
	if err == nil {
		writeJSON(w, http.StatusOK, map[string]json.RawMessage{"result": result})
		return
	}
	switch {
	case errors.Is(err, bridge.ErrNotFound), errors.Is(err, bridge.ErrClosed):
		bridgeError(w, http.StatusNotFound, "bridge_not_found", "Bridge connection was not found.")
	case errors.Is(err, bridge.ErrMethodNotAllowed):
		bridgeError(w, http.StatusForbidden, "method_not_allowed", "Runtime method is not allowed.")
	case errors.Is(err, bridge.ErrInvalidParams):
		bridgeError(w, http.StatusBadRequest, "invalid_params", "Request params must be valid JSON.")
	default:
		bridgeRuntimeError(w, err)
	}
}

func (s *Server) bridgeEvents(w http.ResponseWriter, r *http.Request) {
	if !s.sameOriginUnsafe(r) {
		bridgeError(w, http.StatusForbidden, "origin_denied", "Request origin is not allowed.")
		return
	}
	id := r.PathValue("id")
	if !bridge.ValidID(id) {
		bridgeError(w, http.StatusNotFound, "bridge_not_found", "Bridge connection was not found.")
		return
	}
	notifications, unsubscribe, err := s.bridge.Subscribe(id)
	if err != nil {
		bridgeError(w, http.StatusNotFound, "bridge_not_found", "Bridge connection was not found.")
		return
	}
	defer unsubscribe()

	flusher, ok := w.(http.Flusher)
	if !ok {
		bridgeError(w, http.StatusInternalServerError, "stream_unavailable", "Event stream is unavailable.")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	_, _ = io.WriteString(w, ": connected\n\n")
	flusher.Flush()

	for {
		select {
		case <-r.Context().Done():
			return
		case notification, ok := <-notifications:
			if !ok {
				return
			}
			payload, err := json.Marshal(struct {
				Method string          `json:"method"`
				Params json.RawMessage `json:"params"`
			}{Method: notification.Method, Params: notification.Params})
			if err != nil { // Notification fields originate from a typed Runtime frame.
				return
			}
			// 浏览器已断开时写入会失败；立即退出，避免继续空转等待请求取消。
			if _, err = io.WriteString(w, "event: notification\ndata: "); err != nil {
				return
			}
			if _, err = w.Write(payload); err != nil {
				return
			}
			if _, err = io.WriteString(w, "\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

func (s *Server) bridgeDisconnect(w http.ResponseWriter, r *http.Request) {
	if !s.sameOriginUnsafe(r) {
		bridgeError(w, http.StatusForbidden, "origin_denied", "Request origin is not allowed.")
		return
	}
	if err := s.bridge.Disconnect(r.PathValue("id")); err != nil {
		bridgeError(w, http.StatusNotFound, "bridge_not_found", "Bridge connection was not found.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// sameOriginUnsafe 是浏览器 CSRF 边界。本机模式（loopback 监听）只允许
// loopback 同源请求；远程模式（allowRemote）放宽为任意同源（origin 主机与
// 请求主机一致），浏览器跨站页面依旧被拒绝，可信边界从本机扩展到监听网段。
// 无 Origin 的请求（原生客户端 / 同源导航）始终放行。
func (s *Server) sameOriginUnsafe(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	if s.validDesktopToken(r) {
		return true
	}
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" || parsed.User != nil || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return false
	}
	if parsed.Scheme != requestScheme(r) {
		return false
	}
	originHost, originPort, err := net.SplitHostPort(parsed.Host)
	if err != nil {
		return false
	}
	requestHost, requestPort, err := net.SplitHostPort(r.Host)
	if err != nil {
		return false
	}
	if s.allowRemote {
		// 远程模式：同源即放行（host 不区分大小写，port 必须一致）。
		return originPort == requestPort &&
			strings.EqualFold(originHost, requestHost)
	}
	return originPort == requestPort && sameLoopbackHost(originHost, requestHost)
}

func (s *Server) validDesktopToken(r *http.Request) bool {
	return s.desktopToken != "" &&
		requestIsLoopback(r) &&
		r.URL.Query().Get("desktop_token") == s.desktopToken
}

func requestScheme(r *http.Request) string {
	if r.TLS != nil {
		return "https"
	}
	return "http"
}

func sameLoopbackHost(a, b string) bool {
	// hostname localhost is a loopback alias, while all other host names are
	// refused so DNS configuration cannot widen this browser-only boundary.
	if strings.EqualFold(a, "localhost") && strings.EqualFold(b, "localhost") {
		return true
	}
	left, right := net.ParseIP(a), net.ParseIP(b)
	return left != nil && right != nil && left.IsLoopback() && right.IsLoopback() && left.Equal(right)
}

func decodeLimitedJSON(w http.ResponseWriter, r *http.Request, max int64, destination any) error {
	if r.Body == nil || (r.ContentLength > max && r.ContentLength >= 0) {
		return errors.New("body exceeds limit")
	}
	r.Body = http.MaxBytesReader(w, r.Body, max)
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return errors.New("multiple JSON values")
	}
	return nil
}

func bridgeRuntimeError(w http.ResponseWriter, err error) {
	// Runtime 的结构化 JSON-RPC 错误携带稳定 data.kind；必须按其映射到可读
	// 的错误，而不是全部压成 unavailable。原始 message 是自由文本，不透传。
	var rpcErr *runtime.RPCError
	if errors.As(err, &rpcErr) {
		kind := rpcErr.Kind()
		if kind != "" {
			// runtime_unavailable 表示 daemon 尚未 ready 或正在退出（0.5 起
			// 有 starting/ready/stopping 生命周期），语义上可重试，返回 503。
			status := http.StatusBadRequest
			if kind == "runtime_unavailable" {
				status = http.StatusServiceUnavailable
			}
			bridgeError(w, status, kind, safeRPCMessage(kind, rpcErr.Reason()))
			return
		}
	}
	kind := runtime.ErrorUnavailable
	var runtimeError *runtime.Error
	if errors.As(err, &runtimeError) {
		kind = runtimeError.Kind
	}
	status := http.StatusBadGateway
	if kind == runtime.ErrorCapability {
		status = http.StatusNotImplemented
	}
	bridgeError(w, status, string(kind), safeMessage(kind))
}

// safeRPCMessage 只根据公开协议的稳定错误 kind 生成面向浏览器的安全文案，
// 不透传 Runtime 自由文本 message。
func safeRPCMessage(kind, reason string) string {
	switch kind {
	case "session_required":
		return "需要先附加到该会话。"
	case "session_busy":
		switch reason {
		case "interaction_pending":
			return "请先处理当前等待回答或安全确认。"
		case "run_not_steerable":
			return "当前运行暂时不能追加消息，请等这一轮结束后再发送。"
		default:
			return "当前会话暂时不能执行这个操作，请等这一轮结束后再试。"
		}
	case "invalid_request", "parse_error":
		return "请求参数无效。"
	case "unsupported_method":
		return "Runtime 不支持该操作。"
	case "unsupported_capability":
		return "Installed Runtime does not support the required capability."
	case "handshake_required":
		return "需要先完成 Runtime 握手。"
	case "runtime_unavailable":
		return "Runtime 正在启动或不可用，请稍后重试。"
	default:
		return "Runtime 拒绝了该请求。"
	}
}

func bridgeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{"error": map[string]string{"code": code, "message": message}})
}

func safeMessage(kind runtime.ErrorKind) string {
	switch kind {
	case runtime.ErrorProtocol:
		return "Runtime returned an unsupported response."
	case runtime.ErrorCapability:
		return "Installed Runtime does not support the required protocol."
	default:
		return "Runtime is unavailable."
	}
}

func (s *Server) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if s.validDesktopToken(r) {
			if origin := r.Header.Get("Origin"); origin != "" {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Vary", "Origin")
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Accept")
			}
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

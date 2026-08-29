package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/alanchenchen/suna-app/gateway/internal/bridge"
	"github.com/alanchenchen/suna-app/gateway/internal/runtime"
)

type fakeProber struct {
	result runtime.HelloResult
	err    error
}

func (p fakeProber) Probe(context.Context) (runtime.HelloResult, error) {
	return p.result, p.err
}

func TestRuntimeStatusReady(t *testing.T) {
	t.Parallel()

	handler := NewServer(fakeProber{result: runtime.NewHelloResult("test", []string{"session.list", "session.attach", "session.create", "agent.sendMessage"}, nil, nil)}, time.Second)
	request := httptest.NewRequest(http.MethodGet, "/api/v1/runtime/status", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	if cacheControl := response.Header().Get("Cache-Control"); cacheControl != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", cacheControl)
	}
}

func TestRuntimeStatusRedactsInternalErrors(t *testing.T) {
	t.Parallel()

	handler := NewServer(fakeProber{err: &runtime.Error{Kind: runtime.ErrorUnavailable, Err: errors.New("secret path /private/data")}}, time.Second)
	request := httptest.NewRequest(http.MethodGet, "/api/v1/runtime/status", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusServiceUnavailable)
	}
	if response.Body.String() == "" || strings.Contains(response.Body.String(), "secret path") {
		t.Fatal("response leaked internal error details")
	}
}

func TestDiscoverModelsFetchesOpenAICompatibleList(t *testing.T) {
	t.Parallel()

	var gotAuth string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		if r.URL.Path != "/v1/models" {
			t.Fatalf("path = %q, want /v1/models", r.URL.Path)
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"data": []map[string]string{
				{"id": "gpt-5.5"},
				{"id": "gpt-5.2"},
			},
		})
	}))
	defer upstream.Close()

	handler := NewServer(fakeProber{}, time.Second)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/models/discover", bytes.NewBufferString(`{"base_url":"`+upstream.URL+`/v1","api_key":"test-token"}`))
	request.Host = "127.0.0.1:8080"
	request.Header.Set("Origin", "http://127.0.0.1:8080")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", response.Code, response.Body.String())
	}
	if gotAuth != "Bearer test-token" {
		t.Fatalf("Authorization = %q", gotAuth)
	}
	var body struct {
		Models []string `json:"models"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if strings.Join(body.Models, ",") != "gpt-5.2,gpt-5.5" {
		t.Fatalf("models = %#v", body.Models)
	}
}

func TestDiscoverModelsRequiresAPIKey(t *testing.T) {
	t.Parallel()

	handler := NewServer(fakeProber{}, time.Second)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/models/discover", bytes.NewBufferString(`{"base_url":"https://api.example.com/v1"}`))
	request.Host = "127.0.0.1:8080"
	request.Header.Set("Origin", "http://127.0.0.1:8080")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusBadRequest)
	}
	if !strings.Contains(response.Body.String(), "api_key_required") || !strings.Contains(response.Body.String(), "请先填写 API Key") {
		t.Fatalf("response is not actionable: %s", response.Body.String())
	}
}

func TestModelListEndpointsNormalizesCommonInputs(t *testing.T) {
	t.Parallel()

	tests := map[string][]string{
		"https://api.example.com":           {"https://api.example.com/v1/models"},
		"https://api.example.com/v1":        {"https://api.example.com/v1/models"},
		"https://api.example.com/v1/models": {"https://api.example.com/v1/models"},
		"https://api.example.com/openai":    {"https://api.example.com/openai/v1/models"},
	}
	for input, want := range tests {
		got, err := modelListEndpoints(input, false, "")
		if err != nil {
			t.Fatalf("modelListEndpoints(%q) error = %v", input, err)
		}
		if strings.Join(got, "\n") != strings.Join(want, "\n") {
			t.Fatalf("modelListEndpoints(%q) = %#v, want %#v", input, got, want)
		}
	}
}

func TestModelListEndpointsMatchCCSwitchCandidates(t *testing.T) {
	t.Parallel()

	tests := map[string][]string{
		"https://open.bigmodel.cn/api/coding/paas/v4": {
			"https://open.bigmodel.cn/api/coding/paas/v4/models",
			"https://open.bigmodel.cn/api/coding/paas/v4/v1/models",
		},
		"https://api.deepseek.com/anthropic": {
			"https://api.deepseek.com/anthropic/v1/models",
			"https://api.deepseek.com/v1/models",
			"https://api.deepseek.com/models",
		},
		"https://api.z.ai/api/anthropic": {
			"https://api.z.ai/api/anthropic/v1/models",
			"https://api.z.ai/v1/models",
			"https://api.z.ai/models",
		},
		"https://ark.cn-beijing.volces.com/api/coding": {
			"https://ark.cn-beijing.volces.com/api/coding/v1/models",
			"https://ark.cn-beijing.volces.com/v1/models",
			"https://ark.cn-beijing.volces.com/models",
		},
	}
	for input, want := range tests {
		got, err := modelListEndpoints(input, false, "")
		if err != nil {
			t.Fatalf("modelListEndpoints(%q) error = %v", input, err)
		}
		if strings.Join(got, "\n") != strings.Join(want, "\n") {
			t.Fatalf("modelListEndpoints(%q) = %#v, want %#v", input, got, want)
		}
	}
}

func TestModelListEndpointsDerivesFromFullURLAndOverride(t *testing.T) {
	t.Parallel()

	full, err := modelListEndpoints("https://proxy.example.com/v1/chat/completions", true, "")
	if err != nil {
		t.Fatal(err)
	}
	if got, want := strings.Join(full, "\n"), "https://proxy.example.com/v1/models"; got != want {
		t.Fatalf("full URL endpoints = %q, want %q", got, want)
	}

	override, err := modelListEndpoints("https://api.example.com/anthropic", false, "https://api.example.com/models")
	if err != nil {
		t.Fatal(err)
	}
	if got, want := strings.Join(override, "\n"), "https://api.example.com/models"; got != want {
		t.Fatalf("override endpoints = %q, want %q", got, want)
	}
}

func TestDiscoverModelsTriesFallbackCandidate(t *testing.T) {
	t.Parallel()

	var paths []string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path)
		if r.URL.Path != "/v1/models" {
			http.NotFound(w, r)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"data": []map[string]string{{"id": "fallback-model"}},
		})
	}))
	defer upstream.Close()

	handler := NewServer(fakeProber{}, time.Second)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/models/discover", bytes.NewBufferString(`{"base_url":"`+upstream.URL+`/anthropic","api_key":"test-token"}`))
	request.Host = "127.0.0.1:8080"
	request.Header.Set("Origin", "http://127.0.0.1:8080")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", response.Code, response.Body.String())
	}
	if got, want := strings.Join(paths, ","), "/anthropic/v1/models,/v1/models"; got != want {
		t.Fatalf("paths = %q, want %q", got, want)
	}
}

func TestDiscoverModelsFailureIsHelpfulAndRedacted(t *testing.T) {
	t.Parallel()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "bad token test-token", http.StatusUnauthorized)
	}))
	defer upstream.Close()

	handler := NewServer(fakeProber{}, time.Second)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/models/discover", bytes.NewBufferString(`{"base_url":"`+upstream.URL+`/v1","api_key":"test-token"}`))
	request.Host = "127.0.0.1:8080"
	request.Header.Set("Origin", "http://127.0.0.1:8080")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusBadGateway)
	}
	if strings.Contains(response.Body.String(), "test-token") {
		t.Fatal("response leaked API key")
	}
	if !strings.Contains(response.Body.String(), upstream.URL+"/v1/models") || !strings.Contains(response.Body.String(), "HTTP Unauthorized") {
		t.Fatalf("response is not actionable: %s", response.Body.String())
	}
}

func TestBridgeRPCErrorMapsStableKind(t *testing.T) {
	t.Parallel()

	// Runtime 结构化 JSON-RPC 错误（如 session_busy）必须映射为可读的稳定
	// kind，而不是被压成 unavailable；原始 message 不能透传。
	connection := newHTTPFakeConnection()
	connection.requestErr = &runtime.RPCError{
		Code:    -32602,
		Message: "interaction reply is owned by another client",
		Data:    json.RawMessage(`{"kind":"session_busy"}`),
	}
	service, err := bridge.New(httpFakeConnector{connection}, bridge.Config{})
	if err != nil {
		t.Fatal(err)
	}
	handler := NewServerWithBridge(fakeProber{}, time.Second, service)

	connect := httptest.NewRequest(http.MethodPost, "/api/v1/bridge/connect", nil)
	connect.Host = "127.0.0.1:8080"
	connect.Header.Set("Origin", "http://127.0.0.1:8080")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, connect)
	if response.Code != http.StatusCreated {
		t.Fatalf("connect = %d: %s", response.Code, response.Body.String())
	}
	var created struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}

	rpc := httptest.NewRequest(http.MethodPost, "/api/v1/bridge/"+created.ID+"/rpc", bytes.NewBufferString(`{"method":"agent.guardReply","params":{"id":"x","decision":"approve"}}`))
	rpc.Host = "127.0.0.1:8080"
	rpc.Header.Set("Origin", "http://127.0.0.1:8080")
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, rpc)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("rpc = %d, want %d; body %s", response.Code, http.StatusBadRequest, response.Body.String())
	}
	var body struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Error.Code != "session_busy" {
		t.Fatalf("error code = %q, want session_busy", body.Error.Code)
	}
	if strings.Contains(body.Error.Message, "owned by another client") {
		t.Fatal("response leaked Runtime free-text error message")
	}
	if strings.Contains(body.Error.Message, "占用") {
		t.Fatalf("error message should avoid vague ownership wording: %q", body.Error.Message)
	}
}

func TestBridgeRPCErrorMapsSessionBusyReason(t *testing.T) {
	t.Parallel()

	connection := newHTTPFakeConnection()
	connection.requestErr = &runtime.RPCError{
		Code:    -32602,
		Message: "interaction_pending",
		Data:    json.RawMessage(`{"kind":"session_busy","reason":"interaction_pending"}`),
	}
	service, err := bridge.New(httpFakeConnector{connection}, bridge.Config{})
	if err != nil {
		t.Fatal(err)
	}
	handler := NewServerWithBridge(fakeProber{}, time.Second, service)

	connect := httptest.NewRequest(http.MethodPost, "/api/v1/bridge/connect", nil)
	connect.Host = "127.0.0.1:8080"
	connect.Header.Set("Origin", "http://127.0.0.1:8080")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, connect)
	if response.Code != http.StatusCreated {
		t.Fatalf("connect = %d: %s", response.Code, response.Body.String())
	}
	var created struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}

	rpc := httptest.NewRequest(http.MethodPost, "/api/v1/bridge/"+created.ID+"/rpc", bytes.NewBufferString(`{"method":"agent.sendMessage","params":{"parts":[{"type":"text","text":"hello"}]}}`))
	rpc.Host = "127.0.0.1:8080"
	rpc.Header.Set("Origin", "http://127.0.0.1:8080")
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, rpc)

	var body struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Error.Code != "session_busy" {
		t.Fatalf("error code = %q, want session_busy", body.Error.Code)
	}
	if body.Error.Message != "请先处理当前等待回答或安全确认。" {
		t.Fatalf("message = %q", body.Error.Message)
	}
}

// TestSameOriginUnsafeRemoteMode 验证远程模式（--listen 0.0.0.0 / Tailscale）下
// CSRF 边界：同源请求放行、跨源请求拒绝、无 Origin 放行；本机模式仍只认 loopback。
func TestSameOriginUnsafeRemoteMode(t *testing.T) {
	t.Parallel()

	remote := &Server{allowRemote: true}
	local := &Server{allowRemote: false}

	cases := []struct {
		name   string
		srv    *Server
		host   string
		origin string
		want   bool
	}{
		// 远程模式：Tailscale IP 同源放行。
		{name: "remote same-origin tailscale", srv: remote, host: "100.64.0.5:7633", origin: "http://100.64.0.5:7633", want: true},
		// 远程模式：host 大小写不敏感。
		{name: "remote same-origin hostname case", srv: remote, host: "MyMac:7633", origin: "http://mymac:7633", want: true},
		// 远程模式：跨源仍拒绝（恶意网站无法调用）。
		{name: "remote cross-origin rejected", srv: remote, host: "100.64.0.5:7633", origin: "http://evil.example.com", want: false},
		// 远程模式：端口不同视为跨源。
		{name: "remote cross-port rejected", srv: remote, host: "100.64.0.5:7633", origin: "http://100.64.0.5:9999", want: false},
		// 远程模式：无 Origin（原生客户端 / 同源导航）放行。
		{name: "remote no origin", srv: remote, host: "100.64.0.5:7633", origin: "", want: true},
		// 本机模式：远程 origin 一律拒绝（即使同源）。
		{name: "local rejects remote origin", srv: local, host: "127.0.0.1:7633", origin: "http://100.64.0.5:7633", want: false},
		// 本机模式：loopback 同源放行（回归保护）。
		{name: "local loopback same-origin", srv: local, host: "127.0.0.1:7633", origin: "http://127.0.0.1:7633", want: true},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			r := httptest.NewRequest(http.MethodPost, "/api/v1/bridge/connect", nil)
			r.Host = tc.host
			if tc.origin != "" {
				r.Header.Set("Origin", tc.origin)
			}
			if got := tc.srv.sameOriginUnsafe(r); got != tc.want {
				t.Fatalf("sameOriginUnsafe(host=%q, origin=%q) = %v, want %v", tc.host, tc.origin, got, tc.want)
			}
		})
	}
}

func TestDesktopTokenAllowsOnlyLoopbackWebViewOrigin(t *testing.T) {
	t.Parallel()

	srv := &Server{desktopToken: "test-token"}
	allowed := httptest.NewRequest(http.MethodPost, "/api/v1/bridge/connect?desktop_token=test-token", nil)
	allowed.RemoteAddr = "127.0.0.1:49153"
	allowed.Host = "127.0.0.1:7633"
	allowed.Header.Set("Origin", "wails://wails.localhost")
	if !srv.sameOriginUnsafe(allowed) {
		t.Fatal("desktop token from loopback WebView origin was rejected")
	}

	wrongToken := allowed.Clone(context.Background())
	wrongToken.URL.RawQuery = "desktop_token=wrong"
	if srv.sameOriginUnsafe(wrongToken) {
		t.Fatal("wrong desktop token was accepted")
	}

	remote := allowed.Clone(context.Background())
	remote.RemoteAddr = "192.168.1.10:49153"
	if srv.sameOriginUnsafe(remote) {
		t.Fatal("desktop token from remote address was accepted")
	}
}

func TestDesktopTokenCORSPreflight(t *testing.T) {
	t.Parallel()

	handler := NewServerWithLifecycleAndDesktopToken(fakeProber{}, time.Second, nil, false, "test-token", nil)
	request := httptest.NewRequest(http.MethodOptions, "/api/v1/bridge/connect?desktop_token=test-token", nil)
	request.RemoteAddr = "127.0.0.1:49153"
	request.Header.Set("Origin", "wails://wails.localhost")
	request.Header.Set("Access-Control-Request-Method", http.MethodPost)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusNoContent {
		t.Fatalf("preflight status = %d, want %d", response.Code, http.StatusNoContent)
	}
	if got := response.Header().Get("Access-Control-Allow-Origin"); got != "wails://wails.localhost" {
		t.Fatalf("Access-Control-Allow-Origin = %q", got)
	}
}

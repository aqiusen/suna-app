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
	if body.Error.Message == "" {
		t.Fatal("error message must be readable")
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

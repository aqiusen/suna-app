package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestShutdownAcceptedFromLoopback(t *testing.T) {
	var called atomic.Bool
	handler := NewServerWithLifecycle(fakeProber{}, time.Second, nil, false, func() {
		called.Store(true)
	})
	request := httptest.NewRequest(http.MethodPost, "/api/v1/shutdown", nil)
	request.RemoteAddr = "127.0.0.1:54321"
	request.Host = "127.0.0.1:7633"
	request.Header.Set("Origin", "http://127.0.0.1:7633")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusAccepted)
	}
	waitFor(t, func() bool { return called.Load() })
}

func TestShutdownForbiddenFromRemoteAddr(t *testing.T) {
	var called atomic.Bool
	handler := NewServerWithLifecycle(fakeProber{}, time.Second, nil, true, func() {
		called.Store(true)
	})
	request := httptest.NewRequest(http.MethodPost, "/api/v1/shutdown", nil)
	request.RemoteAddr = "192.168.1.20:54321"
	request.Host = "192.168.1.10:7633"
	request.Header.Set("Origin", "http://192.168.1.10:7633")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusForbidden)
	}
	var body struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Error.Code != "shutdown_denied" {
		t.Fatalf("code = %q, want shutdown_denied", body.Error.Code)
	}
	if called.Load() {
		t.Fatal("onShutdown ran for a remote request")
	}
}

func TestShutdownUnavailableWithoutCallback(t *testing.T) {
	handler := NewServer(fakeProber{}, time.Second)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/shutdown", nil)
	request.RemoteAddr = "127.0.0.1:1"
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusNotImplemented {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusNotImplemented)
	}
}

func waitFor(t *testing.T, ready func() bool) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if ready() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("shutdown callback was not invoked")
}

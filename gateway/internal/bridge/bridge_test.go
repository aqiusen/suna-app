package bridge

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/alanchenchen/suna-app/gateway/internal/runtime"
)

type fakeConnector struct{ connection *fakeConnection }

func (f fakeConnector) Connect(context.Context) (Connection, error) { return f.connection, nil }

type endpointConnector struct {
	mu               sync.Mutex
	endpoint         string
	connections      map[string]*fakeConnection
	connectEndpoints []string
	refreshes        int
	refreshed        chan struct{}
}

func (c *endpointConnector) Connect(context.Context) (Connection, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.connectEndpoints = append(c.connectEndpoints, c.endpoint)
	return c.connections[c.endpoint], nil
}

func (c *endpointConnector) RefreshDiscovery() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.refreshes++
	c.endpoint = "127.0.0.1:20002"
	select {
	case c.refreshed <- struct{}{}:
	default:
	}
}

type fakeConnection struct {
	notifications chan runtime.Notification
	done          chan struct{}
	mu            sync.Mutex
	method        string
	params        json.RawMessage
	closed        bool
}

func newFakeConnection() *fakeConnection {
	return &fakeConnection{notifications: make(chan runtime.Notification, 2), done: make(chan struct{})}
}
func (c *fakeConnection) Request(_ context.Context, method string, params any) (json.RawMessage, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.method = method
	c.params = append(json.RawMessage(nil), params.(json.RawMessage)...)
	return json.RawMessage(`{"ok":true}`), nil
}
func (c *fakeConnection) Notifications() <-chan runtime.Notification { return c.notifications }
func (c *fakeConnection) Hello() json.RawMessage {
	return json.RawMessage(`{"protocol_version":"0.4","runtime_version":"test","transport":"tcp","capabilities":{},"content_sources":{}}`)
}
func (c *fakeConnection) Done() <-chan struct{} { return c.done }
func (c *fakeConnection) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.closed {
		c.closed = true
		close(c.done)
		close(c.notifications)
	}
	return nil
}

func TestDefaultAllowedMethodIsExactPublicProtocolAllowlist(t *testing.T) {
	t.Parallel()

	allowed := []string{
		"session.list", "session.create", "session.attach", "session.detach",
		"session.update", "session.delete", "session.compact", "session.usage",
		"agent.sendMessage", "agent.resumeRun", "agent.cancel", "agent.askReply", "agent.guardReply",
		"config.get", "config.set",
		"memory.list", "memory.delete", "memory.clear",
		"skill.list", "skill.set",
		"mcp.list", "mcp.toggle", "mcp.reload",
		"daemon.status",
		"agent.steer", "agent.steerRemove",
	}
	for _, method := range allowed {
		if !defaultAllowedMethod(method) {
			t.Errorf("allowlist rejected %q", method)
		}
	}
	for _, method := range []string{
		"", "runtime.hello", "runtime.shutdown", "session", "session.export",
		"agent.sendmessage", "agent.sendMessage ", "agent.sendMessage.extra",
		"config.delete", "memory.set", "skill.delete", "mcp.add", "guard.reply",
	} {
		if defaultAllowedMethod(method) {
			t.Errorf("allowlist admitted %q", method)
		}
	}
}

func TestServiceRefreshesDiscoveryAfterRuntimeTermination(t *testing.T) {
	oldConnection := newFakeConnection()
	newConnection := newFakeConnection()
	connector := &endpointConnector{
		endpoint: "127.0.0.1:20001",
		connections: map[string]*fakeConnection{
			"127.0.0.1:20001": oldConnection,
			"127.0.0.1:20002": newConnection,
		},
		refreshed: make(chan struct{}, 1),
	}
	service, err := New(connector, Config{Random: zeroReader{}})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := service.Connect(context.Background()); err != nil {
		t.Fatal(err)
	}

	// 模拟 Runtime 主动关闭长连接；这不是浏览器 DELETE 或 Gateway shutdown。
	close(oldConnection.done)
	select {
	case <-connector.refreshed:
	case <-time.After(time.Second):
		t.Fatal("Runtime termination did not refresh discovery")
	}

	if _, _, err := service.Connect(context.Background()); err != nil {
		t.Fatal(err)
	}
	connector.mu.Lock()
	defer connector.mu.Unlock()
	if connector.refreshes != 1 {
		t.Fatalf("RefreshDiscovery calls = %d, want 1", connector.refreshes)
	}
	if got, want := connector.connectEndpoints, []string{"127.0.0.1:20001", "127.0.0.1:20002"}; len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("connect endpoints = %v, want %v", got, want)
	}
}

func TestServiceRetiresConnectionWhenDoneClosesBeforeNotifications(t *testing.T) {
	connection := newFakeConnection()
	service, err := New(fakeConnector{connection}, Config{Random: zeroReader{}})
	if err != nil {
		t.Fatal(err)
	}
	id, _, err := service.Connect(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	events, unsubscribe, err := service.Subscribe(id)
	if err != nil {
		t.Fatal(err)
	}
	defer unsubscribe()

	// Done is the lifecycle signal. A Connector is permitted to leave its
	// notification channel open while it tears down its transport.
	close(connection.done)
	select {
	case _, ok := <-events:
		if ok {
			t.Fatal("SSE subscriber remained open after Runtime termination")
		}
	case <-time.After(time.Second):
		t.Fatal("SSE subscriber was not closed after Runtime termination")
	}
	if _, err := service.Request(context.Background(), id, "session.list", nil); !errors.Is(err, ErrNotFound) {
		t.Fatalf("request after termination error = %v, want ErrNotFound", err)
	}
	if _, _, err := service.Subscribe(id); !errors.Is(err, ErrNotFound) {
		t.Fatalf("subscribe after termination error = %v, want ErrNotFound", err)
	}
}

func TestServiceRequestRearmsIdleDisconnectWithoutSubscribers(t *testing.T) {
	connection := newFakeConnection()
	service, err := New(fakeConnector{connection}, Config{
		Random:            zeroReader{},
		ClientIdleTimeout: 20 * time.Millisecond,
	})
	if err != nil {
		t.Fatal(err)
	}
	id, _, err := service.Connect(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Request(context.Background(), id, "session.list", nil); err != nil {
		t.Fatal(err)
	}

	select {
	case <-connection.Done():
	case <-time.After(time.Second):
		t.Fatal("idle bridge remained open after its last RPC")
	}
	if _, err := service.Request(context.Background(), id, "session.list", nil); !errors.Is(err, ErrNotFound) {
		t.Fatalf("request after idle disconnect error = %v, want ErrNotFound", err)
	}
}

func TestServiceRequestAndNotification(t *testing.T) {
	connection := newFakeConnection()
	service, err := New(fakeConnector{connection}, Config{Random: zeroReader{}})
	if err != nil {
		t.Fatal(err)
	}
	id, _, err := service.Connect(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !ValidID(id) {
		t.Fatalf("invalid generated ID %q", id)
	}

	events, unsubscribe, err := service.Subscribe(id)
	if err != nil {
		t.Fatal(err)
	}
	defer unsubscribe()
	connection.notifications <- runtime.Notification{Method: "agent.progress", Params: json.RawMessage(`{"step":1}`)}
	if got := <-events; got.Method != "agent.progress" {
		t.Fatalf("event method = %q", got.Method)
	}
	if _, err := service.Request(context.Background(), id, "agent.sendMessage", json.RawMessage(`{"parts":[{"type":"text","text":"x"}]}`)); err != nil {
		t.Fatal(err)
	}
	connection.mu.Lock()
	method := connection.method
	connection.mu.Unlock()
	if method != "agent.sendMessage" {
		t.Fatalf("method = %q", method)
	}
	for _, request := range []struct {
		method string
		params json.RawMessage
	}{
		{"agent.steer", json.RawMessage(`{"session_id":"session","run_id":"run","parts":[{"type":"text","text":"queued"}]}`)},
		{"agent.steerRemove", json.RawMessage(`{"session_id":"session","run_id":"run","id":"steer"}`)},
	} {
		if _, err := service.Request(context.Background(), id, request.method, request.params); err != nil {
			t.Fatalf("%s: %v", request.method, err)
		}
		connection.mu.Lock()
		method = connection.method
		connection.mu.Unlock()
		if method != request.method {
			t.Fatalf("method = %q, want %q", method, request.method)
		}
	}
	if _, err := service.Request(context.Background(), id, "runtime.hello", nil); !errors.Is(err, ErrMethodNotAllowed) {
		t.Fatalf("error = %v", err)
	}
}

type zeroReader struct{}

func (zeroReader) Read(p []byte) (int, error) {
	for i := range p {
		p[i] = 0
	}
	return len(p), nil
}

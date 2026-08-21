package runtime

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"os/exec"
	"sync"
	"testing"
	"time"
)

type fakeLauncher struct {
	result ServeResult
	err    error
}

func (l fakeLauncher) Launch(context.Context) (ServeResult, error) { return l.result, l.err }

// testCatalogHello 返回一个包含 Gateway 必需方法的合法 hello 响应，
// 供测试扮演新式 catalog 握手（替代旧的 protocol_version 门控）。
func testCatalogHello() map[string]any {
	return map[string]any{
		"jsonrpc": "2.0",
		"id":      1,
		"result": map[string]any{
			"runtime_version": "test",
			"transport":       "tcp",
			"catalog": map[string]any{
				"methods":       requiredCatalogMethods,
				"notifications": []string{},
				"features":      []string{},
			},
			"content_sources": map[string]any{},
		},
	}
}

func TestCommandLauncherDoesNotInheritDaemonMode(t *testing.T) {
	original := runCommand
	t.Cleanup(func() { runCommand = original })
	runCommand = func(context.Context, string, ...string) *exec.Cmd {
		return exec.Command("sh", "-c", `printf '%s' "${SUNA_RUN_DAEMON-unset}"`)
	}

	t.Setenv("SUNA_RUN_DAEMON", "1")
	_, err := (CommandLauncher{Binary: "suna"}).Launch(context.Background())
	if err == nil {
		t.Fatal("Launch() succeeded, want unavailable because daemon mode was removed")
	}
}

func TestWithoutDaemonMode(t *testing.T) {
	filtered := withoutDaemonMode([]string{"A=1", "SUNA_RUN_DAEMON=1", "B=2"})
	if len(filtered) != 2 || filtered[0] != "A=1" || filtered[1] != "B=2" {
		t.Fatalf("withoutDaemonMode() = %#v", filtered)
	}
}
func TestConnectionManagerConnectRequestAndNotification(t *testing.T) {
	listener := newRuntimeListener(t)
	defer listener.Close()

	serverDone := make(chan error, 1)
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			serverDone <- err
			return
		}
		defer conn.Close()
		reader := bufio.NewReader(conn)
		hello := readTestMessage(t, reader)
		if hello.Method != "runtime.hello" || hello.ID != 1 {
			serverDone <- errors.New("runtime.hello was not sent first")
			return
		}
		if err := writeTestJSON(conn, testCatalogHello()); err != nil {
			serverDone <- err
			return
		}

		request := readTestMessage(t, reader)
		if request.Method != "agent.echo" || request.ID != 2 {
			serverDone <- errors.New("unexpected request")
			return
		}
		if err := writeTestJSON(conn, map[string]any{"jsonrpc": "2.0", "method": "agent.progress", "params": map[string]any{"step": 1}}); err != nil {
			serverDone <- err
			return
		}
		if err := writeTestJSON(conn, map[string]any{"jsonrpc": "2.0", "id": 2, "result": map[string]any{"value": "ok"}}); err != nil {
			serverDone <- err
			return
		}
		serverDone <- nil
		// Keep the peer open until the client has consumed the response.
		<-time.After(100 * time.Millisecond)
	}()

	manager := newTestManager(t, listener.Addr().String())
	connection, err := manager.Connect(context.Background())
	if err != nil {
		t.Fatalf("Connect() error = %v", err)
	}
	defer connection.Close()

	result, err := Call[struct {
		Value string `json:"value"`
	}](context.Background(), connection, "agent.echo", map[string]string{"input": "test"})
	if err != nil {
		t.Fatalf("Call() error = %T %#v", err, err)
	}
	if result.Value != "ok" {
		t.Errorf("result.Value = %q, want ok", result.Value)
	}
	select {
	case notification := <-connection.Notifications():
		if notification.Method != "agent.progress" {
			t.Errorf("notification method = %q", notification.Method)
		}
	case <-time.After(time.Second):
		t.Fatal("did not receive notification")
	}
	if err := <-serverDone; err != nil {
		t.Fatal(err)
	}
}

func TestConnectionDispatchesConcurrentResponsesByID(t *testing.T) {
	listener := newRuntimeListener(t)
	defer listener.Close()
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		reader := bufio.NewReader(conn)
		_ = readTestMessage(t, reader)
		_ = writeTestJSON(conn, testCatalogHello())
		first := readTestMessage(t, reader)
		second := readTestMessage(t, reader)
		// Responses deliberately arrive in the opposite order from requests.
		_ = writeTestJSON(conn, map[string]any{"jsonrpc": "2.0", "id": second.ID, "result": map[string]any{"method": second.Method}})
		_ = writeTestJSON(conn, map[string]any{"jsonrpc": "2.0", "id": first.ID, "result": map[string]any{"method": first.Method}})
		<-time.After(100 * time.Millisecond)
	}()

	connection, err := newTestManager(t, listener.Addr().String()).Connect(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()

	var wg sync.WaitGroup
	results := make(chan string, 2)
	for _, method := range []string{"session.one", "session.two"} {
		wg.Add(1)
		go func(method string) {
			defer wg.Done()
			result, callErr := Call[struct {
				Method string `json:"method"`
			}](context.Background(), connection, method, nil)
			if callErr != nil {
				t.Errorf("Call(%s): %T %#v", method, callErr, callErr)
				return
			}
			results <- result.Method
		}(method)
	}
	wg.Wait()
	close(results)
	seen := map[string]bool{}
	for result := range results {
		seen[result] = true
	}
	if !seen["session.one"] || !seen["session.two"] {
		t.Errorf("responses = %#v, want both methods", seen)
	}
}

func TestConnectionReturnsTypedRPCErrorAndHonorsCancellation(t *testing.T) {
	listener := newRuntimeListener(t)
	defer listener.Close()
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		reader := bufio.NewReader(conn)
		_ = readTestMessage(t, reader)
		_ = writeTestJSON(conn, testCatalogHello())
		first := readTestMessage(t, reader)
		_ = writeTestJSON(conn, map[string]any{"jsonrpc": "2.0", "id": first.ID, "error": map[string]any{"code": -32042, "message": "denied", "data": map[string]bool{"retry": false}}})
		// Consume the canceled request without replying, then keep the socket alive.
		_ = readTestMessage(t, reader)
		<-time.After(100 * time.Millisecond)
	}()

	connection, err := newTestManager(t, listener.Addr().String()).Connect(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	_, err = connection.Request(context.Background(), "agent.denied", nil)
	var rpcErr *RPCError
	if !errors.As(err, &rpcErr) || rpcErr.Code != -32042 || rpcErr.Message != "denied" {
		t.Fatalf("Request() error = %#v, want typed remote error", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	_, err = connection.Request(ctx, "agent.wait", nil)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("canceled Request() error = %v, want deadline exceeded", err)
	}
}

func TestConnectionRejectsOversizedFrameAndCloses(t *testing.T) {
	listener := newRuntimeListener(t)
	defer listener.Close()
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		reader := bufio.NewReader(conn)
		_ = readTestMessage(t, reader)
		_ = writeTestJSON(conn, testCatalogHello())
		// Handshake uses the manager's frame limit too, so send it before restricting it.
		<-time.After(20 * time.Millisecond)
		_, _ = conn.Write([]byte("{" + string(make([]byte, 1024)) + "\n"))
	}()
	manager := newTestManager(t, listener.Addr().String())
	manager.config.MaxFrameBytes = 512
	connection, err := manager.Connect(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	select {
	case <-connection.Done():
		if err := connection.terminalError(); err == nil {
			t.Fatal("terminal error is nil")
		}
	case <-time.After(time.Second):
		t.Fatal("oversized frame did not close connection")
	}
}

func TestConnectionAcceptsLargeFrameOverOld64KBLimit(t *testing.T) {
	// 回归测试：Runtime 的 session.attach 完整 snapshot 可达数百 KB，而 Gateway
	// 早期帧上限是 64KB，导致大 snapshot 被误判为协议错误并终止连接。
	// 现在 TCP 帧上限为 16MB，必须能正常接收并分发大帧。
	listener := newRuntimeListener(t)
	defer listener.Close()
	const largePayloadSize = 200 * 1024
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		reader := bufio.NewReader(conn)
		_ = readTestMessage(t, reader) // runtime.hello
		_ = writeTestJSON(conn, testCatalogHello())
		message := readTestMessage(t, reader) // session.attach
		large := map[string]any{
			"jsonrpc": "2.0",
			"id":      message.ID,
			"result": map[string]any{
				"snapshot": map[string]any{
					"padding": string(make([]byte, largePayloadSize)),
				},
			},
		}
		_ = writeTestJSON(conn, large)
		<-time.After(200 * time.Millisecond)
	}()
	manager := newTestManager(t, listener.Addr().String())
	connection, err := manager.Connect(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()

	var result map[string]any
	if err := connection.Call(context.Background(), "session.attach", map[string]any{"session_id": "test"}, &result); err != nil {
		t.Fatalf("Call() with large result error = %v", err)
	}
	snapshot, ok := result["snapshot"].(map[string]any)
	if !ok {
		t.Fatalf("result has no snapshot: %v", result)
	}
	padding, ok := snapshot["padding"].(string)
	if !ok || len(padding) != largePayloadSize {
		t.Fatalf("large payload not preserved: got %d bytes", len(padding))
	}
}

func TestConnectionManagerRejectsNonLoopbackLauncherEndpoint(t *testing.T) {
	manager, err := NewConnectionManager(ManagerConfig{Launcher: fakeLauncher{result: ServeResult{Status: "ready", TCPEndpoint: "192.0.2.1:3000"}}})
	if err != nil {
		t.Fatal(err)
	}
	_, err = manager.Connect(context.Background())
	var runtimeErr *Error
	if !errors.As(err, &runtimeErr) || runtimeErr.Kind != ErrorProtocol {
		t.Fatalf("Connect() error = %v, want protocol error", err)
	}
}

func TestConnectionManagerCanceledCreatorDoesNotCancelSharedLaunch(t *testing.T) {
	launcher := &blockingLauncher{
		result:  ServeResult{Status: "ready", TCPEndpoint: "127.0.0.1:1111"},
		started: make(chan struct{}),
		release: make(chan struct{}),
	}
	manager, err := NewConnectionManager(ManagerConfig{
		Launcher: launcher,
		DialContext: func(_ context.Context, _, _ string) (net.Conn, error) {
			client, server := net.Pipe()
			go func() {
				defer server.Close()
				reader := bufio.NewReader(server)
				if _, err := reader.ReadBytes('\n'); err != nil {
					return
				}
				_ = writeTestJSON(server, testCatalogHello())
				_, _ = io.Copy(io.Discard, reader)
			}()
			return client, nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	firstCtx, cancelFirst := context.WithCancel(context.Background())
	first := make(chan error, 1)
	go func() {
		connection, connectErr := manager.Connect(firstCtx)
		if connection != nil {
			_ = connection.Close()
		}
		first <- connectErr
	}()
	select {
	case <-launcher.started:
	case <-time.After(time.Second):
		t.Fatal("first launch did not start")
	}
	cancelFirst()
	select {
	case err := <-first:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("first Connect() error = %v, want context canceled", err)
		}
	case <-time.After(time.Second):
		t.Fatal("canceled creator remained blocked on shared launch")
	}

	second := make(chan connectResult, 1)
	secondCtx := &signalDoneContext{Context: context.Background(), entered: make(chan struct{})}
	go func() {
		connection, connectErr := manager.Connect(secondCtx)
		second <- connectResult{connection: connection, err: connectErr}
	}()
	select {
	case <-secondCtx.entered:
	case <-time.After(time.Second):
		t.Fatal("second Connect() did not join the shared launch")
	}
	close(launcher.release)
	select {
	case result := <-second:
		if result.err != nil {
			t.Fatalf("second Connect() error = %v", result.err)
		}
		defer result.connection.Close()
	case <-time.After(time.Second):
		t.Fatal("second Connect() did not complete after shared launch")
	}
	if calls := launcher.callCount(); calls != 1 {
		t.Fatalf("Launch() calls = %d, want 1", calls)
	}
}

func TestConnectionManagerRefreshDiscoveryDoesNotCacheInFlightLaunch(t *testing.T) {
	launcher := &blockingSequenceLauncher{
		results: []ServeResult{
			{Status: "ready", TCPEndpoint: "127.0.0.1:1111"},
			{Status: "ready", TCPEndpoint: "127.0.0.1:2222"},
		},
		firstStarted: make(chan struct{}),
		releaseFirst: make(chan struct{}),
	}
	var (
		dialMu    sync.Mutex
		dialAddrs []string
	)
	manager, err := NewConnectionManager(ManagerConfig{
		Launcher: launcher,
		DialContext: func(_ context.Context, _, address string) (net.Conn, error) {
			dialMu.Lock()
			dialAddrs = append(dialAddrs, address)
			dialMu.Unlock()
			client, server := net.Pipe()
			go func() {
				defer server.Close()
				reader := bufio.NewReader(server)
				if _, err := reader.ReadBytes('\n'); err != nil {
					return
				}
				_ = writeTestJSON(server, testCatalogHello())
				_, _ = io.Copy(io.Discard, reader)
			}()
			return client, nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	firstConnect := make(chan connectResult, 1)
	go func() {
		connection, err := manager.Connect(context.Background())
		firstConnect <- connectResult{connection: connection, err: err}
	}()
	select {
	case <-launcher.firstStarted:
	case <-time.After(time.Second):
		t.Fatal("first launch did not start")
	}

	manager.RefreshDiscovery()
	secondConnect := make(chan connectResult, 1)
	secondCtx := &signalDoneContext{Context: context.Background(), entered: make(chan struct{})}
	go func() {
		connection, err := manager.Connect(secondCtx)
		secondConnect <- connectResult{connection: connection, err: err}
	}()
	select {
	case <-secondCtx.entered:
	case <-time.After(time.Second):
		t.Fatal("second Connect() did not join the first launch")
	}
	close(launcher.releaseFirst)

	var first *Connection
	select {
	case result := <-firstConnect:
		if result.err != nil {
			t.Fatalf("first Connect() error = %v", result.err)
		}
		first = result.connection
	case <-time.After(time.Second):
		t.Fatal("first Connect() did not finish")
	}
	defer first.Close()

	var second *Connection
	select {
	case result := <-secondConnect:
		if result.err != nil {
			t.Fatalf("second Connect() error = %v", result.err)
		}
		second = result.connection
	case <-time.After(time.Second):
		t.Fatal("second Connect() did not finish")
	}
	defer second.Close()

	if calls := launcher.callCount(); calls != 2 {
		t.Fatalf("Launch() calls = %d, want 2", calls)
	}
	dialMu.Lock()
	defer dialMu.Unlock()
	if len(dialAddrs) != 2 || dialAddrs[0] != "127.0.0.1:2222" || dialAddrs[1] != "127.0.0.1:2222" {
		t.Fatalf("dial addresses = %#v, want refreshed endpoint only", dialAddrs)
	}
}

type signalDoneContext struct {
	context.Context
	entered chan struct{}
	once    sync.Once
}

func (c *signalDoneContext) Done() <-chan struct{} {
	c.once.Do(func() { close(c.entered) })
	return c.Context.Done()
}

type connectResult struct {
	connection *Connection
	err        error
}

type blockingLauncher struct {
	result  ServeResult
	started chan struct{}
	release chan struct{}

	mu    sync.Mutex
	calls int
}

func (l *blockingLauncher) Launch(ctx context.Context) (ServeResult, error) {
	l.mu.Lock()
	call := l.calls
	l.calls++
	l.mu.Unlock()
	if call == 0 {
		close(l.started)
	}
	select {
	case <-l.release:
		return l.result, nil
	case <-ctx.Done():
		return ServeResult{}, ctx.Err()
	}
}

func (l *blockingLauncher) callCount() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.calls
}

type blockingSequenceLauncher struct {
	results      []ServeResult
	firstStarted chan struct{}
	releaseFirst chan struct{}

	mu    sync.Mutex
	calls int
}

func (l *blockingSequenceLauncher) Launch(context.Context) (ServeResult, error) {
	l.mu.Lock()
	call := l.calls
	l.calls++
	l.mu.Unlock()
	if call == 0 {
		close(l.firstStarted)
		<-l.releaseFirst
	}
	return l.results[call], nil
}

func (l *blockingSequenceLauncher) callCount() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.calls
}

type testMessage struct {
	ID     uint64          `json:"id"`
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
}

func newRuntimeListener(t *testing.T) net.Listener {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	return listener
}

func newTestManager(t *testing.T, endpoint string) *ConnectionManager {
	t.Helper()
	manager, err := NewConnectionManager(ManagerConfig{Launcher: fakeLauncher{result: ServeResult{Status: "ready", TCPEndpoint: endpoint}}})
	if err != nil {
		t.Fatal(err)
	}
	return manager
}

func readTestMessage(t *testing.T, reader *bufio.Reader) testMessage {
	t.Helper()
	line, err := reader.ReadBytes('\n')
	if err != nil {
		t.Errorf("read request: %v", err)
		return testMessage{}
	}
	var message testMessage
	if err := json.Unmarshal(line, &message); err != nil {
		t.Errorf("decode request: %v", err)
	}
	return message
}

func writeTestJSON(conn net.Conn, value any) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return writeAll(conn, append(payload, '\n'))
}

// 回归测试：`suna serve --json` 启动的 daemon 会继承父进程 stdout 并长期
// 保持打开。commandJSONOutput 必须读到第一行 JSON 就返回，不能像
// exec.Cmd.Output 那样等待整个 stdout 关闭，否则健康启动会被误判为超时。
func TestCommandJSONOutputReturnsAfterFirstLineWhileChildKeepsStdoutOpen(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping subprocess test in short mode")
	}
	command := exec.Command("sh", "-c", `printf '{"status":"ready","tcp_endpoint":"127.0.0.1:7632"}\n'; sleep 5`)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	output, err := commandJSONOutput(ctx, command)
	if err != nil {
		t.Fatalf("commandJSONOutput() error = %v, want first line only", err)
	}
	var result ServeResult
	if err := json.Unmarshal(output, &result); err != nil {
		t.Fatalf("decode first line: %v", err)
	}
	if result.Status != "ready" || result.TCPEndpoint != "127.0.0.1:7632" {
		t.Fatalf("unexpected serve result: %#v", result)
	}
}

// performHello 必须拒绝所有非法握手响应：错误 JSONRPC 版本、RPC error、
// 空 result、catalog 缺少必要方法。
func TestPerformHelloRejectsInvalidResponses(t *testing.T) {
	cases := []struct {
		name  string
		frame map[string]any
		want  ErrorKind
	}{
		{
			name:  "wrong jsonrpc version",
			frame: map[string]any{"jsonrpc": "1.0", "id": 1, "result": map[string]any{"runtime_version": "test", "catalog": map[string]any{"methods": requiredCatalogMethods}}},
			want:  ErrorProtocol,
		},
		{
			name:  "rpc error response",
			frame: map[string]any{"jsonrpc": "2.0", "id": 1, "error": map[string]any{"code": -32603, "message": "unsupported"}},
			want:  ErrorCapability,
		},
		{
			name:  "empty result",
			frame: map[string]any{"jsonrpc": "2.0", "id": 1, "result": nil},
			want:  ErrorProtocol,
		},
		{
			name:  "mismatched catalog methods",
			frame: map[string]any{"jsonrpc": "2.0", "id": 1, "result": map[string]any{"runtime_version": "test", "catalog": map[string]any{"methods": []string{"session.list"}}}}, // 缺少 agent.send_message 等必需方法
			want:  ErrorCapability,
		},
		{
			name:  "missing catalog",
			frame: map[string]any{"jsonrpc": "2.0", "id": 1, "result": map[string]any{"runtime_version": "test"}},
			want:  ErrorCapability,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			client, server := net.Pipe()
			defer client.Close()
			defer server.Close()
			go func() {
				// net.Pipe 是同步的：先读 hello 请求，再写响应帧。
				reader := bufio.NewReader(server)
				_, _ = reader.ReadBytes('\n')
				payload, _ := json.Marshal(tc.frame)
				_, _ = server.Write(append(payload, '\n'))
			}()

			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			_, err := performHello(ctx, client)
			if err == nil {
				t.Fatalf("performHello() succeeded, want error kind %q", tc.want)
			}
			var rpcErr *Error
			if !errors.As(err, &rpcErr) {
				t.Fatalf("error is %T, want *runtime.Error", err)
			}
			if rpcErr.Kind != tc.want {
				t.Fatalf("error kind = %q, want %q (err=%v)", rpcErr.Kind, tc.want, err)
			}
		})
	}
}

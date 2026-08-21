package runtime

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

// Launcher starts (or locates) a Runtime server and returns its public TCP endpoint.
// Implementations must return the endpoint reported by `suna serve --json`.
type Launcher interface {
	Launch(context.Context) (ServeResult, error)
}

// CommandLauncher starts a Runtime with the public `suna serve --json` command.
// It runs the command from a neutral directory so the daemon cannot inherit the
// browser UI's project workspace as an accidental Runtime working directory.
type CommandLauncher struct {
	Binary string
}

func (l CommandLauncher) Launch(ctx context.Context) (ServeResult, error) {
	binary := strings.TrimSpace(l.Binary)
	if binary == "" {
		binary = "suna"
	}
	command := runCommand(ctx, binary, "serve", "--json")
	command.Dir = runtimeCommandDirectory()
	command.Env = withoutDaemonMode(os.Environ())
	output, err := commandJSONOutput(ctx, command)
	if err != nil {
		return ServeResult{}, &Error{Kind: ErrorUnavailable, Err: fmt.Errorf("runtime is unavailable: %w", err)}
	}
	return parseServeResult(output)
}

// withoutDaemonMode prevents the gateway from inheriting SUNA_RUN_DAEMON=1.
// That variable is only for the Runtime's child daemon process; if it leaks into
// this public discovery command, `suna serve --json` starts a daemon foreground
// process and emits no JSON endpoint.

type commandRunner func(context.Context, string, ...string) *exec.Cmd

var runCommand commandRunner = exec.CommandContext

// commandJSONOutput returns as soon as the public CLI emits its one JSON line.
// `suna serve` starts a detached daemon which inherits its parent's stdio; using
// exec.Cmd.Output would then wait for that daemon to close stdout and turn a
// healthy ready response into a Gateway timeout.
func commandJSONOutput(ctx context.Context, command *exec.Cmd) ([]byte, error) {
	stdout, err := command.StdoutPipe()
	if err != nil {
		return nil, err
	}
	command.Stderr = os.Stderr
	// GUI 子系统的 suna-app 没有控制台；不隐藏的话，Windows 会为
	// 控制台版 suna.exe 弹出一个一直不关的黑窗口。
	hideConsoleWindow(command)
	if err := command.Start(); err != nil {
		return nil, err
	}
	stop := context.AfterFunc(ctx, func() {
		_ = stdout.Close()
		_ = command.Process.Kill()
	})
	line, readErr := readNDJSONFrame(bufio.NewReader(stdout), maxServeOutputBytes)
	stopped := stop()
	waitErr := command.Wait()
	if readErr != nil {
		if ctx.Err() != nil || !stopped {
			return nil, ctx.Err()
		}
		return nil, readErr
	}
	if waitErr != nil {
		return nil, waitErr
	}
	return line, nil
}

func withoutDaemonMode(environment []string) []string {
	filtered := make([]string, 0, len(environment))
	for _, entry := range environment {
		if !strings.HasPrefix(entry, "SUNA_RUN_DAEMON=") {
			filtered = append(filtered, entry)
		}
	}
	return filtered
}

func runtimeCommandDirectory() string {
	if home, err := os.UserHomeDir(); err == nil && strings.TrimSpace(home) != "" {
		return home
	}
	return "."
}

// RPCError is an error returned by the remote JSON-RPC server. Data retains its
// JSON representation because the public protocol allows method-specific shapes.
type RPCError struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data,omitempty"`
}

func (e *RPCError) Error() string {
	if e == nil {
		return ""
	}
	if e.Code == 0 {
		return e.Message
	}
	return fmt.Sprintf("runtime JSON-RPC error %d: %s", e.Code, e.Message)
}

// Kind 返回 Runtime 结构化错误的稳定分类（data.kind）。
// 它只存在于公开协议中；无法解析时返回空字符串。
func (e *RPCError) Kind() string {
	if e == nil || len(e.Data) == 0 {
		return ""
	}
	var data struct {
		Kind string `json:"kind"`
	}
	if err := json.Unmarshal(e.Data, &data); err != nil {
		return ""
	}
	return data.Kind
}

// Notification is a server-originated JSON-RPC notification.
type Notification struct {
	Method string
	Params json.RawMessage
}

// ManagerConfig controls connections created by a ConnectionManager. Zero-valued
// Dial and Hello timeouts use the caller's context without adding a timeout. Launch
// is shared across callers and runs independently of their contexts; LaunchTimeout
// is its optional manager-wide bound.
type ManagerConfig struct {
	Launcher           Launcher
	DialContext        func(context.Context, string, string) (net.Conn, error)
	LaunchTimeout      time.Duration
	DialTimeout        time.Duration
	HelloTimeout       time.Duration
	ClientName         string
	ClientVersion      string
	ClientType         string
	MaxFrameBytes      int
	NotificationBuffer int
}

// ConnectionManager establishes public Runtime JSON-RPC connections.
type ConnectionManager struct {
	config ManagerConfig

	// launchMu 保护公开 CLI 的发现结果。Gateway 内多个浏览器请求可共用同一
	// Runtime endpoint；只有 TCP 拨号失败时才丢弃它并重新调用 serve --json。
	launchMu         sync.Mutex
	launchResult     ServeResult
	hasLaunch        bool
	launchGeneration uint64
	launchInFlight   *launchFlight
}

type launchFlight struct {
	done       chan struct{}
	generation uint64
	result     ServeResult
	err        error
}

func NewConnectionManager(config ManagerConfig) (*ConnectionManager, error) {
	if config.Launcher == nil {
		return nil, fmt.Errorf("runtime launcher is required")
	}
	if config.MaxFrameBytes < 0 || config.NotificationBuffer < 0 {
		return nil, fmt.Errorf("runtime connection buffer sizes cannot be negative")
	}
	if config.MaxFrameBytes == 0 {
		config.MaxFrameBytes = maxRuntimeFrameBytes
	}
	if config.NotificationBuffer == 0 {
		config.NotificationBuffer = 64
	}
	if config.ClientName == "" {
		config.ClientName = "suna-app"
	}
	if config.ClientVersion == "" {
		config.ClientVersion = "dev"
	}
	if config.ClientType == "" {
		config.ClientType = "web_gateway"
	}
	return &ConnectionManager{config: config}, nil
}

// Connect launches the Runtime, connects only to its loopback endpoint, and
// completes runtime.hello before returning a usable connection.
func (m *ConnectionManager) Connect(ctx context.Context) (*Connection, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	result, err := m.launch(ctx)
	if err != nil {
		return nil, err
	}

	dialCtx, cancelDial := withOptionalTimeout(ctx, m.config.DialTimeout)
	defer cancelDial()
	dial := m.config.DialContext
	if dial == nil {
		var dialer net.Dialer
		dial = dialer.DialContext
	}
	conn, err := dial(dialCtx, "tcp", result.TCPEndpoint)
	if err != nil {
		m.invalidateLaunch(result)
		return nil, &Error{Kind: ErrorUnavailable, Err: fmt.Errorf("runtime connection is unavailable: %w", err)}
	}

	helloCtx, cancelHello := withOptionalTimeout(ctx, m.config.HelloTimeout)
	reader := bufio.NewReaderSize(conn, minReaderBuffer(m.config.MaxFrameBytes))
	hello, err := performConnectionHello(helloCtx, conn, reader, m.config.MaxFrameBytes, m.config)
	if err != nil {
		cancelHello()
		_ = conn.Close()
		var runtimeErr *Error
		if errors.As(err, &runtimeErr) && runtimeErr.Kind != ErrorCapability {
			m.invalidateLaunch(result)
		}
		return nil, err
	}
	cancelHello()

	c := &Connection{
		conn:          conn,
		reader:        reader,
		maxFrameBytes: m.config.MaxFrameBytes,
		pending:       make(map[uint64]chan rpcReply),
		hello:         hello,
		notifications: make(chan Notification, m.config.NotificationBuffer),
		writeToken:    make(chan struct{}, 1),
		done:          make(chan struct{}),
		nextID:        2, // ID 1 is reserved for runtime.hello.
	}
	c.writeToken <- struct{}{}
	go c.readLoop()
	return c, nil
}

// Probe verifies the current Runtime endpoint with the same shared discovery
// path as browser bridges. It intentionally closes the short probe connection.
func (m *ConnectionManager) Probe(ctx context.Context) (HelloResult, error) {
	connection, err := m.Connect(ctx)
	if err != nil {
		return HelloResult{}, err
	}
	defer connection.Close()
	var hello struct {
		RuntimeVersion string          `json:"runtime_version"`
		Catalog        protocolCatalog `json:"catalog"`
	}
	if err := json.Unmarshal(connection.Hello(), &hello); err != nil {
		return HelloResult{}, &Error{Kind: ErrorProtocol, Err: fmt.Errorf("runtime returned an invalid handshake response")}
	}
	// 与 performHello 一致，按 catalog 必需方法校验能力。
	for _, m := range requiredCatalogMethods {
		if !hello.Catalog.HasMethod(m) {
			return HelloResult{}, &Error{Kind: ErrorCapability, Err: fmt.Errorf("runtime does not support required method %q", m)}
		}
	}
	return HelloResult{RuntimeVersion: hello.RuntimeVersion, Catalog: hello.Catalog}, nil
}

func (m *ConnectionManager) launch(ctx context.Context) (ServeResult, error) {
	for {
		if err := ctx.Err(); err != nil {
			return ServeResult{}, err
		}

		m.launchMu.Lock()
		if m.hasLaunch {
			result := m.launchResult
			m.launchMu.Unlock()
			return result, nil
		}
		flight := m.launchInFlight
		created := flight == nil
		if created {
			flight = &launchFlight{done: make(chan struct{}), generation: m.launchGeneration}
			m.launchInFlight = flight
		}
		m.launchMu.Unlock()

		if created {
			// Discovery is shared work rather than work owned by this caller. Its
			// context must therefore not be canceled when this caller gives up.
			go m.runLaunch(flight)
		}

		select {
		case <-ctx.Done():
			return ServeResult{}, ctx.Err()
		case <-flight.done:
		}

		m.launchMu.Lock()
		stale := m.launchGeneration != flight.generation
		result, err := flight.result, flight.err
		m.launchMu.Unlock()

		// RefreshDiscovery invalidates every result from the prior generation.
		// No caller may dial an endpoint that it has declared stale, including
		// the caller that started the shared discovery flight.
		if stale {
			continue
		}
		return result, err
	}
}

func (m *ConnectionManager) runLaunch(flight *launchFlight) {
	launchCtx, cancel := withOptionalTimeout(context.Background(), m.config.LaunchTimeout)
	result, err := m.config.Launcher.Launch(launchCtx)
	cancel()
	if err == nil {
		if result.Status != "ready" || strings.TrimSpace(result.TCPEndpoint) == "" {
			err = &Error{Kind: ErrorProtocol, Err: fmt.Errorf("runtime returned an unsupported startup response")}
		} else if host, _, splitErr := net.SplitHostPort(result.TCPEndpoint); splitErr != nil || !isLoopbackHost(host) {
			err = &Error{Kind: ErrorProtocol, Err: fmt.Errorf("runtime returned an unsupported startup response")}
		}
	}
	if err != nil {
		var runtimeErr *Error
		if !errors.As(err, &runtimeErr) {
			err = &Error{Kind: ErrorUnavailable, Err: fmt.Errorf("runtime is unavailable: %w", err)}
		}
	}

	m.launchMu.Lock()
	if err == nil && m.launchGeneration == flight.generation {
		m.launchResult = result
		m.hasLaunch = true
	}
	flight.result = result
	flight.err = err
	if m.launchInFlight == flight {
		m.launchInFlight = nil
	}
	close(flight.done)
	m.launchMu.Unlock()
}

func (m *ConnectionManager) invalidateLaunch(result ServeResult) {
	m.launchMu.Lock()
	defer m.launchMu.Unlock()
	if m.hasLaunch && m.launchResult.TCPEndpoint == result.TCPEndpoint {
		m.hasLaunch = false
	}
}

// RefreshDiscovery forgets a stale endpoint after a long-lived transport fails.
// Per protocol reconnect rules, the next browser connect must call serve --json
// again to obtain the daemon's current authoritative loopback endpoint.
func (m *ConnectionManager) RefreshDiscovery() {
	m.launchMu.Lock()
	m.launchGeneration++
	m.hasLaunch = false
	m.launchMu.Unlock()
}

// Connection is a multiplexed, long-lived NDJSON JSON-RPC connection.
type Connection struct {
	conn          net.Conn
	reader        *bufio.Reader
	maxFrameBytes int

	writeToken chan struct{}

	pendingMu sync.Mutex
	pending   map[uint64]chan rpcReply
	nextID    uint64
	hello     json.RawMessage

	notifications chan Notification
	done          chan struct{}
	closeOnce     sync.Once
	closeErrMu    sync.Mutex
	closeErr      error
}

type rpcReply struct {
	result json.RawMessage
	err    error
}

// Notifications returns server notifications. Delivery is non-blocking; if this
// bounded channel is full, a notification is dropped rather than stalling RPC
// response processing.
func (c *Connection) Notifications() <-chan Notification { return c.notifications }

// Hello returns an immutable copy of the negotiated public Runtime handshake.
func (c *Connection) Hello() json.RawMessage {
	return append(json.RawMessage(nil), c.hello...)
}

// Done is closed once the connection has terminated.
func (c *Connection) Done() <-chan struct{} { return c.done }

// Close terminates the socket, releases all waiting calls, and closes notification
// delivery. It is safe to call more than once.
func (c *Connection) Close() error {
	c.terminate(net.ErrClosed)
	return nil
}

// Request invokes method and returns its unprocessed JSON result.
func (c *Connection) Request(ctx context.Context, method string, params any) (json.RawMessage, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if strings.TrimSpace(method) == "" {
		return nil, fmt.Errorf("runtime JSON-RPC method is required")
	}
	id, replyCh, err := c.registerPending()
	if err != nil {
		return nil, err
	}

	payload, err := json.Marshal(struct {
		JSONRPC string `json:"jsonrpc"`
		ID      uint64 `json:"id"`
		Method  string `json:"method"`
		Params  any    `json:"params"`
	}{JSONRPC: "2.0", ID: id, Method: method, Params: params})
	if err != nil {
		c.removePending(id)
		return nil, fmt.Errorf("marshal runtime JSON-RPC request: %w", err)
	}
	if err := c.write(ctx, append(payload, '\n')); err != nil {
		c.removePending(id)
		return nil, err
	}

	select {
	case reply := <-replyCh:
		return reply.result, reply.err
	default:
	}
	select {
	case reply := <-replyCh:
		return reply.result, reply.err
	case <-ctx.Done():
		c.removePending(id)
		return nil, ctx.Err()
	case <-c.done:
		// 读循环可能已投递响应后才发现对端关闭；优先保留该响应。
		select {
		case reply := <-replyCh:
			return reply.result, reply.err
		default:
			return nil, c.terminalError()
		}
	}
}

// Call decodes a JSON-RPC result into result. result must be a non-nil pointer.
func (c *Connection) Call(ctx context.Context, method string, params any, result any) error {
	raw, err := c.Request(ctx, method, params)
	if err != nil {
		return err
	}
	if result == nil {
		return nil
	}
	if err := json.Unmarshal(raw, result); err != nil {
		return fmt.Errorf("decode runtime JSON-RPC result: %w", err)
	}
	return nil
}

// Call is a typed convenience wrapper for a Connection request.
func Call[T any](ctx context.Context, c *Connection, method string, params any) (T, error) {
	var result T
	if c == nil {
		return result, fmt.Errorf("runtime connection is nil")
	}
	if err := c.Call(ctx, method, params, &result); err != nil {
		return result, err
	}
	return result, nil
}

// Notify sends a JSON-RPC notification without waiting for a response.
func (c *Connection) Notify(ctx context.Context, method string, params any) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if strings.TrimSpace(method) == "" {
		return fmt.Errorf("runtime JSON-RPC method is required")
	}
	payload, err := json.Marshal(struct {
		JSONRPC string `json:"jsonrpc"`
		Method  string `json:"method"`
		Params  any    `json:"params"`
	}{JSONRPC: "2.0", Method: method, Params: params})
	if err != nil {
		return fmt.Errorf("marshal runtime JSON-RPC notification: %w", err)
	}
	return c.write(ctx, append(payload, '\n'))
}

func (c *Connection) registerPending() (uint64, chan rpcReply, error) {
	c.pendingMu.Lock()
	defer c.pendingMu.Unlock()
	select {
	case <-c.done:
		return 0, nil, c.terminalError()
	default:
	}
	if c.nextID == math.MaxUint64 {
		return 0, nil, fmt.Errorf("runtime JSON-RPC request ID exhausted")
	}
	id := c.nextID
	c.nextID++
	ch := make(chan rpcReply, 1)
	c.pending[id] = ch
	return id, ch, nil
}

func (c *Connection) removePending(id uint64) {
	c.pendingMu.Lock()
	delete(c.pending, id)
	c.pendingMu.Unlock()
}

// 写入令牌让并发调用按帧串行化，避免 NDJSON 帧相互交错。
func (c *Connection) write(ctx context.Context, payload []byte) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-c.done:
		return c.terminalError()
	case <-c.writeToken:
	}
	defer func() { c.writeToken <- struct{}{} }()

	// 上下文取消时设置写截止时间，保证阻塞写不会遗留在后台。
	stopCancelDeadline := context.AfterFunc(ctx, func() { _ = c.conn.SetWriteDeadline(time.Now()) })
	if deadline, ok := ctx.Deadline(); ok {
		_ = c.conn.SetWriteDeadline(deadline)
	} else {
		_ = c.conn.SetWriteDeadline(time.Time{})
	}
	err := writeAll(c.conn, payload)
	stopped := stopCancelDeadline()
	_ = c.conn.SetWriteDeadline(time.Time{})
	if err != nil {
		if ctx.Err() != nil || !stopped {
			return ctx.Err()
		}
		c.terminate(&Error{Kind: ErrorUnavailable, Err: fmt.Errorf("runtime connection write failed: %w", err)})
		return c.terminalError()
	}
	return nil
}

func (c *Connection) readLoop() {
	for {
		line, err := readNDJSONFrame(c.reader, c.maxFrameBytes)
		if err != nil {
			if errors.Is(err, io.EOF) || errors.Is(err, net.ErrClosed) {
				c.terminate(&Error{Kind: ErrorUnavailable, Err: fmt.Errorf("runtime connection closed")})
			} else {
				c.terminate(&Error{Kind: ErrorProtocol, Err: fmt.Errorf("runtime sent an invalid JSON-RPC frame: %w", err)})
			}
			return
		}
		if err := c.dispatch(line); err != nil {
			c.terminate(&Error{Kind: ErrorProtocol, Err: err})
			return
		}
	}
}

func (c *Connection) dispatch(line []byte) error {
	var message struct {
		JSONRPC string          `json:"jsonrpc"`
		ID      json.RawMessage `json:"id"`
		Method  string          `json:"method"`
		Params  json.RawMessage `json:"params"`
		Result  json.RawMessage `json:"result"`
		Error   *RPCError       `json:"error"`
	}
	if err := json.Unmarshal(line, &message); err != nil || message.JSONRPC != "2.0" {
		return fmt.Errorf("invalid JSON-RPC message")
	}
	if len(message.ID) == 0 {
		if message.Method == "" {
			return fmt.Errorf("message is neither a response nor notification")
		}
		select {
		case c.notifications <- Notification{Method: message.Method, Params: message.Params}:
			return nil
		default:
			// 不允许静默丢弃 Runtime 事件；事件无法排队时关闭连接，浏览器会重新 attach 并以 snapshot 恢复权威状态。
			return fmt.Errorf("runtime notification backpressure")
		}
	}
	var id uint64
	if err := json.Unmarshal(message.ID, &id); err != nil || id == 0 {
		return fmt.Errorf("response has a non-integer ID")
	}
	if message.Method != "" || (message.Error == nil && len(message.Result) == 0) || (message.Error != nil && len(message.Result) != 0) {
		return fmt.Errorf("invalid JSON-RPC response")
	}
	c.pendingMu.Lock()
	ch, ok := c.pending[id]
	if ok {
		delete(c.pending, id)
	}
	c.pendingMu.Unlock()
	if ok {
		var replyErr error
		if message.Error != nil {
			replyErr = message.Error
		}
		ch <- rpcReply{result: message.Result, err: replyErr}
	}
	return nil
}

func (c *Connection) terminate(err error) {
	c.closeOnce.Do(func() {
		c.closeErrMu.Lock()
		c.closeErr = err
		c.closeErrMu.Unlock()
		_ = c.conn.Close()

		c.pendingMu.Lock()
		for id, ch := range c.pending {
			delete(c.pending, id)
			ch <- rpcReply{err: err}
		}
		c.pendingMu.Unlock()
		close(c.done)
		close(c.notifications)
	})
}

func (c *Connection) terminalError() error {
	c.closeErrMu.Lock()
	defer c.closeErrMu.Unlock()
	if c.closeErr != nil {
		return c.closeErr
	}
	return net.ErrClosed
}

func performConnectionHello(ctx context.Context, conn net.Conn, reader *bufio.Reader, maxFrame int, config ManagerConfig) (json.RawMessage, error) {
	request := struct {
		JSONRPC string `json:"jsonrpc"`
		ID      uint64 `json:"id"`
		Method  string `json:"method"`
		Params  struct {
			Client struct {
				Name    string `json:"name"`
				Version string `json:"version"`
				Type    string `json:"type"`
			} `json:"client"`
		} `json:"params"`
	}{JSONRPC: "2.0", ID: 1, Method: "runtime.hello"}
	request.Params.Client.Name = config.ClientName
	request.Params.Client.Version = config.ClientVersion
	request.Params.Client.Type = config.ClientType
	payload, err := json.Marshal(request)
	if err != nil {
		return nil, &Error{Kind: ErrorProtocol, Err: fmt.Errorf("runtime handshake could not be created")}
	}
	if err := writeWithContext(ctx, conn, append(payload, '\n')); err != nil {
		return nil, &Error{Kind: ErrorUnavailable, Err: fmt.Errorf("runtime handshake failed: %w", err)}
	}
	line, err := readFrameWithContext(ctx, conn, reader, maxFrame)
	if err != nil {
		kind := ErrorProtocol
		if ctx.Err() != nil {
			kind = ErrorUnavailable
		}
		return nil, &Error{Kind: kind, Err: fmt.Errorf("runtime returned an invalid handshake response")}
	}
	var response struct {
		JSONRPC string          `json:"jsonrpc"`
		ID      uint64          `json:"id"`
		Result  json.RawMessage `json:"result"`
		Error   *RPCError       `json:"error"`
	}
	if err := json.Unmarshal(line, &response); err != nil || response.JSONRPC != "2.0" || response.ID != 1 {
		return nil, &Error{Kind: ErrorProtocol, Err: fmt.Errorf("runtime returned an invalid handshake response")}
	}
	if response.Error != nil {
		return nil, &Error{Kind: ErrorCapability, Err: response.Error}
	}
	var hello struct {
		Catalog protocolCatalog `json:"catalog"`
	}
	if len(response.Result) == 0 || json.Unmarshal(response.Result, &hello) != nil {
		return nil, &Error{Kind: ErrorProtocol, Err: fmt.Errorf("runtime returned an invalid handshake response")}
	}
	// 以 catalog 声明的方法集为准，缺失任一必需方法即判定能力不足。
	for _, m := range requiredCatalogMethods {
		if !hello.Catalog.HasMethod(m) {
			return nil, &Error{Kind: ErrorCapability, Err: fmt.Errorf("runtime does not support required method %q", m)}
		}
	}
	return append(json.RawMessage(nil), response.Result...), nil
}

func readNDJSONFrame(reader *bufio.Reader, max int) ([]byte, error) {
	frame := make([]byte, 0, minReaderBuffer(max))
	for len(frame) < max {
		b, err := reader.ReadByte()
		if err != nil {
			return nil, err
		}
		if b == '\n' {
			frame = bytesTrimTrailingCR(frame)
			if len(frame) == 0 {
				return nil, fmt.Errorf("empty frame")
			}
			return frame, nil
		}
		frame = append(frame, b)
	}
	return nil, fmt.Errorf("frame exceeds %d byte limit", max)
}

func bytesTrimTrailingCR(value []byte) []byte {
	if len(value) > 0 && value[len(value)-1] == '\r' {
		return value[:len(value)-1]
	}
	return value
}

func writeWithContext(ctx context.Context, conn net.Conn, payload []byte) error {
	stop := context.AfterFunc(ctx, func() { _ = conn.SetWriteDeadline(time.Now()) })
	if deadline, ok := ctx.Deadline(); ok {
		_ = conn.SetWriteDeadline(deadline)
	}
	err := writeAll(conn, payload)
	stopped := stop()
	_ = conn.SetWriteDeadline(time.Time{})
	if err != nil && (ctx.Err() != nil || !stopped) {
		return ctx.Err()
	}
	return err
}

func readFrameWithContext(ctx context.Context, conn net.Conn, reader *bufio.Reader, max int) ([]byte, error) {
	stop := context.AfterFunc(ctx, func() { _ = conn.SetReadDeadline(time.Now()) })
	if deadline, ok := ctx.Deadline(); ok {
		_ = conn.SetReadDeadline(deadline)
	}
	line, err := readNDJSONFrame(reader, max)
	stopped := stop()
	_ = conn.SetReadDeadline(time.Time{})
	if err != nil && (ctx.Err() != nil || !stopped) {
		return nil, ctx.Err()
	}
	return line, err
}

func withOptionalTimeout(ctx context.Context, timeout time.Duration) (context.Context, context.CancelFunc) {
	if timeout > 0 {
		return context.WithTimeout(ctx, timeout)
	}
	return context.WithCancel(ctx)
}

func minReaderBuffer(max int) int {
	if max < 1024 {
		return max + 1
	}
	if max > 4096 {
		return 4096
	}
	return max + 1
}

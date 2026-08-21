package runtime

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"strings"
	"time"
)

type ErrorKind string

const (
	ErrorUnavailable ErrorKind = "unavailable"
	ErrorProtocol    ErrorKind = "protocol_error"
	ErrorCapability  ErrorKind = "capability_error"
)

// requiredCatalogMethods 是 Gateway 正常工作所必需的最小方法集。
// Runtime 以 capability catalog（catalog.methods）声明能力，Gateway 据此校验
// 而非依赖单一版本号；缺失任一必需方法即判定 capability_error。
// 方法名必须与 Runtime 公开协议一致（catalog.go 的 Method* 常量）。
var requiredCatalogMethods = []string{
	"session.list",
	"session.attach",
	"session.create",
	"agent.sendMessage",
}

type Error struct {
	Kind ErrorKind
	Err  error
}

func (e *Error) Error() string { return e.Err.Error() }
func (e *Error) Unwrap() error { return e.Err }

type ServeResult struct {
	Status      string `json:"status"`
	TCPEndpoint string `json:"tcp_endpoint"`
}

// HelloResult 携带 Runtime 握手后返回的公开能力信息，供上层决定能力门控。
type HelloResult struct {
	// RuntimeVersion 是 Runtime 自身版本号，仅用于展示。
	RuntimeVersion string
	// Catalog 是 Runtime 声明的公开能力目录（methods/notifications/features）。
	Catalog protocolCatalog
}

// protocolCatalog 镜像 Runtime 公开协议的 catalog 结构，仅取 Gateway 关心的字段。
type protocolCatalog struct {
	Methods       []string `json:"methods"`
	Notifications []string `json:"notifications"`
	Features      []string `json:"features"`
}

// HasMethod 报告 catalog 是否声明了指定方法。
func (c protocolCatalog) HasMethod(name string) bool {
	for _, m := range c.Methods {
		if m == name {
			return true
		}
	}
	return false
}

// HasFeature 报告 catalog 是否声明了指定细粒度能力。
func (c protocolCatalog) HasFeature(name string) bool {
	for _, f := range c.Features {
		if f == name {
			return true
		}
	}
	return false
}

// NewHelloResult 构造携带 catalog 的握手结果，供上层与测试构造带能力的 hello。
func NewHelloResult(runtimeVersion string, methods, notifications, features []string) HelloResult {
	return HelloResult{
		RuntimeVersion: runtimeVersion,
		Catalog: protocolCatalog{
			Methods:       append([]string(nil), methods...),
			Notifications: append([]string(nil), notifications...),
			Features:      append([]string(nil), features...),
		},
	}
}

type Client struct {
	binary         string
	commandTimeout time.Duration
	dialTimeout    time.Duration
	helloTimeout   time.Duration
}

func NewClient(binary string, commandTimeout, dialTimeout, helloTimeout time.Duration) *Client {
	return &Client{binary: binary, commandTimeout: commandTimeout, dialTimeout: dialTimeout, helloTimeout: helloTimeout}
}

func (c *Client) Probe(ctx context.Context) (HelloResult, error) {
	serveCtx, cancel := context.WithTimeout(ctx, c.commandTimeout)
	defer cancel()

	command := runCommand(serveCtx, c.binary, "serve", "--json")
	command.Dir = runtimeCommandDirectory()
	command.Env = withoutDaemonMode(os.Environ())
	output, err := commandJSONOutput(serveCtx, command)
	if err != nil {
		return HelloResult{}, &Error{Kind: ErrorUnavailable, Err: fmt.Errorf("runtime is unavailable")}
	}

	result, err := parseServeResult(output)
	if err != nil {
		return HelloResult{}, err
	}

	dialer := net.Dialer{Timeout: c.dialTimeout}
	conn, err := dialer.DialContext(ctx, "tcp", result.TCPEndpoint)
	if err != nil {
		return HelloResult{}, &Error{Kind: ErrorUnavailable, Err: fmt.Errorf("runtime connection is unavailable")}
	}
	defer conn.Close()

	helloCtx, cancelHello := context.WithTimeout(ctx, c.helloTimeout)
	defer cancelHello()
	return performHello(helloCtx, conn)
}

func parseServeResult(output []byte) (ServeResult, error) {
	var result ServeResult
	if err := json.Unmarshal(output, &result); err != nil {
		return ServeResult{}, &Error{Kind: ErrorProtocol, Err: fmt.Errorf("runtime returned an invalid startup response")}
	}
	if result.Status != "ready" || strings.TrimSpace(result.TCPEndpoint) == "" {
		return ServeResult{}, &Error{Kind: ErrorProtocol, Err: fmt.Errorf("runtime returned an unsupported startup response")}
	}
	if host, _, err := net.SplitHostPort(result.TCPEndpoint); err != nil || !isLoopbackHost(host) {
		return ServeResult{}, &Error{Kind: ErrorProtocol, Err: fmt.Errorf("runtime returned an unsupported startup response")}
	}
	return result, nil
}

func isLoopbackHost(host string) bool {
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func performHello(ctx context.Context, conn net.Conn) (HelloResult, error) {
	request := struct {
		JSONRPC string `json:"jsonrpc"`
		ID      int    `json:"id"`
		Method  string `json:"method"`
		Params  struct {
			Client struct {
				Name    string `json:"name"`
				Version string `json:"version"`
				Type    string `json:"type"`
			} `json:"client"`
		} `json:"params"`
	}{JSONRPC: "2.0", ID: 1, Method: "runtime.hello"}
	request.Params.Client.Name = "suna-app"
	request.Params.Client.Version = "dev"
	request.Params.Client.Type = "web_gateway"

	payload, err := json.Marshal(request)
	if err != nil {
		return HelloResult{}, &Error{Kind: ErrorProtocol, Err: fmt.Errorf("runtime handshake could not be created")}
	}
	if deadline, ok := ctx.Deadline(); ok {
		if err := conn.SetDeadline(deadline); err != nil {
			return HelloResult{}, &Error{Kind: ErrorUnavailable, Err: fmt.Errorf("runtime connection is unavailable")}
		}
	}
	if err := writeAll(conn, append(payload, '\n')); err != nil {
		return HelloResult{}, &Error{Kind: ErrorUnavailable, Err: fmt.Errorf("runtime connection is unavailable")}
	}

	line, err := readFrame(conn)
	if err != nil {
		if ctx.Err() != nil {
			return HelloResult{}, &Error{Kind: ErrorUnavailable, Err: fmt.Errorf("runtime handshake timed out")}
		}
		return HelloResult{}, &Error{Kind: ErrorProtocol, Err: fmt.Errorf("runtime returned an invalid handshake response")}
	}
	var response struct {
		JSONRPC string          `json:"jsonrpc"`
		ID      int             `json:"id"`
		Result  json.RawMessage `json:"result"`
		Error   *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(line, &response); err != nil || response.JSONRPC != "2.0" || response.ID != 1 {
		return HelloResult{}, &Error{Kind: ErrorProtocol, Err: fmt.Errorf("runtime returned an invalid handshake response")}
	}
	if response.Error != nil {
		return HelloResult{}, &Error{Kind: ErrorCapability, Err: fmt.Errorf("runtime does not support the required protocol")}
	}
	if len(response.Result) == 0 || string(response.Result) == "null" {
		return HelloResult{}, &Error{Kind: ErrorProtocol, Err: fmt.Errorf("runtime returned an invalid handshake response")}
	}

	var hello struct {
		RuntimeVersion string          `json:"runtime_version"`
		Catalog        protocolCatalog `json:"catalog"`
	}
	if err := json.Unmarshal(response.Result, &hello); err != nil {
		return HelloResult{}, &Error{Kind: ErrorProtocol, Err: fmt.Errorf("runtime returned an invalid handshake response")}
	}
	// 以 catalog 声明的方法集为准，缺失任一必需方法即判定能力不足。
	for _, m := range requiredCatalogMethods {
		if !hello.Catalog.HasMethod(m) {
			return HelloResult{}, &Error{Kind: ErrorCapability, Err: fmt.Errorf("runtime does not support required method %q", m)}
		}
	}
	return HelloResult{RuntimeVersion: hello.RuntimeVersion, Catalog: hello.Catalog}, nil
}

// maxRuntimeFrameBytes 是 TCP JSON-RPC 单帧上限。Runtime 的公开 TCP transport
// 不限制响应帧大小（session.attach 的完整 snapshot 可达数百 KB），Gateway 必须
// 设一个足够容纳真实响应的上限，同时防止不可信对端撑爆内存。
const maxRuntimeFrameBytes = 16 * 1024 * 1024

// maxServeOutputBytes 是 `suna serve --json` 单行 stdout 的上限；CLI 输出与
// TCP 帧不同，永远是小 JSON，使用独立的小上限。
const maxServeOutputBytes = 64 * 1024

func readFrame(conn net.Conn) ([]byte, error) {
	frame := make([]byte, 0, 4096)
	byteBuffer := make([]byte, 1)
	for len(frame) < maxRuntimeFrameBytes {
		count, err := conn.Read(byteBuffer)
		if count > 0 {
			frame = append(frame, byteBuffer[0])
			if byteBuffer[0] == '\n' {
				return frame, nil
			}
		}
		if err != nil {
			return nil, err
		}
	}
	return nil, fmt.Errorf("runtime frame exceeds limit")
}

func writeAll(conn net.Conn, payload []byte) error {
	for len(payload) > 0 {
		count, err := conn.Write(payload)
		if err != nil {
			return err
		}
		if count == 0 {
			return fmt.Errorf("runtime connection made no write progress")
		}
		payload = payload[count:]
	}
	return nil
}

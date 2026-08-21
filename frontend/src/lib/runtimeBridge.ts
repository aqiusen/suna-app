/**
 * 本地 Gateway bridge 的浏览器客户端。bridge ID 只保存在内存中；
 * Runtime 内容不可信，绝不能写入浏览器存储。
 */

export * from "./runtimeTypes";
import type {
  RuntimeBridgeMethod,
  RuntimeBridgeParams,
  RuntimeBridgeResult,
  RuntimeHello,
  RuntimeNotification,
} from "./runtimeTypes";

export class RuntimeBridgeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly options: { status?: number; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = "RuntimeBridgeError";
  }
  get status() {
    return this.options.status;
  }
  get retryable() {
    return (
      this.options.retryable ??
      (this.status === undefined || this.status >= 500)
    );
  }
}

export type RuntimeBridgeClientOptions = {
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
  eventSourceFactory?: (url: string) => EventSource;
};
export type BridgeConnection = { id: string; hello: RuntimeHello };
const ROOT = "/api/v1/bridge";
const DEFAULT_TIMEOUT_MS = 15_000;

export class RuntimeBridgeClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly eventSourceFactory: (url: string) => EventSource;
  private connection?: BridgeConnection;
  private activeSource?: EventSource;
  private reconnectTimer?: number;
  private reconnectAttempts = 0;
  private lifecycleGeneration = 0;
  private closed = false;
  private readonly baseReconnectDelayMs = 1_000;
  private readonly maxReconnectDelayMs = 30_000;

  constructor(options: RuntimeBridgeClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? "";
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.eventSourceFactory =
      options.eventSourceFactory ?? ((url) => new EventSource(url));
  }
  currentConnection(): BridgeConnection | undefined {
    return this.connection;
  }
  async connect(signal?: AbortSignal): Promise<BridgeConnection> {
    this.closed = false;
    this.cancelReconnect();
    if (this.connection) return this.connection;
    const body = await this.request(
      "POST",
      `${ROOT}/connect`,
      undefined,
      signal,
    );
    if (!isBridgeConnection(body))
      throw new RuntimeBridgeError(
        "invalid_response",
        "Gateway returned an invalid Runtime connection.",
      );
    this.connection = body;
    this.reconnectAttempts = 0;
    return body;
  }
  async disconnect(): Promise<void> {
    ++this.lifecycleGeneration;
    this.closed = true;
    this.cancelReconnect();
    this.activeSource?.close();
    this.activeSource = undefined;
    const id = this.connection?.id;
    this.connection = undefined;
    if (id) await this.deleteConnection(id);
  }
  async disconnectIfCurrent(id: string): Promise<void> {
    if (this.connection?.id !== id) return;
    ++this.lifecycleGeneration;
    this.cancelReconnect();
    this.activeSource?.close();
    this.activeSource = undefined;
    this.connection = undefined;
    await this.deleteConnection(id);
  }
  private async deleteConnection(id: string): Promise<void> {
    try {
      await this.request("DELETE", `${ROOT}/${encodeURIComponent(id)}`);
    } catch {
      /* 过期的 bridge 连接已经关闭，忽略删除失败。 */
    }
  }
  async rpc<M extends RuntimeBridgeMethod>(
    method: M,
    params: RuntimeBridgeParams<M>,
    signal?: AbortSignal,
  ): Promise<RuntimeBridgeResult<M>> {
    const id = this.connection?.id;
    if (!id)
      throw new RuntimeBridgeError(
        "not_connected",
        "Runtime is not connected.",
        { retryable: true },
      );
    const body = await this.request(
      "POST",
      `${ROOT}/${encodeURIComponent(id)}/rpc`,
      { method, params },
      signal,
    );
    if (!isRecord(body) || !("result" in body))
      throw new RuntimeBridgeError(
        "invalid_response",
        "Gateway returned an invalid Runtime response.",
      );
    return body.result as RuntimeBridgeResult<M>;
  }
  subscribe(
    onNotification: (
      notification: RuntimeNotification,
      receivedAt: number,
    ) => void,
    onError?: (error: RuntimeBridgeError) => void,
    onReconnected?: () => void | Promise<void>,
  ): () => void {
    const id = this.connection?.id;
    if (!id)
      throw new RuntimeBridgeError(
        "not_connected",
        "Runtime is not connected.",
        { retryable: true },
      );
    this.cancelReconnect();
    // 一个订阅持有一个生命周期代号；每次替换或显式断开都会使
    // 旧 EventSource 的回调失效。
    const generation = ++this.lifecycleGeneration;
    const source = this.eventSourceFactory(
      `${this.baseUrl}${ROOT}/${encodeURIComponent(id)}/events`,
    );
    this.activeSource?.close();
    this.activeSource = source;
    let intentional = false;
    let handlingError = false;
    const isCurrent = () =>
      !intentional &&
      !this.closed &&
      generation === this.lifecycleGeneration &&
      this.connection?.id === id &&
      this.activeSource === source;
    const restartStream = () => {
      if (handlingError || !isCurrent()) return;
      handlingError = true;
      source.close();
      this.activeSource = undefined;
      // Gateway bridge 可能已随 Runtime socket 被回收：不要永远重试一个
      // 不透明的 ID——先在本地撤销它，再按有界退避重连，并从 Runtime 的
      // 权威 attach 恢复状态。
      void this.dropConnection(id, generation).finally(() => {
        // dropConnection 是异步的：等待期间用户可能已连接另一个 bridge，
        // 因此这里再次校验所有权。
        if (
          generation === this.lifecycleGeneration &&
          !this.closed &&
          !this.connection
        )
          this.scheduleStreamReconnect(
            onNotification,
            onError,
            onReconnected,
            generation,
          );
      });
    };
    source.addEventListener("notification", (event) => {
      try {
        const value: unknown = JSON.parse((event as MessageEvent<string>).data);
        if (isNotification(value) && isCurrent()) {
          // 事件到达时刻：tool 计时用“解析层收到事件”的时刻，而不是
          // React setState 回调里再取 Date.now()，消除事件循环排队延迟。
          onNotification(value, Date.now());
        }
      } catch {
        if (!isCurrent()) return;
        onError?.(
          new RuntimeBridgeError(
            "invalid_event",
            "Gateway sent an invalid Runtime event.",
          ),
        );
      }
    });
    source.onerror = () => {
      // EventSource 会重试自己的流地址，但终态的 Gateway bridge 需要全新
      // 连接：短暂退避而不是在瞬时传输错误上反复触发 Runtime 发现与 attach。
      restartStream();
    };
    return () => {
      intentional = true;
      source.close();
      if (this.activeSource === source) {
        ++this.lifecycleGeneration;
        this.activeSource = undefined;
      }
    };
  }
  private async dropConnection(id: string, generation: number): Promise<void> {
    if (generation !== this.lifecycleGeneration || this.connection?.id !== id)
      return;
    this.connection = undefined;
    await this.deleteConnection(id);
  }
  private scheduleStreamReconnect(
    onNotification: (
      notification: RuntimeNotification,
      receivedAt: number,
    ) => void,
    onError?: (error: RuntimeBridgeError) => void,
    onReconnected?: () => void | Promise<void>,
    generation = this.lifecycleGeneration,
  ) {
    this.cancelReconnect();
    const exponent = Math.min(this.reconnectAttempts++, 5);
    const delay = Math.min(
      this.maxReconnectDelayMs,
      this.baseReconnectDelayMs * 2 ** exponent,
    );
    const jitter = Math.floor(Math.random() * Math.min(500, delay / 4));
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = undefined;
      if (this.closed || generation !== this.lifecycleGeneration) return;
      void this.reopenEventStream(
        onNotification,
        onError,
        onReconnected,
        generation,
      );
    }, delay + jitter);
  }
  private async reopenEventStream(
    onNotification: (
      notification: RuntimeNotification,
      receivedAt: number,
    ) => void,
    onError?: (error: RuntimeBridgeError) => void,
    onReconnected?: () => void | Promise<void>,
    generation = this.lifecycleGeneration,
  ) {
    try {
      if (this.closed || generation !== this.lifecycleGeneration) return;
      const existing = this.connection;
      if (!existing) {
        await this.connect();
        if (this.closed || generation !== this.lifecycleGeneration) {
          const replacement = this.connection;
          if (replacement) await this.disconnectIfCurrent(replacement.id);
          return;
        }
        // 新的 Gateway bridge 没有 Runtime attachment：在消费者恢复权威
        // attach 之前不打开其事件流。
        await onReconnected?.();
      }
      this.subscribe(onNotification, onError, onReconnected);
    } catch (reason) {
      const error =
        reason instanceof RuntimeBridgeError
          ? reason
          : new RuntimeBridgeError(
              "reconnect_failed",
              "Gateway connection failed.",
            );
      if (generation !== this.lifecycleGeneration || this.closed) return;
      onError?.(error);
      this.scheduleStreamReconnect(onNotification, onError, onReconnected);
    }
  }
  private cancelReconnect() {
    if (this.reconnectTimer !== undefined)
      window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }
  private async request(
    method: "POST" | "DELETE",
    path: string,
    payload?: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, {
        method,
        signal: combined,
        headers:
          payload === undefined
            ? undefined
            : {
                "Content-Type": "application/json",
                Accept: "application/json",
              },
        body: payload === undefined ? undefined : JSON.stringify(payload),
      });
    } catch {
      throw new RuntimeBridgeError(
        combined.aborted ? "timeout" : "network_error",
        "Gateway connection failed.",
      );
    }
    if (response.status === 204) return undefined;
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new RuntimeBridgeError(
        "invalid_response",
        "Gateway returned an invalid response.",
        { status: response.status },
      );
    }
    if (!response.ok) {
      const error =
        isRecord(body) && isRecord(body.error) ? body.error : undefined;
      throw new RuntimeBridgeError(
        typeof error?.code === "string" ? error.code : "request_failed",
        typeof error?.message === "string"
          ? error.message
          : "Runtime request failed.",
        { status: response.status },
      );
    }
    return body;
  }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isBridgeConnection(value: unknown): value is BridgeConnection {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isRecord(value.hello) &&
    typeof value.hello.runtime_version === "string" &&
    typeof value.hello.transport === "string" &&
    isRecord(value.hello.catalog) &&
    Array.isArray(value.hello.catalog.methods) &&
    Array.isArray(value.hello.catalog.notifications) &&
    Array.isArray(value.hello.catalog.features) &&
    isRecord(value.hello.content_sources)
  );
}
function isNotification(value: unknown): value is RuntimeNotification {
  return (
    isRecord(value) && typeof value.method === "string" && "params" in value
  );
}

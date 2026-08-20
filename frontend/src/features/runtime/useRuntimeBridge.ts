import { useCallback, useEffect, useRef, useState } from "react";

import {
  RuntimeBridgeClient,
  RuntimeBridgeError,
  type BridgeConnection,
  type RuntimeBridgeClientOptions,
  type RuntimeBridgeMethod,
  type RuntimeBridgeParams,
  type RuntimeBridgeResult,
  type RuntimeHello,
  type RuntimeNotification,
} from "../../lib/runtimeBridge";

export type RuntimeBridgeStatus =
  "disconnected" | "connecting" | "connected" | "disconnecting" | "error";

export type UseRuntimeBridgeOptions = Pick<
  RuntimeBridgeClientOptions,
  "baseUrl" | "timeoutMs" | "fetch" | "eventSourceFactory"
> & {
  /** 通知按到达即投递，本 hook 不保留任何事件。
   * receivedAt 为解析层收到事件的时刻（工具计时用）。 */
  onNotification?: (
    notification: RuntimeNotification,
    receivedAt: number,
  ) => void;
  onEventError?: (error: RuntimeBridgeError) => void;
  onReconnected?: () => void | Promise<void>;
};

export type RuntimeBridgeHook = {
  status: RuntimeBridgeStatus;
  id?: string;
  hello?: RuntimeHello;
  error?: RuntimeBridgeError;
  connected: boolean;
  connect: () => Promise<BridgeConnection>;
  reconnect: () => Promise<BridgeConnection>;
  disconnect: () => Promise<void>;
  rpc: <M extends RuntimeBridgeMethod>(
    method: M,
    params: RuntimeBridgeParams<M>,
    signal?: AbortSignal,
  ) => Promise<RuntimeBridgeResult<M>>;
};

/**
 * 为一个已挂载的 React 消费者持有单个临时 Gateway bridge。不使用
 * localStorage/sessionStorage，也不收集事件；调用方只渲染自己需要的
 * Runtime 状态。
 */
export function useRuntimeBridge(
  options: UseRuntimeBridgeOptions = {},
): RuntimeBridgeHook {
  const clientRef = useRef<RuntimeBridgeClient | undefined>(undefined);
  if (!clientRef.current) {
    clientRef.current = new RuntimeBridgeClient(options);
  }

  const notificationCallbackRef = useRef(options.onNotification);
  const eventErrorCallbackRef = useRef(options.onEventError);
  const reconnectedCallbackRef = useRef(options.onReconnected);
  notificationCallbackRef.current = options.onNotification;
  eventErrorCallbackRef.current = options.onEventError;
  reconnectedCallbackRef.current = options.onReconnected;

  const unsubscribeRef = useRef<(() => void) | undefined>(undefined);
  const connectAbortRef = useRef<AbortController | undefined>(undefined);
  const generationRef = useRef(0);
  const mountedRef = useRef(true);
  const [status, setStatus] = useState<RuntimeBridgeStatus>("disconnected");
  const [connection, setConnection] = useState<BridgeConnection>();
  const [error, setError] = useState<RuntimeBridgeError>();

  const invalidateGeneration = useCallback(() => {
    ++generationRef.current;
  }, []);

  const closeEvents = useCallback(() => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = undefined;
  }, []);

  const connect = useCallback(async (): Promise<BridgeConnection> => {
    const client = clientRef.current!;
    const existing = client.currentConnection();
    if (existing) return existing;
    const generation = generationRef.current + 1;
    invalidateGeneration();
    connectAbortRef.current?.abort();
    closeEvents();
    const controller = new AbortController();
    connectAbortRef.current = controller;
    if (mountedRef.current) {
      setStatus("connecting");
      setError(undefined);
    }

    try {
      const nextConnection = await client.connect(controller.signal);
      if (generation !== generationRef.current || !mountedRef.current) {
        await client.disconnectIfCurrent(nextConnection.id);
        throw new RuntimeBridgeError(
          "aborted",
          "Runtime connection was superseded.",
          { retryable: false },
        );
      }
      unsubscribeRef.current = client.subscribe(
        (notification, receivedAt) =>
          notificationCallbackRef.current?.(notification, receivedAt),
        (eventError) => {
          if (mountedRef.current && generation === generationRef.current) {
            setError(eventError);
          }
          eventErrorCallbackRef.current?.(eventError);
        },
        () => reconnectedCallbackRef.current?.(),
      );
      setConnection(nextConnection);
      setStatus("connected");
      return nextConnection;
    } catch (reason) {
      const bridgeError = toBridgeError(reason);
      if (mountedRef.current && generation === generationRef.current) {
        setConnection(undefined);
        setStatus(bridgeError.code === "aborted" ? "disconnected" : "error");
        if (bridgeError.code !== "aborted") setError(bridgeError);
      }
      throw bridgeError;
    } finally {
      if (connectAbortRef.current === controller)
        connectAbortRef.current = undefined;
    }
  }, [closeEvents, invalidateGeneration]);

  const disconnect = useCallback(async (): Promise<void> => {
    invalidateGeneration();
    connectAbortRef.current?.abort();
    connectAbortRef.current = undefined;
    closeEvents();
    if (mountedRef.current) setStatus("disconnecting");
    try {
      await clientRef.current!.disconnect();
    } catch (reason) {
      const bridgeError = toBridgeError(reason);
      if (mountedRef.current) setError(bridgeError);
      throw bridgeError;
    } finally {
      if (mountedRef.current) {
        setConnection(undefined);
        setStatus("disconnected");
      }
    }
  }, [closeEvents, invalidateGeneration]);

  const reconnect = useCallback(async (): Promise<BridgeConnection> => {
    await disconnect();
    return connect();
  }, [connect, disconnect]);

  const rpc = useCallback(
    <M extends RuntimeBridgeMethod>(
      method: M,
      params: RuntimeBridgeParams<M>,
      signal?: AbortSignal,
    ) => clientRef.current!.rpc(method, params, signal),
    [],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      invalidateGeneration();
      connectAbortRef.current?.abort();
      closeEvents();
      // 尽力而为：页面卸载时浏览器可能终止此请求。
      void clientRef.current!.disconnect().catch(() => undefined);
    };
  }, [closeEvents, invalidateGeneration]);

  return {
    status,
    id: connection?.id,
    hello: connection?.hello,
    error,
    connected: status === "connected",
    connect,
    reconnect,
    disconnect,
    rpc,
  };
}

function toBridgeError(reason: unknown): RuntimeBridgeError {
  if (reason instanceof RuntimeBridgeError) return reason;
  return new RuntimeBridgeError(
    "unknown_error",
    "Runtime bridge request failed.",
  );
}

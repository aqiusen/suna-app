import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "../../components/ui/Toast";
import { t } from "../../lib/i18n";
import type {
  MCPServerInfo,
  RuntimeConfig,
  RuntimeNotification,
  SessionInfo,
  UsagePeriod,
} from "../../lib/runtimeBridge";
import { useRuntimeBridge } from "./useRuntimeBridge";
import { useDeltaQueue } from "./useDeltaQueue";
import { createNotificationHandler } from "./runtimeEvents";
import { createSessionActions } from "./sessionActions";
import { blankActive, flowFromSnapshot } from "./sessionState";
import type { ActiveData } from "./sessionState";

/**
 * 会话工作区核心状态 hook：管理 Runtime bridge、会话目录、当前 attach、
 * 事件流、叙事流 delta 与会话操作，向 UI 提供完整工作台状态。
 */
export function useRuntimeSession() {
  const { toast } = useToast();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [active, setActive] = useState<ActiveData>(blankActive);
  const [error, setError] = useState<string>();
  const [usage, setUsage] = useState<UsagePeriod>();
  const [config, setConfig] = useState<RuntimeConfig>();
  const [syncing, setSyncing] = useState(false);
  // handoffRole：当前会话中我是 host（创建/拥有）还是 guest（加入别人的）。
  // idle 会话无法从 Runtime 得知 owner，因此用前端记忆判断。
  const [handoffRole, setHandoffRole] = useState<"host" | "guest">("host");
  const hostSessionIdsRef = useRef<Set<string>>(new Set());
  const selectedIdRef = useRef<string | undefined>(undefined);
  const restoreRef = useRef<(() => Promise<void>) | undefined>(undefined);
  const attachIntentRef = useRef(0);
  const restoreIntentRef = useRef(0);
  const listIntentRef = useRef(0);
  const sessionsRevisionRef = useRef(0);
  const attachQueueRef = useRef(Promise.resolve());
  const syncingRef = useRef(false);
  const scopeRef = useRef<
    | {
        attach: number;
        sessionId: string;
        runId?: string;
      }
    | undefined
  >(undefined);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const setSyncBoundary = useCallback((value: boolean) => {
    syncingRef.current = value;
    setSyncing(value);
  }, []);

  // 流式 delta 批处理（按到达顺序写入叙事流）。
  const deltaQueue = useDeltaQueue({
    setActive,
    getScope: () => scopeRef.current,
    setScope: (scope) => {
      scopeRef.current = scope;
    },
    isSyncing: () => syncingRef.current,
  });
  const { queueDelta, flushDeltas, resetQueuedDeltas } = deltaQueue;

  const mergeSession = useCallback((session: SessionInfo) => {
    sessionsRevisionRef.current++;
    setSessions((list) => {
      const found = list.some((item) => item.id === session.id);
      return (
        found
          ? list.map((item) => (item.id === session.id ? session : item))
          : [session, ...list]
      ).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    });
  }, []);
  // 运行终态兜底：run 事件到达时直接把目录中 session 置为 idle。
  // 正常路径下 session.updated 通知也会更新目录，但重连窗口内可能
  // 丢失该通知；以 run 终态事件为准可避免 observer 卡在运行中。
  const markSessionIdle = useCallback((sessionId?: string) => {
    if (!sessionId) return;
    sessionsRevisionRef.current++;
    setSessions((list) =>
      list.map((item) =>
        item.id === sessionId ? { ...item, status: "idle" as const } : item,
      ),
    );
  }, []);
  // 0.4 MCP 状态快照：mcp.list 初始加载 + mcp.updated 增量覆盖，
  // 设置面板据此显示 starting / active / error 实时状态。
  const [mcpServers, setMcpServers] = useState<MCPServerInfo[]>([]);
  const mergeMcp = useCallback((server: MCPServerInfo) => {
    setMcpServers((list) => {
      const found = list.some((item) => item.name === server.name);
      return found
        ? list.map((item) => (item.name === server.name ? server : item))
        : [...list, server];
    });
  }, []);
  const acceptsSession = useCallback((sessionId?: string) => {
    const scope = scopeRef.current;
    return Boolean(
      !syncingRef.current && sessionId && scope?.sessionId === sessionId,
    );
  }, []);
  const acceptsRun = useCallback((runId?: string) => {
    const scope = scopeRef.current;
    return Boolean(
      !syncingRef.current &&
      scope &&
      (!runId || !scope.runId || scope.runId === runId),
    );
  }, []);
  const onNotification = useMemo(
    () =>
      createNotificationHandler({
        setActive,
        setConfig,
        queueDelta,
        flushDeltas,
        acceptsRun,
        acceptsSession,
        mergeSession,
        markSessionIdle,
        mergeMcp,
        getScope: () => scopeRef.current,
        isSyncing: () => syncingRef.current,
        getSelectedId: () => selectedIdRef.current,
      }),
    [
      acceptsRun,
      acceptsSession,
      flushDeltas,
      markSessionIdle,
      mergeMcp,
      mergeSession,
      queueDelta,
    ],
  );
  const onEventError = useCallback(
    (reason: Error) => setError(reason.message),
    [],
  );
  const onReconnected = useCallback(
    () => restoreRef.current?.() ?? Promise.resolve(),
    [],
  );
  const bridge = useRuntimeBridge({
    onNotification,
    onEventError,
    onReconnected,
  });
  const { connect, rpc, connected, hello, status, error: bridgeError } = bridge;

  const cap = useCallback(
    (name: string) => {
      const catalog = hello?.catalog;
      if (!catalog) return false;
      // catalog.methods 使用真实协议名（如 session.list / mcp.list / config.get）；
      // 按能力前缀匹配：name 本身、name.get、name.list 任一命中即视为可用。
      return (
        catalog.methods.includes(name) ||
        catalog.methods.includes(`${name}.get`) ||
        catalog.methods.includes(`${name}.list`) ||
        catalog.features.includes(name)
      );
    },
    [hello],
  );
  // 0.4 MCP 状态快照：mcp.list 初始加载 + mcp.updated 增量覆盖，
  // 设置面板据此显示 starting / active / error 实时状态。
  const refreshMcp = useCallback(async () => {
    if (!cap("mcp")) return;
    const result = await rpc("mcp.list", {});
    setMcpServers(result.servers);
  }, [cap, rpc]);
  const queueSessionOperation = useCallback(
    <T>(operation: () => Promise<T>) => {
      const work = attachQueueRef.current.then(operation);
      // 被拒绝的操作绝不能破坏 per-bridge 串行链。
      attachQueueRef.current = work.then(
        () => undefined,
        () => undefined,
      );
      return work;
    },
    [],
  );
  const activeScopeMatches = useCallback(
    (scope: NonNullable<typeof scopeRef.current>) => {
      const currentScope = scopeRef.current;
      return Boolean(
        !syncingRef.current &&
        currentScope &&
        currentScope.attach === scope.attach &&
        currentScope.sessionId === scope.sessionId &&
        currentScope.runId === scope.runId,
      );
    },
    [],
  );
  const loadSessions = useCallback(async () => {
    const request = ++listIntentRef.current;
    const revision = sessionsRevisionRef.current;
    const result = await rpc("session.list", {});
    const sorted = [...result.sessions].sort((a, b) =>
      b.updated_at.localeCompare(a.updated_at),
    );
    // 一次性 list 绝不能抹掉更新的 session.updated/create 状态。
    if (
      request === listIntentRef.current &&
      revision === sessionsRevisionRef.current
    )
      setSessions(sorted);
    return sorted;
  }, [rpc]);

  const attach = useCallback(
    (id: string, requireActive = false) => {
      const intent = ++attachIntentRef.current;
      resetQueuedDeltas();
      scopeRef.current = undefined;
      setSyncBoundary(true);
      setError(undefined);
      setSelectedId(id);
      setActive(blankActive());
      const work = queueSessionOperation(async () => {
        if (intent !== attachIntentRef.current) return;
        const snapshot = await rpc("session.attach", {
          session_id: id,
          ...(requireActive ? { require_active: true } : {}),
        });
        // 过期 attach 已改变 Runtime 的当前 attachment；在释放串行队列前
        // 把最后一次请求的会话放回原位。
        if (intent !== attachIntentRef.current) return;
        scopeRef.current = {
          attach: intent,
          sessionId: id,
          runId: snapshot.current_run?.run_id,
        };
        setSelectedId(id);
        // 判断当前会话中我的身份：我创建过的会话是 host，否则视为 guest。
        setHandoffRole(hostSessionIdsRef.current.has(id) ? "host" : "guest");
        setActive({
          snapshot,
          flow: flowFromSnapshot(snapshot),
          toolSummary: snapshot.tool_summary,
          pendingUsers: [],
        });
        mergeSession(snapshot.session);
      });
      return work
        .catch((reason) => {
          if (intent === attachIntentRef.current) {
            // 绝不让"看似已选中"的会话停留在无权威 attach 的状态；
            // 出错后用户可重新选择。
            scopeRef.current = undefined;
            setSelectedId(undefined);
            setActive(blankActive());
            setError(
              reason instanceof Error
                ? reason.message
                : t("action.attachFailed"),
            );
          }
          throw reason;
        })
        .finally(() => {
          if (intent === attachIntentRef.current) setSyncBoundary(false);
        });
    },
    [
      mergeSession,
      queueSessionOperation,
      resetQueuedDeltas,
      rpc,
      setSyncBoundary,
    ],
  );
  const restore = useCallback(async () => {
    const restoreIntent = ++restoreIntentRef.current;
    const attachIntent = attachIntentRef.current;
    resetQueuedDeltas();
    scopeRef.current = undefined;
    setSyncBoundary(true);
    try {
      const list = await loadSessions();
      if (
        restoreIntent !== restoreIntentRef.current ||
        attachIntent !== attachIntentRef.current
      )
        return;
      // 重连后的 bridge 没有 attachment：只恢复权威 Runtime 快照，
      // 绝不重放本地状态。
      const target =
        selectedIdRef.current &&
        list.some((item) => item.id === selectedIdRef.current)
          ? selectedIdRef.current
          : list[0]?.id;
      if (target) await attach(target);
      else {
        setSelectedId(undefined);
        setActive(blankActive());
      }
    } finally {
      if (
        restoreIntent === restoreIntentRef.current &&
        attachIntent === attachIntentRef.current
      )
        setSyncBoundary(false);
    }
  }, [attach, loadSessions, resetQueuedDeltas, setSyncBoundary]);
  useEffect(() => {
    restoreRef.current = restore;
  }, [restore]);
  const initialize = useCallback(async () => {
    try {
      setError(undefined);
      await connect();
      await restore();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("action.connectFailed"),
      );
    }
  }, [connect, restore]);
  useEffect(() => {
    void initialize();
  }, [initialize]);

  const actions = createSessionActions({
    rpc,
    queueSessionOperation,
    activeScopeMatches,
    resetQueuedDeltas,
    setActive,
    setSyncBoundary,
    setError,
    setSelectedId,
    setHandoffRole,
    scopeRef,
    attachIntentRef,
    hostSessionIdsRef,
    mergeSession,
    loadSessions,
    toast,
    isSessionActionsFrozen: () => syncing || !selectedId || !scopeRef.current,
    getSelectedId: () => selectedIdRef.current,
    isSyncing: () => syncingRef.current,
    canDelete: () => cap("session"),
  });

  // Runtime 0.3+ 的 session.updated 会全局广播轻量 Session Catalog 增量
  // （包括未 attach 的客户端），因此无需定时轮询：连接建立后由
  // session.list 取初始快照，之后靠 onNotification 里的 mergeSession 增量更新。
  useEffect(() => {
    if (!connected) return;
    void loadSessions().catch(() => undefined);
  }, [connected, loadSessions]);
  useEffect(() => {
    if (!connected) return;
    void rpc("session.usage", {})
      .then((value) => setUsage(value.today))
      .catch(() => undefined);
    if (cap("config"))
      void rpc("config.get", {})
        .then(setConfig)
        .catch(() => undefined);
  }, [cap, connected, rpc]);

  const selected = useMemo(
    () =>
      sessions.find((item) => item.id === selectedId) ??
      active.snapshot?.session,
    [active.snapshot, selectedId, sessions],
  );
  const messages = useMemo(
    () => [
      ...(active.snapshot?.messages ?? []),
      ...active.pendingUsers.map(({ content }) => ({ role: "user", content })),
    ],
    [active.pendingUsers, active.snapshot?.messages],
  );
  const canDelete = cap("session");
  const canConfig = cap("config");
  const current = active.snapshot?.current_run;
  const running =
    active.run?.state === "running" ||
    active.run?.state === "retrying" ||
    current?.status === "running" ||
    selected?.status === "running";
  const canControl = Boolean(active.run?.can_control ?? current?.can_control);
  // can_control 只在 run 活跃时有意义；idle 的 attach 客户端可以开始新回合
  // 与编辑/分离，忙碌操作由 Runtime 仲裁。
  const observer = Boolean(running && !syncing && !canControl);

  return {
    sessions,
    selectedId,
    selected,
    active,
    messages,
    usage,
    config,
    syncing,
    error,
    setError,
    observer,
    running,
    canControl,
    canDelete,
    canConfig,
    handoffRole,
    setHandoffRole,
    connect,
    rpc,
    connected,
    hello,
    status,
    bridgeError,
    cap,
    queueSessionOperation,
    attach,
    initialize,
    ...actions,
    // 设置面板需要 setConfig 更新默认模型后的本地状态。
    setConfig,
    // 0.4 MCP 状态快照与刷新。
    mcpServers,
    refreshMcp,
  };
}

export type { RuntimeNotification };

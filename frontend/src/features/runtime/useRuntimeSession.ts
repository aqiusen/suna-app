import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useToast } from "../../components/ui/Toast";
import { getDesktopToken, getGatewayBaseUrl } from "../../lib/desktopGateway";
import { t } from "../../lib/i18n";
import type {
  MCPServerInfo,
  RuntimeConfig,
  RuntimeNotification,
  SessionInfo,
  UsagePeriod,
} from "../../lib/runtimeBridge";
import { RuntimeBridgeClient } from "../../lib/runtimeBridge";
import { useRuntimeBridge } from "./useRuntimeBridge";
import { useDeltaQueue } from "./useDeltaQueue";
import { createNotificationHandler } from "./runtimeEvents";
import { createSessionActions } from "./sessionActions";
import { blankActive, flowFromSnapshot } from "./sessionState";
import type { ActiveData, Scope } from "./sessionState";

/**
 * 会话工作区核心状态 hook：管理 Runtime bridge、会话目录、当前 attach、
 * 事件流、叙事流 delta 与会话操作，向 UI 提供完整工作台状态。
 */
export function useRuntimeSession() {
  const { toast } = useToast();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [active, setActiveState] = useState<ActiveData>(blankActive);
  const [error, setError] = useState<string>();
  const [usage, setUsage] = useState<UsagePeriod>();
  const [config, setConfig] = useState<RuntimeConfig>();
  const [syncing, setSyncing] = useState(false);
  // handoffRole：当前会话中我是 host（创建/拥有）还是 guest（加入别人的）。
  // idle 会话无法从 Runtime 得知 owner，因此用前端记忆判断。
  const [handoffRole, setHandoffRole] = useState<"host" | "guest">("host");
  const hostSessionIdsRef = useRef<Set<string>>(new Set());
  const selectedIdRef = useRef<string | undefined>(undefined);
  const sessionsRef = useRef<SessionInfo[]>([]);
  const activeRef = useRef<ActiveData>(blankActive());
  const backgroundFlowIdRef = useRef(0);
  // 仅保存当前页面生命周期内每个会话的渲染投影。Runtime 仍是消息、run
  // 与工具状态的唯一权威；缓存只让用户切回时保留已看到的时间线和滚动上下文。
  const sessionViewsRef = useRef(new Map<string, ActiveData>());
  const restoreRef = useRef<(() => Promise<void>) | undefined>(undefined);
  const attachIntentRef = useRef(0);
  const restoreIntentRef = useRef(0);
  const listIntentRef = useRef(0);
  const sessionsRevisionRef = useRef(0);
  const attachQueueRef = useRef(Promise.resolve());
  const syncingRef = useRef(false);
  // 一个 Runtime connection 只能 attach 一个 session；切换前为仍在运行的
  // 旧 session 保留独立后台 connection，避免 Runtime 把切换误判为最后客户端离开。
  const backgroundClientsRef = useRef(new Map<string, RuntimeBridgeClient>());
  const backgroundClientPromisesRef = useRef(new Map<string, Promise<void>>());
  const scopeRef = useRef<
    | {
        attach: number;
        sessionId: string;
        runId?: string;
      }
    | undefined
  >(undefined);

  // 切换可连续发生在 React effect 刷新之前；状态入队时同步更新 ref 和
  // session 缓存，保证下一次切换取得的是最新流，而不是上一个 render 的副本。
  const setActive = useCallback<Dispatch<SetStateAction<ActiveData>>>(
    (value) => {
      const current = activeRef.current;
      const next = typeof value === "function" ? value(current) : value;
      activeRef.current = next;
      const id = next.snapshot?.session.id ?? selectedIdRef.current;
      if (id && (next.snapshot || next.flow.length > 0))
        sessionViewsRef.current.set(id, next);
      setActiveState(next);
    },
    [],
  );

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);
  const setRuntimeConfig = useCallback<
    Dispatch<SetStateAction<RuntimeConfig | undefined>>
  >((value) => {
    setConfig((current) =>
      normalizeRuntimeConfig(
        typeof value === "function" ? value(current) : value,
      ),
    );
  }, []);

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
        setConfig: setRuntimeConfig,
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
      setActive,
      setRuntimeConfig,
    ],
  );
  const createBackgroundNotificationHandler = useCallback(
    (sessionId: string) => {
      let scope: Scope = { attach: 0, sessionId };
      const setView: Dispatch<SetStateAction<ActiveData>> = (value) => {
        const current = sessionViewsRef.current.get(sessionId) ?? blankActive();
        sessionViewsRef.current.set(
          sessionId,
          typeof value === "function" ? value(current) : value,
        );
      };
      return createNotificationHandler({
        setActive: setView,
        setConfig: setRuntimeConfig,
        queueDelta: (kind, content, runId) => {
          if (runId && !scope.runId) scope = { ...scope, runId };
          if (runId && scope.runId !== runId) return;
          setView((value) => {
            const flow = [...value.flow];
            const last = flow.at(-1);
            if (
              last &&
              last.kind === kind &&
              !last.done &&
              (last.kind === "assistant" || last.kind === "reasoning")
            ) {
              flow[flow.length - 1] = {
                ...last,
                text: last.text + content,
              };
            } else {
              flow.push({
                kind,
                id: ++backgroundFlowIdRef.current,
                text: content,
                done: false,
              });
            }
            return { ...value, flow };
          });
        },
        flushDeltas: () => undefined,
        acceptsRun: (runId) => !runId || !scope.runId || scope.runId === runId,
        acceptsSession: (id) => id === sessionId,
        mergeSession,
        markSessionIdle: () => markSessionIdle(sessionId),
        mergeMcp,
        getScope: () => scope,
        isSyncing: () => false,
        getSelectedId: () => sessionId,
      });
    },
    [markSessionIdle, mergeMcp, mergeSession, setRuntimeConfig],
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
    baseUrl: getGatewayBaseUrl(),
    desktopToken: getDesktopToken(),
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
  const keepBackgroundAttachment = useCallback(
    (sessionId: string) => {
      const current = backgroundClientsRef.current.get(sessionId);
      if (current?.currentConnection()) return Promise.resolve();
      const pending = backgroundClientPromisesRef.current.get(sessionId);
      if (pending) return pending;

      const work = (async () => {
        const client = new RuntimeBridgeClient({
          baseUrl: getGatewayBaseUrl(),
          desktopToken: getDesktopToken(),
        });
        backgroundClientsRef.current.set(sessionId, client);
        try {
          await client.connect();
          // 先打开事件流再 attach，避免 attach 成功到 SSE 建立之间丢失运行事件。
          const handleNotification =
            createBackgroundNotificationHandler(sessionId);
          client.subscribe(
            (notification, receivedAt) => {
              // 每个后台 bridge 都有独立的渲染投影。它只存在本页内存中，
              // 切回时仍以 Runtime attach 快照校验 run_id 和消息历史。
              handleNotification(notification, receivedAt);
              if (
                notification.method === "agent.run" &&
                (notification.params.state === "done" ||
                  notification.params.state === "failed" ||
                  notification.params.state === "cancelled")
              ) {
                // 运行结束后不再占用一个 attached client。必须在事件回调中
                // 释放，不能只依赖用户再次打开该会话，否则 idle runtime 永远
                // 被后台 bridge 保活。
                markSessionIdle(sessionId);
                backgroundClientsRef.current.delete(sessionId);
                void client.disconnect().catch(() => undefined);
              }
            },
            (reason) => setError(reason.message),
            async () => {
              // SSE 重连会创建新的 Gateway connection，必须重新 attach。
              await client.rpc("session.attach", { session_id: sessionId });
            },
          );
          await client.rpc("session.attach", { session_id: sessionId });
        } catch (reason) {
          backgroundClientsRef.current.delete(sessionId);
          await client.disconnect().catch(() => undefined);
          throw reason;
        }
      })();
      backgroundClientPromisesRef.current.set(sessionId, work);
      void work.then(
        () => {
          if (backgroundClientPromisesRef.current.get(sessionId) === work)
            backgroundClientPromisesRef.current.delete(sessionId);
        },
        () => {
          if (backgroundClientPromisesRef.current.get(sessionId) === work)
            backgroundClientPromisesRef.current.delete(sessionId);
        },
      );
      return work;
    },
    [createBackgroundNotificationHandler, markSessionIdle],
  );
  const releaseBackgroundAttachment = useCallback(async (sessionId: string) => {
    const pending = backgroundClientPromisesRef.current.get(sessionId);
    if (pending) await pending.catch(() => undefined);
    const client = backgroundClientsRef.current.get(sessionId);
    backgroundClientsRef.current.delete(sessionId);
    if (client) await client.disconnect();
  }, []);
  useEffect(
    () => () => {
      for (const client of backgroundClientsRef.current.values())
        void client.disconnect();
      backgroundClientsRef.current.clear();
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
      // 重复选中当前会话只是 UI 操作，不得重新 attach。attach 会用快照替换
      // 本地流并清空 delta 队列，运行中重复调用会丢失最终回答。
      if (
        !requireActive &&
        !syncingRef.current &&
        scopeRef.current?.sessionId === id
      ) {
        setSelectedId(id);
        return Promise.resolve();
      }
      const previousSessionId = scopeRef.current?.sessionId;
      const previousSession = sessionsRef.current.find(
        (session) => session.id === previousSessionId,
      );
      const previousActive = activeRef.current;
      const previousRunActive = Boolean(
        previousSession?.status === "running" ||
        previousSession?.status === "waiting" ||
        previousSession?.status === "compacting" ||
        previousActive.snapshot?.current_run?.status === "running" ||
        previousActive.run?.state === "running" ||
        previousActive.run?.state === "retrying" ||
        previousActive.run?.state === "cancelling",
      );
      if (previousSessionId)
        sessionViewsRef.current.set(previousSessionId, previousActive);
      const intent = ++attachIntentRef.current;
      resetQueuedDeltas();
      scopeRef.current = undefined;
      setSyncBoundary(true);
      setError(undefined);
      setSelectedId(id);
      setActive(blankActive());
      const work = queueSessionOperation(async () => {
        if (intent !== attachIntentRef.current) return;
        if (previousSessionId && previousSessionId !== id && previousRunActive)
          await keepBackgroundAttachment(previousSessionId);
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
        const cached = sessionViewsRef.current.get(id);
        const restoreCachedFlow = canRestoreCachedFlow(cached, snapshot);
        setActive({
          snapshot,
          // 已结束 run 的 attach 快照不含 current_run；这不是新 run，不能
          // 用空 flow 覆盖已经看到的完整回复。只有 Runtime 明确给出不同
          // run_id 时才从快照重新恢复进行中的 buffer。
          flow: restoreCachedFlow ? cached!.flow : flowFromSnapshot(snapshot),
          toolSummary: snapshot.tool_summary,
          run: restoreCachedFlow ? cached?.run : undefined,
          usage: restoreCachedFlow ? cached?.usage : undefined,
          ask: restoreCachedFlow ? cached?.ask : undefined,
          guard: restoreCachedFlow ? cached?.guard : undefined,
          pendingUsers: cached?.pendingUsers ?? [],
          awaitingRun: restoreCachedFlow ? cached?.awaitingRun : undefined,
        });
        mergeSession(snapshot.session);
        await releaseBackgroundAttachment(id);
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
      keepBackgroundAttachment,
      queueSessionOperation,
      resetQueuedDeltas,
      rpc,
      releaseBackgroundAttachment,
      setActive,
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
  }, [attach, loadSessions, resetQueuedDeltas, setActive, setSyncBoundary]);
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
    canDelete: () => cap("session.delete"),
  });

  // Runtime 0.3+ 的 session.updated 会全局广播轻量 Session Catalog 增量
  // （包括未 attach 的客户端），因此无需定时轮询：initialize/restore 已经
  // 取过初始快照，之后靠 onNotification 里的 mergeSession 增量更新。
  useEffect(() => {
    if (!connected) return;
    void rpc("session.usage", {})
      .then((value) => setUsage(value.today))
      .catch(() => undefined);
    if (cap("config"))
      void rpc("config.get", {})
        .then(setRuntimeConfig)
        .catch(() => undefined);
  }, [cap, connected, rpc, setRuntimeConfig]);

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
  const canDelete = cap("session.delete");
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
    setConfig: setRuntimeConfig,
    // 0.4 MCP 状态快照与刷新。
    mcpServers,
    refreshMcp,
  };
}

export type { RuntimeNotification };

/**
 * Runtime 在 run 结束后不再返回 current_run。此时应复用本页缓存的完整
 * 叙事流；只有 attach 快照明确指向另一个 run 时，缓存才不再适用。
 */
export function canRestoreCachedFlow(
  cached: ActiveData | undefined,
  snapshot: NonNullable<ActiveData["snapshot"]>,
) {
  if (!cached?.flow.length) return false;
  const cachedRunId =
    cached.run?.run_id ?? cached.snapshot?.current_run?.run_id;
  const snapshotRunId = snapshot.current_run?.run_id;
  return !snapshotRunId || cachedRunId === snapshotRunId;
}

export function normalizeRuntimeConfig(
  value: RuntimeConfig | undefined,
): RuntimeConfig | undefined {
  if (!value) return value;
  const models = Array.isArray(value.models) ? value.models : [];
  return {
    ...value,
    models: models.map((model) => ({
      ...model,
      strengths: Array.isArray(model.strengths) ? model.strengths : [],
      subtask_for: Array.isArray(model.subtask_for) ? model.subtask_for : [],
    })),
  };
}

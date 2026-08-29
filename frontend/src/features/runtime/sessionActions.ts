import type { Dispatch, SetStateAction } from "react";
import type { MessagePart, SessionInfo } from "../../lib/runtimeBridge";
import { t } from "../../lib/i18n";
import type { useRuntimeBridge } from "./useRuntimeBridge";
import {
  appendFlowTurn,
  blankActive,
  flowFromSnapshot,
  messageId,
} from "./sessionState";
import type { ActiveData, QueuedMessage, Scope } from "./sessionState";

type Rpc = ReturnType<typeof useRuntimeBridge>["rpc"];

export type SessionActionDeps = {
  rpc: Rpc;
  queueSessionOperation: <T>(operation: () => Promise<T>) => Promise<T>;
  activeScopeMatches: (scope: Scope) => boolean;
  resetQueuedDeltas: () => void;
  setActive: Dispatch<SetStateAction<ActiveData>>;
  setSyncBoundary: (value: boolean) => void;
  setError: (value: string | undefined) => void;
  setSelectedId: (id: string | undefined) => void;
  scopeRef: { current: Scope | undefined };
  attachIntentRef: { current: number };
  mergeSession: (session: SessionInfo) => void;
  loadSessions: () => Promise<{ id: string }[]>;
  toast: (kind: "success" | "info" | "error", message: string) => void;
  isSessionActionsFrozen: () => boolean;
  getSelectedId: () => string | undefined;
  hasActiveRun: () => boolean;
  isSyncing: () => boolean;
  canDelete: () => boolean;
};

/**
 * 构造会话操作集合（create / send / updateModel / rename / detach / remove）。
 * 所有操作都经过串行队列、作用域校验与意图序号校验，保证并发切换安全。
 */
export function createSessionActions({
  rpc,
  queueSessionOperation,
  activeScopeMatches,
  resetQueuedDeltas,
  setActive,
  setSyncBoundary,
  setError,
  setSelectedId,
  scopeRef,
  attachIntentRef,
  mergeSession,
  loadSessions,
  toast,
  isSessionActionsFrozen,
  getSelectedId,
  hasActiveRun,
  isSyncing,
  canDelete,
}: SessionActionDeps) {
  async function create(cwd: string, title?: string) {
    const intent = ++attachIntentRef.current;
    resetQueuedDeltas();
    scopeRef.current = undefined;
    setSyncBoundary(true);
    try {
      await queueSessionOperation(async () => {
        const snapshot = await rpc("session.create", { cwd, title });
        if (intent !== attachIntentRef.current) return;
        scopeRef.current = {
          attach: intent,
          sessionId: snapshot.session.id,
          runId: snapshot.current_run?.run_id,
        };
        setSelectedId(snapshot.session.id);
        setActive({
          ...blankActive(),
          snapshot,
          flow: [],
          toolSummary: snapshot.tool_summary,
        });
        mergeSession(snapshot.session);
        toast("success", t("action.sessionCreated"));
      });
    } catch (reason) {
      if (intent === attachIntentRef.current)
        setError(
          reason instanceof Error ? reason.message : t("action.createFailed"),
        );
      throw reason;
    } finally {
      if (intent === attachIntentRef.current) setSyncBoundary(false);
    }
  }

  async function send(parts: MessagePart[]) {
    if (isSessionActionsFrozen()) return;
    const scope = scopeRef.current;
    if (!scope || scope.sessionId !== getSelectedId()) return;
    const id = messageId();
    const content =
      parts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n") || t("action.imagePlaceholder");
    // 所有输入先进本地 FIFO。运行中的消息绝不提前触碰 Runtime，只有上一个
    // run 已终态时才由 drainQueue 发送队首，保证 Q1/A1/Q2/A2 的展示顺序。
    setActive((value) => ({
      ...value,
      queuedMessages: [...value.queuedMessages, { id, content, parts }],
    }));
    if (!hasActiveRun()) await drainQueue();
  }

  async function drainQueue() {
    // 不能用 isSessionActionsFrozen：attach 的 sync 边界只锁 UI，此时
    // scope 已经指向新会话。切回 idle 会话后必须能发出缓存的队首。
    if (hasActiveRun()) return;
    const scope = scopeRef.current;
    if (!scope || scope.sessionId !== getSelectedId()) return;
    let item: QueuedMessage | undefined;
    setActive((value) => {
      if (value.queueDispatching || value.queuedMessages.length === 0)
        return value;
      item = value.queuedMessages[0];
      // 通知可能早于 sendMessage response 到达。必须在 RPC 前占住该消息的
      // 时间线槽位，避免 run/delta 被追加到别的回合或全局末尾。
      // awaitingRun 不能在这里置位：hasActiveRun 把它视为“已有任务”，
      // 会把本轮自己占用的槽位误判成上一个 run，队首永远发不出去。
      return {
        ...value,
        queueDispatching: true,
        pendingUsers: [
          ...value.pendingUsers,
          { id: item.id, content: item.content },
        ],
        flowTurns: appendFlowTurn(value, item.id),
      };
    });
    if (!item) return;
    // sendMessage 会在 RPC response 返回前发布 agent.run，并把 scope.runId 从
    // undefined 绑定为新 run。这里必须只校验 attach/session，不能把这次正常
    // 的 run 绑定误判为“切换会话”，否则队首永远不会出队。
    const stillAttachedToSession = () => {
      const current = scopeRef.current;
      return Boolean(
        !isSyncing() &&
        current &&
        current.attach === scope.attach &&
        current.sessionId === scope.sessionId,
      );
    };
    try {
      const accepted = await queueSessionOperation(async () => {
        if (!activeScopeMatches(scope))
          throw new Error(t("action.sessionSwitched"));
        // 本地 FIFO 在这个短窗口里碰到上一个 run 的 running 事件，只需
        // 保留队首等待终态；它不是发送失败，更不能向用户报“不可排队”。
        if (hasActiveRun()) return false;
        await rpc("agent.sendMessage", {
          client_msg_id: item!.id,
          parts: item!.parts,
        });
        return true;
      });
      if (!stillAttachedToSession()) return;
      if (!accepted) {
        setActive((value) => ({
          ...value,
          queueDispatching: false,
          pendingUsers: value.pendingUsers.filter(
            (pending) => pending.id !== item!.id,
          ),
          flowTurns: value.flowTurns.filter((turn) => turn.turnId !== item!.id),
          awaitingRun: undefined,
        }));
        return;
      }
      setActive((value) => ({
        ...value,
        queueDispatching: false,
        awaitingRun: true,
        queuedMessages: value.queuedMessages.filter(
          (queued) => queued.id !== item!.id,
        ),
      }));
    } catch (reason) {
      if (!stillAttachedToSession()) throw reason;
      setActive((value) => ({
        ...value,
        queueDispatching: false,
        pendingUsers: value.pendingUsers.filter(
          (pending) => pending.id !== item!.id,
        ),
        flowTurns: value.flowTurns.filter((turn) => turn.turnId !== item!.id),
        awaitingRun: undefined,
      }));
      throw reason;
    }
  }

  function removeQueued(item: QueuedMessage) {
    setActive((value) => ({
      ...value,
      queuedMessages: value.queuedMessages.filter(
        (queued) => queued.id !== item.id,
      ),
    }));
  }

  /** 调整方向只重排本地队列；cancel 的终态事件会自动 drain 新队首。 */
  async function interruptQueued(item: QueuedMessage) {
    if (isSessionActionsFrozen()) return;
    const scope = scopeRef.current;
    if (!scope) return;
    setActive((value) => ({
      ...value,
      queuedMessages: [
        item,
        ...value.queuedMessages.filter((queued) => queued.id !== item.id),
      ],
    }));
    try {
      if (hasActiveRun())
        await queueSessionOperation(() => rpc("agent.cancel", {}));
      else await drainQueue();
    } catch {
      // 调整方向依赖 cancel 终态推进队列；失败时不能静默吞掉，否则用户只会
      // 看到按钮无反应。队列保留，待 Runtime 恢复后仍可继续执行。
      const message = t("action.cancelFailed");
      setError(message);
      toast("error", message);
    }
  }

  async function updateModel(model_ref: string) {
    const scope = scopeRef.current;
    if (!scope || isSessionActionsFrozen()) return;
    const snapshot = await queueSessionOperation(async () => {
      if (!activeScopeMatches(scope))
        throw new Error(t("action.sessionSwitched"));
      return rpc("session.update", { session_id: scope.sessionId, model_ref });
    });
    if (!activeScopeMatches(scope)) return;
    setActive((value) => ({
      ...value,
      snapshot: {
        ...snapshot,
        messages: value.snapshot?.messages ?? snapshot.messages,
      },
      toolSummary: snapshot.tool_summary ?? value.toolSummary,
    }));
    mergeSession(snapshot.session);
    await loadSessions();
    toast("success", t("action.modelSwitched", { model: model_ref }));
  }

  async function rename(title: string) {
    const scope = scopeRef.current;
    if (!scope || isSessionActionsFrozen()) return false;
    try {
      const snapshot = await queueSessionOperation(async () => {
        if (!activeScopeMatches(scope))
          throw new Error(t("action.sessionSwitched"));
        return rpc("session.update", {
          session_id: scope.sessionId,
          title: title.trim() || null,
        });
      });
      // session.update 的响应只对发起它的那次 attach 有效；
      // 之后的 handoff 绝不能用它重绘快照。纯改标题时 Runtime 不带回
      // messages，必须保留当前时间线，避免主区被空快照清空。
      if (!activeScopeMatches(scope)) return false;
      setActive((value) => ({
        ...value,
        snapshot: {
          ...snapshot,
          messages: value.snapshot?.messages ?? snapshot.messages,
        },
        toolSummary: snapshot.tool_summary ?? value.toolSummary,
      }));
      mergeSession(snapshot.session);
      await loadSessions();
      toast("success", t("action.titleUpdated"));
      return true;
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : t("action.titleUpdateFailed"),
      );
      return false;
    }
  }

  async function detach() {
    if (isSyncing()) return;
    const intent = ++attachIntentRef.current;
    resetQueuedDeltas();
    scopeRef.current = undefined;
    setSyncBoundary(true);
    try {
      await queueSessionOperation(async () => {
        await rpc("session.detach", {});
        if (intent !== attachIntentRef.current) return;
        setSelectedId(undefined);
        setActive(blankActive());
        toast("info", t("action.detached"));
      });
    } catch (reason) {
      if (intent === attachIntentRef.current)
        setError(
          reason instanceof Error ? reason.message : t("action.detachFailed"),
        );
    } finally {
      if (intent === attachIntentRef.current) setSyncBoundary(false);
    }
  }

  async function remove(id: string) {
    if (isSyncing() || !canDelete()) return;
    // Runtime 拒绝删除当前 attach 的会话；删别的会话不得打断当前 attach
    // 或清空时间线，否则会误切走正在看的任务。
    const deletingCurrent = scopeRef.current?.sessionId === id;
    const intent = deletingCurrent
      ? ++attachIntentRef.current
      : attachIntentRef.current;
    if (deletingCurrent) {
      resetQueuedDeltas();
      scopeRef.current = undefined;
    }
    setSyncBoundary(true);
    try {
      await queueSessionOperation(async () => {
        if (deletingCurrent) await rpc("session.detach", {});
        await rpc("session.delete", { session_id: id });
        if (deletingCurrent && intent !== attachIntentRef.current) return;
        if (deletingCurrent) {
          setSelectedId(undefined);
          setActive(blankActive());
        }
        const list = await loadSessions();
        if (deletingCurrent && intent !== attachIntentRef.current) return;
        if (deletingCurrent && list[0]) {
          const snapshot = await rpc("session.attach", {
            session_id: list[0].id,
          });
          if (intent !== attachIntentRef.current) return;
          scopeRef.current = {
            attach: intent,
            sessionId: snapshot.session.id,
            runId: snapshot.current_run?.run_id,
          };
          setSelectedId(snapshot.session.id);
          setActive({
            ...blankActive(),
            snapshot,
            flow: flowFromSnapshot(snapshot),
            toolSummary: snapshot.tool_summary,
          });
          mergeSession(snapshot.session);
        }
        toast("success", t("action.deleted"));
      });
    } catch (reason) {
      if (!deletingCurrent || intent === attachIntentRef.current) {
        setError(
          reason instanceof Error ? reason.message : t("action.deleteFailed"),
        );
        await loadSessions().catch(() => undefined);
      }
    } finally {
      if (!deletingCurrent || intent === attachIntentRef.current)
        setSyncBoundary(false);
    }
  }

  async function deleteWorkdirSessions(cwd: string) {
    const workdir = cwd.trim();
    if (isSyncing() || !canDelete() || !workdir) return false;
    const intent = ++attachIntentRef.current;
    resetQueuedDeltas();
    setSyncBoundary(true);
    try {
      await queueSessionOperation(async () => {
        const listed = await rpc("session.list", { cwd: workdir });
        const sessionIds = [
          ...new Set(listed.sessions.map((session) => session.id)),
        ];
        const deletingCurrent = Boolean(
          scopeRef.current && sessionIds.includes(scopeRef.current.sessionId),
        );
        if (deletingCurrent) scopeRef.current = undefined;
        if (deletingCurrent) await rpc("session.detach", {});
        for (const sessionId of sessionIds)
          await rpc("session.delete", { session_id: sessionId });
        if (intent !== attachIntentRef.current) return;

        if (deletingCurrent) {
          setSelectedId(undefined);
          setActive(blankActive());
        }
        const list = await loadSessions();
        if (deletingCurrent && list[0]) {
          const snapshot = await rpc("session.attach", {
            session_id: list[0].id,
          });
          if (intent !== attachIntentRef.current) return;
          scopeRef.current = {
            attach: intent,
            sessionId: snapshot.session.id,
            runId: snapshot.current_run?.run_id,
          };
          setSelectedId(snapshot.session.id);
          setActive({
            ...blankActive(),
            snapshot,
            flow: flowFromSnapshot(snapshot),
            toolSummary: snapshot.tool_summary,
          });
          mergeSession(snapshot.session);
        }
        toast(
          "success",
          sessionIds.length > 0
            ? t("action.workdirDeleted")
            : t("action.workdirEmptyDeleted"),
        );
      });
      return true;
    } catch (reason) {
      if (intent === attachIntentRef.current) {
        setError(
          reason instanceof Error
            ? reason.message
            : t("action.workdirDeleteFailed"),
        );
        // 删除可能已经部分成功，重新读取 Runtime 目录，避免前端继续展示已删除会话。
        await loadSessions().catch(() => undefined);
      }
      return false;
    } finally {
      if (intent === attachIntentRef.current) setSyncBoundary(false);
    }
  }

  return {
    create,
    send,
    drainQueue,
    interruptQueued,
    removeQueued,
    updateModel,
    rename,
    detach,
    remove,
    deleteWorkdirSessions,
  };
}

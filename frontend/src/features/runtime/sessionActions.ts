import type { Dispatch, SetStateAction } from "react";
import type { MessagePart, SessionInfo } from "../../lib/runtimeBridge";
import { t } from "../../lib/i18n";
import type { useRuntimeBridge } from "./useRuntimeBridge";
import { flowFromSnapshot, messageId } from "./sessionState";
import type { ActiveData, Scope } from "./sessionState";

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
  setHandoffRole: (role: "host" | "guest") => void;
  scopeRef: { current: Scope | undefined };
  attachIntentRef: { current: number };
  hostSessionIdsRef: { current: Set<string> };
  mergeSession: (session: SessionInfo) => void;
  loadSessions: () => Promise<{ id: string }[]>;
  toast: (kind: "success" | "info" | "error", message: string) => void;
  isSessionActionsFrozen: () => boolean;
  getSelectedId: () => string | undefined;
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
  setHandoffRole,
  scopeRef,
  attachIntentRef,
  hostSessionIdsRef,
  mergeSession,
  loadSessions,
  toast,
  isSessionActionsFrozen,
  getSelectedId,
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
        hostSessionIdsRef.current.add(snapshot.session.id);
        setHandoffRole("host");
        setActive({
          snapshot,
          flow: [],
          toolSummary: snapshot.tool_summary,
          pendingUsers: [],
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
    setActive((value) => ({
      ...value,
      pendingUsers: [...value.pendingUsers, { id, content }],
      // 进入“等待模型”窗口：pendingUsers 会被 user_message 确认清空，
      // 而 running 要等 agent.run 才置位，用 awaitingRun 填补空档期。
      awaitingRun: true,
    }));
    try {
      await queueSessionOperation(async () => {
        if (!activeScopeMatches(scope))
          throw new Error(t("action.sessionSwitched"));
        await rpc("agent.sendMessage", { client_msg_id: id, parts });
        // idle 会话没有 run_id；发送成功后立即重新 attach，让后续
        // run-only 事件拥有权威作用域。
        const snapshot = await rpc("session.attach", {
          session_id: scope.sessionId,
        });
        if (!activeScopeMatches(scope)) return;
        scopeRef.current = {
          ...scope,
          runId: snapshot.current_run?.run_id,
        };
        setActive((value) => ({
          ...value,
          snapshot: {
            ...snapshot,
            messages: snapshot.messages ?? value.snapshot?.messages,
          },
          // 新回合开始：清空上一轮的工具卡叙事（历史工具细节由
          // toolSummary 统计兜底，避免 flow 无限累积），只恢复
          // 权威 buffer（若 Runtime 已开始流式输出）。
          flow: flowFromSnapshot(snapshot),
          // 发送前的 run 属于旧快照；由新的权威 current_run 决定控制权。
          run: undefined,
          toolSummary: snapshot.tool_summary ?? value.toolSummary,
        }));
        mergeSession(snapshot.session);
      });
    } catch (reason) {
      setActive((value) => ({
        ...value,
        pendingUsers: value.pendingUsers.filter((item) => item.id !== id),
      }));
      throw reason;
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
        setActive({ flow: [], pendingUsers: [] });
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
          setActive({ flow: [], pendingUsers: [] });
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
            snapshot,
            flow: flowFromSnapshot(snapshot),
            toolSummary: snapshot.tool_summary,
            pendingUsers: [],
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
          setActive({ flow: [], pendingUsers: [] });
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
            snapshot,
            flow: flowFromSnapshot(snapshot),
            toolSummary: snapshot.tool_summary,
            pendingUsers: [],
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
    updateModel,
    rename,
    detach,
    remove,
    deleteWorkdirSessions,
  };
}

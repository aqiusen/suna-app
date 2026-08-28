import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SetStateAction } from "react";

import type {
  MessagePart,
  SessionInfo,
  SessionSnapshot,
} from "../../lib/runtimeBridge";
import { createSessionActions, type SessionActionDeps } from "./sessionActions";
import type { ActiveData } from "./sessionState";
import { blankActive } from "./sessionState";

/**
 * 测试装置：模拟 SessionActionDeps。queueSessionOperation 直接执行传入的
 * 操作（串行队列退化为同步），setActive 直接执行函数式 updater，便于断言
 * 操作后的 active 状态。
 */
function createHarness() {
  let active: ActiveData = blankActive();
  let selectedId: string | undefined;
  const scopeRef: {
    current: { attach: number; sessionId: string; runId?: string } | undefined;
  } = { current: undefined };
  const attachIntentRef = { current: 0 };
  const hostSessionIdsRef = { current: new Set<string>() };
  const rpc = vi.fn();
  const toast = vi.fn();
  const mergeSession = vi.fn();
  const loadSessions = vi.fn(async () => [] as { id: string }[]);
  const setError = vi.fn();
  const setSelectedId = vi.fn((id: string | undefined) => {
    selectedId = id;
  });
  const setHandoffRole = vi.fn();
  const setSyncBoundary = vi.fn();
  const setActive = vi.fn((updater: SetStateAction<ActiveData>) => {
    active = typeof updater === "function" ? updater(active) : updater;
  });
  const actions = createSessionActions({
    rpc,
    queueSessionOperation: async <T>(operation: () => Promise<T>) =>
      operation(),
    activeScopeMatches: () => true,
    resetQueuedDeltas: vi.fn(),
    setActive,
    setSyncBoundary,
    setError,
    setSelectedId,
    setHandoffRole,
    scopeRef: scopeRef as unknown as SessionActionDeps["scopeRef"],
    attachIntentRef,
    hostSessionIdsRef,
    mergeSession,
    loadSessions,
    toast,
    isSessionActionsFrozen: () => false,
    getSelectedId: () => selectedId,
    isSyncing: () => false,
    canDelete: () => true,
  });
  return {
    actions,
    rpc,
    toast,
    mergeSession,
    loadSessions,
    setError,
    setSelectedId,
    setHandoffRole,
    setSyncBoundary,
    setActive,
    scopeRef,
    attachIntentRef,
    hostSessionIdsRef,
    getActive: () => active,
    select: (id: string) => {
      selectedId = id;
    },
  };
}

function snapshot(overrides: Partial<SessionInfo> = {}): SessionSnapshot {
  return {
    session: {
      id: "s1",
      cwd: "/tmp",
      message_count: 0,
      created_at: "",
      updated_at: "",
      status: "idle",
      client_count: 1,
      ...overrides,
    },
    messages: [],
  };
}

describe("createSessionActions", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a session and becomes host", async () => {
    const h = createHarness();
    h.rpc.mockResolvedValueOnce(snapshot({ id: "new-1" }));

    await h.actions.create("/tmp", "标题");

    expect(h.rpc).toHaveBeenCalledWith("session.create", {
      cwd: "/tmp",
      title: "标题",
    });
    expect(h.setHandoffRole).toHaveBeenCalledWith("host");
    expect(h.hostSessionIdsRef.current.has("new-1")).toBe(true);
    expect(h.toast).toHaveBeenCalledWith("success", "会话已创建");
    expect(h.scopeRef.current?.sessionId).toBe("new-1");
  });

  it("reports create failure without clearing selection", async () => {
    const h = createHarness();
    h.rpc.mockRejectedValueOnce(new Error("no model configured"));

    await expect(h.actions.create("/tmp")).rejects.toThrow(
      "no model configured",
    );
    expect(h.setError).toHaveBeenCalledWith("no model configured");
  });

  it("does not send when session actions are frozen", async () => {
    const h = createHarness();
    const frozen = createSessionActions({
      rpc: h.rpc,
      queueSessionOperation: async <T>(operation: () => Promise<T>) =>
        operation(),
      activeScopeMatches: () => true,
      resetQueuedDeltas: vi.fn(),
      setActive: h.setActive,
      setSyncBoundary: h.setSyncBoundary,
      setError: h.setError,
      setSelectedId: h.setSelectedId,
      setHandoffRole: h.setHandoffRole,
      scopeRef: h.scopeRef as never,
      attachIntentRef: h.attachIntentRef,
      hostSessionIdsRef: h.hostSessionIdsRef,
      mergeSession: h.mergeSession,
      loadSessions: h.loadSessions,
      toast: h.toast,
      isSessionActionsFrozen: () => true,
      getSelectedId: () => undefined,
      isSyncing: () => false,
      canDelete: () => true,
    });
    await frozen.send([{ type: "text", text: "hi" }]);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("sends a message without replacing the active stream with an attach snapshot", async () => {
    const h = createHarness();
    h.scopeRef.current = { attach: 1, sessionId: "s1" };
    h.select("s1");
    h.setActive((value) => ({
      ...value,
      snapshot: snapshot(),
      pendingUsers: [],
    }));
    h.rpc.mockResolvedValueOnce({ status: "processing" });

    await h.actions.send([{ type: "text", text: "你好" }]);

    // 发送前 pending 消息已展示。
    const pendingCalls = h.setActive.mock.calls.filter(
      (call) =>
        typeof call[0] === "function" &&
        (call[0] as (v: ActiveData) => ActiveData)(blankActive()).pendingUsers
          .length > 0,
    );
    expect(pendingCalls.length).toBeGreaterThan(0);
    // sendMessage 使用消息 id 与 parts。
    const sendCall = h.rpc.mock.calls.find(
      ([method]) => method === "agent.sendMessage",
    );
    expect(sendCall).toBeDefined();
    expect((sendCall![1] as { parts: MessagePart[] }).parts).toEqual([
      { type: "text", text: "你好" },
    ]);
    expect(h.rpc).not.toHaveBeenCalledWith("session.attach", {
      session_id: "s1",
    });
  });

  it("removes pending message when send fails", async () => {
    const h = createHarness();
    h.scopeRef.current = { attach: 1, sessionId: "s1" };
    h.select("s1");
    h.rpc.mockRejectedValueOnce(new Error("runtime disconnected"));

    await expect(
      h.actions.send([{ type: "text", text: "hi" }]),
    ).rejects.toThrow("runtime disconnected");

    // 失败后 pending 被移除。
    const finalActive = h.getActive();
    expect(finalActive.pendingUsers).toEqual([]);
  });

  it("updates model and reloads sessions", async () => {
    const h = createHarness();
    h.scopeRef.current = { attach: 1, sessionId: "s1" };
    h.rpc.mockResolvedValueOnce(
      snapshot({ model_ref: "DeepSeek/deepseek-v4-flash" }),
    );
    h.loadSessions.mockResolvedValueOnce([{ id: "s1" }]);

    await h.actions.updateModel("DeepSeek/deepseek-v4-flash");

    expect(h.rpc).toHaveBeenCalledWith("session.update", {
      session_id: "s1",
      model_ref: "DeepSeek/deepseek-v4-flash",
    });
    expect(h.toast).toHaveBeenCalledWith(
      "success",
      "已切换模型：DeepSeek/deepseek-v4-flash",
    );
    expect(h.loadSessions).toHaveBeenCalled();
  });

  it("renames the session title without clearing the transcript", async () => {
    const h = createHarness();
    h.scopeRef.current = { attach: 1, sessionId: "s1" };
    h.setActive((value) => ({
      ...value,
      snapshot: {
        ...snapshot(),
        messages: [{ role: "user", content: "hello" }],
      },
    }));
    h.rpc.mockResolvedValueOnce(snapshot({ title: "新标题" }));

    await expect(h.actions.rename("新标题")).resolves.toBe(true);

    expect(h.rpc).toHaveBeenCalledWith("session.update", {
      session_id: "s1",
      title: "新标题",
    });
    expect(h.getActive().snapshot?.messages).toEqual([
      { role: "user", content: "hello" },
    ]);
    expect(h.toast).toHaveBeenCalledWith("success", "会话标题已更新");
  });

  it("detaches from the current session", async () => {
    const h = createHarness();
    h.scopeRef.current = { attach: 1, sessionId: "s1" };
    h.rpc.mockResolvedValueOnce({ status: "detached" });

    await h.actions.detach();

    expect(h.rpc).toHaveBeenCalledWith("session.detach", {});
    expect(h.setSelectedId).toHaveBeenCalledWith(undefined);
    expect(h.toast).toHaveBeenCalledWith("info", "已离开当前会话");
  });

  it("deletes another session without detaching the current one", async () => {
    const h = createHarness();
    h.scopeRef.current = { attach: 1, sessionId: "s1" };
    h.select("s1");
    h.rpc.mockResolvedValueOnce({ deleted: true });
    h.loadSessions.mockResolvedValueOnce([{ id: "s1" }]);

    await h.actions.remove("s2");

    expect(h.rpc).toHaveBeenCalledWith("session.delete", { session_id: "s2" });
    expect(h.rpc).not.toHaveBeenCalledWith("session.detach", {});
    expect(h.scopeRef.current?.sessionId).toBe("s1");
    expect(h.setSelectedId).not.toHaveBeenCalled();
    expect(h.toast).toHaveBeenCalledWith("success", "会话已删除");
  });

  it("removes the current session and attaches to the next one", async () => {
    const h = createHarness();
    h.scopeRef.current = { attach: 1, sessionId: "s1" };
    h.rpc.mockResolvedValueOnce({ status: "detached" });
    h.rpc.mockResolvedValueOnce({ deleted: true });
    h.loadSessions.mockResolvedValueOnce([{ id: "next-1" }]);
    h.rpc.mockResolvedValueOnce(snapshot({ id: "next-1" }));

    await h.actions.remove("s1");

    expect(h.rpc).toHaveBeenCalledWith("session.delete", { session_id: "s1" });
    // 删除后自动 attach 到列表第一个会话。
    const attachCall = h.rpc.mock.calls.find(
      ([method]) => method === "session.attach",
    );
    expect(attachCall).toBeDefined();
    expect((attachCall![1] as { session_id: string }).session_id).toBe(
      "next-1",
    );
    expect(h.toast).toHaveBeenCalledWith("success", "会话已删除");
  });

  it("deletes every Runtime session in a workdir and keeps an outside current session", async () => {
    const h = createHarness();
    h.scopeRef.current = { attach: 1, sessionId: "outside" };
    h.rpc.mockResolvedValueOnce({
      sessions: [{ id: "workdir-1" }, { id: "workdir-2" }],
    });
    h.rpc.mockResolvedValueOnce({ deleted: true });
    h.rpc.mockResolvedValueOnce({ deleted: true });
    h.loadSessions.mockResolvedValueOnce([{ id: "outside" }]);

    await expect(h.actions.deleteWorkdirSessions("/project")).resolves.toBe(
      true,
    );

    expect(h.rpc).toHaveBeenNthCalledWith(1, "session.list", {
      cwd: "/project",
    });
    expect(h.rpc).toHaveBeenNthCalledWith(2, "session.delete", {
      session_id: "workdir-1",
    });
    expect(h.rpc).toHaveBeenNthCalledWith(3, "session.delete", {
      session_id: "workdir-2",
    });
    expect(h.rpc).not.toHaveBeenCalledWith("session.detach", {});
    expect(h.toast).toHaveBeenCalledWith("success", "工作目录下的会话已删除");
  });

  it("detaches and reattaches when deleting the current workdir sessions", async () => {
    const h = createHarness();
    h.scopeRef.current = { attach: 1, sessionId: "project-1" };
    h.rpc.mockResolvedValueOnce({ sessions: [{ id: "project-1" }] });
    h.rpc.mockResolvedValueOnce({ status: "detached" });
    h.rpc.mockResolvedValueOnce({ deleted: true });
    h.loadSessions.mockResolvedValueOnce([{ id: "next-1" }]);
    h.rpc.mockResolvedValueOnce(snapshot({ id: "next-1" }));

    await expect(h.actions.deleteWorkdirSessions("/project")).resolves.toBe(
      true,
    );

    expect(h.rpc).toHaveBeenNthCalledWith(1, "session.list", {
      cwd: "/project",
    });
    expect(h.rpc).toHaveBeenNthCalledWith(2, "session.detach", {});
    expect(h.rpc).toHaveBeenNthCalledWith(3, "session.delete", {
      session_id: "project-1",
    });
    expect(h.scopeRef.current?.sessionId).toBe("next-1");
  });

  it("sets awaitingRun optimistically when sending", async () => {
    const h = createHarness();
    h.select("s1");
    h.scopeRef.current = { attach: 1, sessionId: "s1" };
    // sendMessage 挂起：在 await 前验证乐观状态。
    let resolveSend: (() => void) | undefined;
    h.rpc.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSend = () => resolve({ ok: true });
        }),
    );
    const pending = h.actions.send([{ type: "text", text: "你好" }]);
    // 乐观更新已同步执行：awaitingRun=true、pendingUsers 含消息。
    expect(h.getActive().awaitingRun).toBe(true);
    expect(h.getActive().pendingUsers).toHaveLength(1);
    resolveSend!();
    await pending;
  });
});

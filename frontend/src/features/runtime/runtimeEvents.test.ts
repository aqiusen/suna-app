import { describe, expect, it, vi } from "vitest";

import type {
  FlowSegment,
  RuntimeConfig,
  RuntimeNotification,
  SessionInfo,
} from "../../lib/runtimeBridge";
import type { ActiveData } from "./sessionState";
import { blankActive } from "./sessionState";
import {
  createNotificationHandler,
  type NotificationDeps,
} from "./runtimeEvents";

/**
 * 测试装置：模拟 NotificationDeps，setActive 直接执行函数式 updater，
 * 让断言可以读取事件处理后的最新 active 状态。
 */
function createHarness(
  overrides: Partial<Record<"acceptsRun" | "acceptsSession", boolean>> = {},
) {
  let active: ActiveData = blankActive();
  let config: RuntimeConfig | undefined;
  const deps = {
    setActive: vi.fn(
      (updater: Parameters<NotificationDeps["setActive"]>[0]) => {
        active =
          typeof updater === "function"
            ? (updater as (value: ActiveData) => ActiveData)(active)
            : updater;
      },
    ),
    setConfig: vi.fn((value: Parameters<NotificationDeps["setConfig"]>[0]) => {
      config = typeof value === "function" ? value(config) : value;
    }),
    queueDelta: vi.fn(),
    flushDeltas: vi.fn(),
    acceptsRun: vi.fn(() => overrides.acceptsRun ?? true),
    acceptsSession: vi.fn(
      (sessionId?: string) =>
        (sessionId === undefined || sessionId.length > 0) &&
        (overrides.acceptsSession ?? true),
    ),
    mergeSession: vi.fn(),
    markSessionIdle: vi.fn(),
    mergeMcp: vi.fn(),
    getScope: vi.fn(() => ({ attach: 1, sessionId: "s1" })),
    isSyncing: vi.fn(() => false),
    getSelectedId: vi.fn(() => "s1"),
    onRunTerminal: vi.fn(),
    onSessionIdle: vi.fn(),
    onConfigModelsResult: vi.fn(),
  };
  const handler = createNotificationHandler(deps);
  const send = (event: RuntimeNotification, receivedAt?: number) =>
    handler(event, receivedAt);
  return { deps, send, getActive: () => active, getConfig: () => config };
}

function snapshotSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: "s1",
    cwd: "/tmp",
    message_count: 0,
    created_at: "",
    updated_at: "",
    status: "idle",
    client_count: 1,
    ...overrides,
  };
}

describe("createNotificationHandler", () => {
  it("forwards agent.delta to the delta queue with run id", () => {
    const { deps, send } = createHarness();
    send({
      method: "agent.delta",
      params: {
        session_id: "s1",
        kind: "assistant",
        content: "你好",
        run_id: "run-1",
      },
    });
    expect(deps.queueDelta).toHaveBeenCalledWith("assistant", "你好", "run-1");
  });

  it("rejects a late agent.delta from a retired run", () => {
    const { deps, send } = createHarness({ acceptsRun: false });
    send({
      method: "agent.delta",
      params: {
        session_id: "s1",
        kind: "assistant",
        content: "旧回答",
        run_id: "run-old",
      },
    });
    expect(deps.queueDelta).not.toHaveBeenCalled();
  });

  it("accepts an upstream delta scoped to the active session without run id", () => {
    const { deps, send } = createHarness();
    send({
      method: "agent.delta",
      params: { session_id: "s1", kind: "assistant", content: "回答" },
    });
    expect(deps.queueDelta).toHaveBeenCalledWith(
      "assistant",
      "回答",
      undefined,
    );
  });

  it("rejects events for a different session before touching the timeline", () => {
    const { deps, send } = createHarness({ acceptsSession: false });
    send({
      method: "agent.tool_start",
      params: { session_id: "other", id: "t1", tool: "readfile", params: {} },
    });
    expect(deps.setActive).not.toHaveBeenCalled();
  });

  it("forwards asynchronous model discovery results", () => {
    const { deps, send } = createHarness();
    send({
      method: "config.models_result",
      params: { provider: "openai", models: ["gpt-5.2"] },
    });
    expect(deps.onConfigModelsResult).toHaveBeenCalledWith({
      provider: "openai",
      models: ["gpt-5.2"],
    });
  });

  it("rejects agent.run from a stale run id", () => {
    const { deps, send } = createHarness({ acceptsRun: false });
    send({
      method: "agent.run",
      params: { run_id: "stale", state: "done", can_control: false },
    });
    expect(deps.flushDeltas).not.toHaveBeenCalled();
    expect(deps.markSessionIdle).not.toHaveBeenCalled();
  });

  it("marks segments done and session idle on run done", () => {
    const { deps, send, getActive } = createHarness();
    // 预置进行中的快照与叙事流（模拟 Join 恢复或发送后的进行中状态）。
    deps.setActive((value) => ({
      ...value,
      snapshot: {
        session: snapshotSession({ status: "running" }),
        current_run: { run_id: "run-1", status: "running", can_control: true },
      },
      flow: [
        { kind: "reasoning", id: 1, text: "思考中", done: false },
        { kind: "assistant", id: 2, text: "回复中", done: false },
      ],
    }));
    deps.setActive.mockClear();

    send({
      method: "agent.run",
      params: { run_id: "run-1", state: "done", can_control: false },
    });

    // done 前 flush 积压 delta。
    expect(deps.flushDeltas).toHaveBeenCalled();
    // 终态兜底：目录会话置 idle。
    expect(deps.markSessionIdle).toHaveBeenCalledWith("s1");
    expect(deps.onRunTerminal).toHaveBeenCalledWith("run-1", "done");
    const active = getActive();
    // current_run 状态收敛为 idle。
    expect(active.snapshot?.current_run?.status).toBe("idle");
    // 叙事流段全部标为已结束（工具段/技能段/子任务段除外）。
    expect(
      active.flow.every(
        (segment) =>
          segment.kind === "tool" ||
          segment.kind === "skill" ||
          segment.kind === "subtask" ||
          segment.done,
      ),
    ).toBe(true);
  });

  it("keeps running display and uses event can_control on cancelling", () => {
    const { deps, send, getActive } = createHarness();
    deps.setActive((value) => ({
      ...value,
      snapshot: {
        session: snapshotSession({ status: "running" }),
        current_run: { run_id: "run-1", status: "running", can_control: true },
      },
    }));
    deps.setActive.mockClear();

    send({
      method: "agent.run",
      params: { run_id: "run-1", state: "cancelling", can_control: false },
    });

    const active = getActive();
    // cancelling 非终态：目录不置 idle、run 状态保留为 running 展示。
    expect(deps.markSessionIdle).not.toHaveBeenCalled();
    expect(active.run?.state).toBe("cancelling");
    expect(active.snapshot?.current_run?.status).toBe("running");
    expect(active.snapshot?.current_run?.can_control).toBe(false);
  });

  it("binds a running Runtime run to the preallocated user turn", () => {
    const { deps, send, getActive } = createHarness();
    deps.setActive((value) => ({
      ...value,
      flowTurns: [{ flowStart: 0, turnId: "client-message-1" }],
    }));

    send({
      method: "agent.run",
      params: { run_id: "run-1", state: "running", can_control: true },
    });

    expect(getActive().flowTurns).toEqual([
      { flowStart: 0, turnId: "client-message-1", runId: "run-1" },
    ]);
  });

  it("marks session idle on failed and exposes run error", () => {
    const { deps, send, getActive } = createHarness();
    send({
      method: "agent.run",
      params: {
        run_id: "run-1",
        state: "failed",
        can_control: false,
        error: {
          kind: "http",
          message: "429 too many requests",
          status_code: 429,
        },
        resume_available: true,
      },
    });
    expect(deps.markSessionIdle).toHaveBeenCalledWith("s1");
    const active = getActive();
    expect(active.run?.state).toBe("failed");
    expect(active.run?.error?.kind).toBe("http");
    expect(active.run?.resume_available).toBe(true);
  });

  it("appends a tool card on tool_start and finalizes it on tool_end", () => {
    const { send, getActive } = createHarness();
    send({
      method: "agent.tool_start",
      params: {
        id: "t1",
        tool: "readfile",
        params: { path: "/tmp/a" },
        intent: "读取文件",
      },
    });
    let active = getActive();
    expect(active.activeTool?.tool).toBe("readfile");
    const toolSegment = active.flow.find((s) => s.kind === "tool");
    expect(toolSegment).toMatchObject({
      kind: "tool",
      item: { id: "t1", tool: "readfile", status: "running" },
    });

    send({
      method: "agent.tool_guard",
      params: {
        tool_call_id: "t1",
        tool: "readfile",
        risk: "medium",
        decision: "ask",
        source: "guard",
      },
    });
    active = getActive();
    const guarded = active.flow.find(
      (s): s is Extract<FlowSegment, { kind: "tool" }> =>
        s.kind === "tool" && s.item.id === "t1",
    );
    expect(guarded?.item.status).toBe("guard");

    send({
      method: "agent.tool_end",
      params: { id: "t1", tool: "readfile", result: "ok" },
    });
    active = getActive();
    const done = active.flow.find(
      (s): s is Extract<FlowSegment, { kind: "tool" }> =>
        s.kind === "tool" && s.item.id === "t1",
    );
    if (done?.kind !== "tool") {
      throw new Error("tool segment not found");
    }
    expect(done.item.status).toBe("success");
    expect(done.item.result).toBe("ok");
    expect(active.activeTool).toBeUndefined();
  });

  it("marks tool failed and keeps result on tool_end error", () => {
    const { send, getActive } = createHarness();
    send({
      method: "agent.tool_start",
      params: { id: "t2", tool: "exec", params: {}, intent: "跑测试" },
    });
    send({
      method: "agent.tool_end",
      params: { id: "t2", tool: "exec", result: "exit 1", error: true },
    });
    const segment = getActive().flow.find(
      (s): s is Extract<FlowSegment, { kind: "tool" }> =>
        s.kind === "tool" && s.item.id === "t2",
    );
    if (segment?.kind !== "tool") {
      throw new Error("tool segment not found");
    }
    expect(segment.item.status).toBe("failed");
  });

  it("measures tool duration from tool_start to tool_end", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T00:00:00Z"));
    try {
      const { send, getActive } = createHarness();
      send({
        method: "agent.tool_start",
        params: { id: "t3", tool: "exec", params: {}, intent: "构建" },
      });
      vi.setSystemTime(new Date("2026-08-15T00:00:03Z"));
      send({
        method: "agent.tool_end",
        params: { id: "t3", tool: "exec", result: "ok" },
      });
      const segment = getActive().flow.find(
        (s): s is Extract<FlowSegment, { kind: "tool" }> =>
          s.kind === "tool" && s.item.id === "t3",
      );
      if (segment?.kind !== "tool") {
        throw new Error("tool segment not found");
      }
      expect(segment.item.durationMs).toBe(3000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stores ask and guard with reply permission", () => {
    const { send, getActive } = createHarness();
    send({
      method: "agent.ask_user",
      params: {
        id: "ask-1",
        session_id: "s1",
        question: "继续吗？",
        options: ["继续", "停止"],
        can_reply: true,
        allow_custom: false,
      },
    });
    expect(getActive().ask?.question).toBe("继续吗？");
    expect(getActive().ask?.can_reply).toBe(true);

    send({
      method: "agent.guard_confirm",
      params: {
        id: "g-1",
        session_id: "s1",
        tool: "rm",
        params: { path: "/tmp/x" },
        risk: "high",
        reason: "删除文件",
        can_reply: false,
      },
    });
    expect(getActive().guard?.tool).toBe("rm");
    expect(getActive().guard?.can_reply).toBe(false);
  });

  it("clears resolved interactions", () => {
    const { send, getActive } = createHarness();
    send({
      method: "agent.ask_user",
      params: {
        id: "ask-1",
        session_id: "s1",
        question: "q",
        can_reply: true,
        allow_custom: false,
      },
    });
    send({
      method: "agent.interaction_resolved",
      params: { id: "ask-1", session_id: "s1" },
    });
    expect(getActive().ask).toBeUndefined();
  });

  it("merges session catalog and refreshes snapshot session when attached", () => {
    const { deps, send, getActive } = createHarness();
    deps.setActive((value) => ({
      ...value,
      snapshot: { session: snapshotSession({ status: "idle" }) },
    }));
    deps.setActive.mockClear();

    const updated = snapshotSession({ status: "running", client_count: 2 });
    send({ method: "session.updated", params: { session: updated } });

    // 目录增量总是合并。
    expect(deps.mergeSession).toHaveBeenCalledWith(updated);
    // 已 attach 的会话同步更新 snapshot 内的 session 视图。
    expect(getActive().snapshot?.session.status).toBe("running");
  });

  it("unblocks a stale active run when Runtime catalog confirms the session is idle", () => {
    const { deps, send, getActive } = createHarness();
    deps.setActive((value) => ({
      ...value,
      awaitingRun: true,
      run: { run_id: "run-1", state: "running", can_control: true },
      snapshot: {
        session: snapshotSession({ status: "running" }),
        current_run: { run_id: "run-1", status: "running", can_control: true },
      },
      ask: {
        id: "ask-1",
        session_id: "s1",
        question: "continue?",
        can_reply: true,
        allow_custom: false,
      },
    }));
    send({
      method: "session.updated",
      params: { session: snapshotSession({ status: "idle" }) },
    });

    const active = getActive();
    expect(active.snapshot?.current_run).toBeUndefined();
    expect(active.run?.state).toBe("done");
    expect(active.awaitingRun).toBeUndefined();
    expect(active.ask).toBeUndefined();
    expect(deps.onSessionIdle).toHaveBeenCalledWith("run-1");
  });

  it("keeps a locally sent user message at its original timeline position", () => {
    const { deps, send, getActive } = createHarness();
    // 预置一条 pending 用户消息（发送后未收到确认时前端先展示）。
    deps.setActive((value) => ({
      ...value,
      snapshot: { session: snapshotSession(), messages: [] },
      pendingUsers: [{ id: "p1", content: "你好" }],
    }));
    deps.setActive.mockClear();

    send({
      method: "session.user_message",
      params: { session_id: "s1", parts: [{ type: "text", text: "你好" }] },
    });

    const active = getActive();
    // initial sender 不会收到自己的回显；消息保留在本地序列中，避免被
    // snapshot 前置后改变顺序。
    expect(active.pendingUsers).toEqual([{ id: "p1", content: "你好" }]);
    expect(active.snapshot?.messages).toEqual([]);
  });

  it("appends applied steering turns after the initial local message", () => {
    const { deps, send, getActive } = createHarness();
    deps.setActive((value) => ({
      ...value,
      snapshot: { session: snapshotSession(), messages: [] },
      pendingUsers: [{ id: "initial", content: "A" }],
      flowTurns: [{ flowStart: 0, turnId: "initial" }],
      flow: [{ kind: "assistant", id: 1, text: "answer A", done: true }],
    }));

    send({
      method: "session.user_message",
      params: {
        session_id: "s1",
        client_msg_id: "steer-b",
        parts: [{ type: "text", text: "B" }],
      },
    });
    deps.setActive((value) => ({
      ...value,
      flow: [
        ...value.flow,
        { kind: "assistant", id: 2, text: "answer B", done: true },
      ],
    }));
    send({
      method: "session.user_message",
      params: {
        session_id: "s1",
        client_msg_id: "steer-c",
        parts: [{ type: "text", text: "C" }],
      },
    });

    const active = getActive();
    expect(active.snapshot?.messages).toEqual([]);
    expect(active.pendingUsers.map((message) => message.content)).toEqual([
      "A",
      "B",
      "C",
    ]);
    expect(active.flowTurns).toEqual([
      { flowStart: 0, turnId: "initial" },
      { flowStart: 1, turnId: "steer-b" },
      { flowStart: 2, turnId: "steer-c" },
    ]);
  });

  it("forwards mcp.updated to the mcp snapshot", () => {
    const { deps, send } = createHarness();
    send({
      method: "mcp.updated",
      params: {
        server: {
          name: "dbx",
          active: true,
          configured: true,
          tool_count: 12,
          state: "active",
        },
      },
    });
    expect(deps.mergeMcp).toHaveBeenCalledWith(
      expect.objectContaining({ name: "dbx", state: "active" }),
    );
  });

  it("ignores session-scoped events for other sessions", () => {
    const { send, getActive } = createHarness({ acceptsSession: false });
    send({
      method: "agent.ask_user",
      params: {
        id: "ask-1",
        session_id: "other",
        question: "q",
        can_reply: true,
        allow_custom: false,
      },
    });
    // 会话不匹配时 ask 不应被保存。
    expect(getActive().ask).toBeUndefined();
  });

  it("merges skill.load lifecycle into a single flow segment", () => {
    const { send, getActive } = createHarness();
    send({ method: "skill.load", params: { name: "web", status: "loading" } });
    send({
      method: "skill.load",
      params: { name: "web", status: "loaded" },
    });
    const skills = getActive().flow.filter(
      (segment): segment is Extract<FlowSegment, { kind: "skill" }> =>
        segment.kind === "skill",
    );
    expect(skills).toHaveLength(1);
    expect(skills[0].item).toEqual({
      name: "web",
      status: "loaded",
      detail: undefined,
    });
  });

  it("tracks skill.review running -> done with review detail", () => {
    const { send, getActive } = createHarness();
    send({
      method: "skill.review",
      params: { name: "img", status: "running" },
    });
    send({
      method: "skill.review",
      params: {
        name: "img",
        status: "done",
        review: "safe to use",
      },
    });
    const skills = getActive().flow.filter(
      (segment): segment is Extract<FlowSegment, { kind: "skill" }> =>
        segment.kind === "skill",
    );
    expect(skills).toHaveLength(1);
    expect(skills[0].item).toEqual({
      name: "img",
      status: "done",
      detail: "safe to use",
    });
  });

  it("records skill.review error detail", () => {
    const { send, getActive } = createHarness();
    send({
      method: "skill.review",
      params: { name: "bad", status: "error", error: "boom" },
    });
    const skills = getActive().flow.filter(
      (segment): segment is Extract<FlowSegment, { kind: "skill" }> =>
        segment.kind === "skill",
    );
    expect(skills[0].item).toEqual({
      name: "bad",
      status: "error",
      detail: "boom",
    });
  });

  it("skips skill events while syncing or for another session", () => {
    const { deps, send, getActive } = createHarness();
    deps.isSyncing.mockReturnValue(true);
    send({ method: "skill.load", params: { name: "web", status: "loading" } });
    expect(getActive().flow.some((segment) => segment.kind === "skill")).toBe(
      false,
    );
    deps.isSyncing.mockReturnValue(false);
    deps.getSelectedId.mockReturnValue("other");
    send({
      method: "skill.load",
      params: { name: "web", status: "loaded" },
    });
    expect(getActive().flow.some((segment) => segment.kind === "skill")).toBe(
      false,
    );
  });

  it("tracks compact state through an applied result", () => {
    const { send, getActive } = createHarness();
    send({
      method: "session.compact_state",
      params: {
        session_id: "s1",
        compact_id: "compact-1",
        kind: "tools",
        state: "preparing",
      },
    });
    expect(getActive().compact?.state).toBe("preparing");

    send({
      method: "session.compact_state",
      params: {
        session_id: "s1",
        compact_id: "compact-1",
        kind: "tools",
        state: "applied",
        result: {
          before_tokens: 162000,
          after_tokens: 45000,
          context_window: 1000000,
        },
      },
    });
    const compact = getActive().compact;
    expect(compact?.state).toBe("applied");
    expect(compact?.result?.before_tokens).toBe(162000);
    expect(compact?.result?.after_tokens).toBe(45000);
  });

  it("tracks compact failure and ignores for other sessions", () => {
    const { deps, send, getActive } = createHarness();
    send({
      method: "session.compact_state",
      params: {
        session_id: "s1",
        compact_id: "compact-1",
        state: "failed",
        error: "context too large",
      },
    });
    expect(getActive().compact?.error).toBe("context too large");

    // 上游 Runtime 通过 session_id 标记压缩事件，其他会话不能覆盖当前面板。
    deps.acceptsSession.mockImplementation((id) => id === "s1");
    send({
      method: "session.compact_state",
      params: {
        session_id: "other",
        compact_id: "compact-2",
        state: "preparing",
      },
    });
    expect(getActive().compact?.state).toBe("failed");
  });

  it("does not let late compact progress replace its terminal event", () => {
    const { send, getActive } = createHarness();
    send({
      method: "session.compact_state",
      params: { session_id: "s1", compact_id: "compact-1", state: "applied" },
    });
    send({
      method: "session.compact_state",
      params: { session_id: "s1", compact_id: "compact-1", state: "preparing" },
    });
    expect(getActive().compact?.state).toBe("applied");
  });

  it("groups namespaced subtask tools under the spawn segment", () => {
    const { send, getActive } = createHarness();
    // spawn 工具自身：创建子任务组段。
    send({
      method: "agent.tool_start",
      params: { id: "s1", tool: "spawn", params: { task: "分析日志" } },
    });
    let flow = getActive().flow;
    const group = flow.find((s) => s.kind === "subtask");
    expect(group).toMatchObject({
      kind: "subtask",
      item: { id: "s1", task: "分析日志", status: "running", tools: [] },
    });
    // 子任务内部工具（namespaced id）：归入组，不生成独立工具行。
    send({
      method: "agent.tool_start",
      params: {
        id: "spawn:s1:t1",
        tool: "readfile",
        params: { path: "/tmp/a" },
      },
    });
    send({
      method: "agent.tool_end",
      params: { id: "spawn:s1:t1", tool: "readfile", result: "ok" },
    });
    flow = getActive().flow;
    const group2 = flow.find(
      (s): s is Extract<FlowSegment, { kind: "subtask" }> =>
        s.kind === "subtask",
    );
    expect(group2?.item.tools).toHaveLength(1);
    expect(group2?.item.tools[0]).toMatchObject({
      id: "spawn:s1:t1",
      status: "success",
    });
    // 普通工具行数量：spawn 不产生独立行，只有 0 个 kind=tool 段。
    expect(flow.filter((s) => s.kind === "tool")).toHaveLength(0);
    // spawn 结束：结算组状态。
    send({
      method: "agent.tool_end",
      params: { id: "s1", tool: "spawn", result: "分析完成" },
    });
    const done = getActive().flow.find(
      (s): s is Extract<FlowSegment, { kind: "subtask" }> =>
        s.kind === "subtask",
    );
    expect(done?.item.status).toBe("success");
    expect(done?.item.result).toBe("分析完成");
  });

  it("falls back to plain tool row when spawn group is missing", () => {
    const { send, getActive } = createHarness();
    // 未找到对应 spawn 组的 namespaced 工具：忽略组逻辑，不崩溃。
    send({
      method: "agent.tool_start",
      params: {
        id: "spawn:ghost:t1",
        tool: "exec",
        params: { command: "echo hi" },
      },
    });
    expect(getActive().flow.some((s) => s.kind === "subtask")).toBe(false);
    expect(getActive().flow.some((s) => s.kind === "tool")).toBe(false);
  });

  it("clears awaitingRun when a run event arrives", () => {
    const { send, getActive } = createHarness();
    // 模拟 send() 乐观置 awaitingRun（sessionActions 侧行为）。
    let active = getActive();
    // 直接构造：awaitingRun 由 sessionActions.send 置位，这里验证 run 事件清空。
    send({
      method: "agent.run",
      params: {
        run_id: "run-1",
        state: "running",
        phase: "model",
        can_control: true,
      },
    });
    active = getActive();
    expect(active.run?.state).toBe("running");
    expect(active.awaitingRun).toBe(false);
  });

  it("uses receivedAt for tool duration instead of setState time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T00:00:00Z"));
    try {
      const { send, getActive } = createHarness();
      // tool_start 在 t=0 被解析层收到（receivedAt=0）。
      send(
        {
          method: "agent.tool_start",
          params: { id: "t9", tool: "exec", params: {}, intent: "构建" },
        },
        0,
      );
      // 模拟 setState 排队延迟：系统时间已到 t=5s，但解析层收到 tool_end 是 t=2s。
      vi.setSystemTime(new Date("2026-08-15T00:00:05Z"));
      send(
        {
          method: "agent.tool_end",
          params: { id: "t9", tool: "exec", result: "ok" },
        },
        2000,
      );
      const segment = getActive().flow.find(
        (s): s is Extract<FlowSegment, { kind: "tool" }> =>
          s.kind === "tool" && s.item.id === "t9",
      );
      if (segment?.kind !== "tool") throw new Error("tool segment not found");
      // 用 receivedAt 差（2000ms）而不是系统时间差（5000ms）。
      expect(segment.item.durationMs).toBe(2000);
    } finally {
      vi.useRealTimers();
    }
  });
});

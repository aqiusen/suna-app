import { describe, expect, it } from "vitest";

import type { SessionSnapshot } from "../../lib/runtimeBridge";
import {
  blankActive,
  flowFromSnapshot,
  shouldKeepBackgroundRun,
} from "./sessionState";
import {
  mergeCompactState,
  parseCompactState,
  restorableCompactState,
  restoreSnapshotMessages,
} from "./snapshotState";

describe("blankActive", () => {
  it("returns an empty narrative flow and no pending users", () => {
    const active = blankActive();
    expect(active.flow).toEqual([]);
    expect(active.pendingUsers).toEqual([]);
    expect(active.snapshot).toBeUndefined();
    expect(active.run).toBeUndefined();
  });
});

describe("shouldKeepBackgroundRun", () => {
  it("keeps the background attach while a send is in flight", () => {
    expect(
      shouldKeepBackgroundRun({
        ...blankActive(),
        queueDispatching: true,
        pendingUsers: [{ id: "m1", content: "你好" }],
      }),
    ).toBe(true);
    expect(
      shouldKeepBackgroundRun({
        ...blankActive(),
        awaitingRun: true,
        pendingUsers: [{ id: "m1", content: "你好" }],
      }),
    ).toBe(true);
  });

  it("does not keep an idle session with no in-flight send", () => {
    expect(shouldKeepBackgroundRun(blankActive(), "idle")).toBe(false);
  });
});

describe("flowFromSnapshot", () => {
  it("recovers reasoning and assistant buffers as unfinished segments", () => {
    const snapshot: SessionSnapshot = {
      session: {
        id: "s1",
        cwd: "/tmp",
        message_count: 0,
        created_at: "",
        updated_at: "",
        status: "running",
        client_count: 2,
      },
      current_run: {
        run_id: "run-1",
        status: "running",
        phase: "model",
        can_control: false,
        reasoning_buffer: "正在分析问题…",
        assistant_buffer: "好的，我来处理。",
      },
    };
    const flow = flowFromSnapshot(snapshot);
    // 顺序：reasoning 在前、assistant 在后；都是未结束段（运行中 Join 恢复用）。
    expect(flow).toHaveLength(2);
    expect(flow[0]).toMatchObject({
      kind: "reasoning",
      text: "正在分析问题…",
      done: false,
    });
    expect(flow[1]).toMatchObject({
      kind: "assistant",
      text: "好的，我来处理。",
      done: false,
    });
  });

  it("recovers only reasoning when assistant buffer is empty", () => {
    const snapshot: SessionSnapshot = {
      session: {
        id: "s1",
        cwd: "/tmp",
        message_count: 0,
        created_at: "",
        updated_at: "",
        status: "running",
        client_count: 1,
      },
      current_run: {
        run_id: "run-1",
        status: "running",
        can_control: false,
        reasoning_buffer: "思考中…",
      },
    };
    const flow = flowFromSnapshot(snapshot);
    expect(flow).toHaveLength(1);
    expect(flow[0]).toMatchObject({ kind: "reasoning", text: "思考中…" });
  });

  it("returns an empty flow for an idle attach even when completed history exists", () => {
    const snapshot: SessionSnapshot = {
      session: {
        id: "s1",
        cwd: "/tmp",
        message_count: 2,
        created_at: "",
        updated_at: "",
        status: "idle",
        client_count: 1,
      },
      messages: [
        { role: "user", content: "first question" },
        { role: "assistant", content: "completed reply" },
      ],
    };
    // 已完成文本属于 snapshot.messages；把它再变成 flow 会在切回会话时重复。
    expect(flowFromSnapshot(snapshot)).toEqual([]);
  });
});

describe("restoreSnapshotMessages", () => {
  it("pairs persisted tool results with calls and keeps assistant order", () => {
    const timeline = restoreSnapshotMessages(
      [
        { role: "user", content: "Inspect this" },
        {
          role: "assistant",
          content: "I will inspect two files.",
          tool_calls: [
            { id: "call-a", name: "readfile", arguments: '{"path":"a.ts"}' },
            {
              id: "call-b",
              name: "exec",
              arguments: '{"command":"pnpm test"}',
            },
          ],
        },
        {
          role: "tool",
          content: "test output",
          tool_call_id: "call-b",
          tool_status: "failed",
        },
        {
          role: "tool",
          content: "file contents",
          tool_call_id: "call-a",
          tool_status: "completed",
          truncated: true,
        },
      ],
      "idle",
    );

    expect(timeline.map(({ role }) => role)).toEqual(["user", "assistant"]);
    expect(timeline[1]?.historicalTools).toEqual([
      expect.objectContaining({
        id: "call-a",
        params: { path: "a.ts" },
        result: "file contents",
        resultTruncated: true,
        status: "success",
      }),
      expect.objectContaining({
        id: "call-b",
        result: "test output",
        status: "failed",
        error: true,
      }),
    ]);
  });

  it("restores compacted tool observations without inventing arguments or IDs", () => {
    const timeline = restoreSnapshotMessages([
      {
        role: "assistant",
        content: "I checked the repository.",
        observed_tools: [
          { name: "readfile", intent: "Inspect source", status: "completed" },
          { name: "exec", status: "failed" },
        ],
      },
    ]);
    const items = timeline[0]?.historicalTools;
    expect(items).toHaveLength(2);
    expect(items?.[0]).toMatchObject({
      tool: "readfile",
      intent: "Inspect source",
      status: "success",
      compacted: true,
    });
    expect(items?.[1]).toMatchObject({
      tool: "exec",
      status: "failed",
      compacted: true,
    });
    expect(items?.[0]).not.toHaveProperty("params");
    expect(items?.[0]).not.toHaveProperty("result");
    expect(items?.[0]?.id).toMatch(/^snapshot-observed:/);
  });

  it("keeps unknown tool states neutral and bounds UTF-8 result display", () => {
    const content = `${"a".repeat(16 * 1024 - 1)}😀tail`;
    const timeline = restoreSnapshotMessages([
      {
        role: "assistant",
        content: "",
        tool_calls: [{ id: "call", name: "exec", arguments: "invalid" }],
      },
      {
        role: "tool",
        content,
        tool_call_id: "call",
        tool_status: "future-status",
      },
      { role: 7, content: "malformed" },
    ]);
    const item = timeline[0]?.historicalTools?.[0];
    expect(item?.status).toBe("unknown");
    expect(item?.params).toEqual({ raw: "invalid" });
    expect(item?.result).toBe("a".repeat(16 * 1024 - 1));
    expect(item?.resultTruncated).toBe(true);
  });
});

describe("mergeCompactState", () => {
  const event = (state: "preparing" | "ready" | "applied") => ({
    session_id: "s1",
    compact_id: "compact-1",
    state,
  });

  it("keeps the furthest state and never regresses a terminal result", () => {
    expect(mergeCompactState(event("ready"), event("preparing")).state).toBe(
      "ready",
    );
    expect(mergeCompactState(event("applied"), event("ready")).state).toBe(
      "applied",
    );
  });

  it("accepts a different compact operation", () => {
    const next = { ...event("preparing"), compact_id: "compact-2" };
    expect(mergeCompactState(event("applied"), next)).toEqual(next);
  });
});

describe("parseCompactState", () => {
  it("rejects malformed Runtime data and only restores in-flight snapshots", () => {
    expect(parseCompactState({ state: "preparing" })).toBeUndefined();
    expect(
      parseCompactState({
        session_id: "s1",
        compact_id: "c1",
        state: "unknown",
      }),
    ).toBeUndefined();
    expect(
      parseCompactState({
        session_id: "s1",
        compact_id: "c1",
        state: "applied",
        result: { before_tokens: "many", after_tokens: 10, context_window: 20 },
      }),
    ).toBeUndefined();
    const ready = {
      session_id: "s1",
      compact_id: "c1",
      state: "ready",
    } as const;
    expect(restorableCompactState(ready)).toEqual(ready);
    expect(
      restorableCompactState({ ...ready, state: "applied" }),
    ).toBeUndefined();
  });
});

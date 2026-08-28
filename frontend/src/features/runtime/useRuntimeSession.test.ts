import { describe, expect, it } from "vitest";
import type { RuntimeConfig } from "../../lib/runtimeBridge";
import {
  canRestoreCachedFlow,
  normalizeRuntimeConfig,
} from "./useRuntimeSession";
import type { ActiveData } from "./sessionState";

describe("normalizeRuntimeConfig", () => {
  it("normalizes Runtime nil slices before UI reads array length", () => {
    const config = normalizeRuntimeConfig({
      active_model: "",
      models: null,
    } as unknown as RuntimeConfig);

    expect(config?.models).toEqual([]);
  });

  it("normalizes optional model list fields", () => {
    const config = normalizeRuntimeConfig({
      active_model: "example/model",
      models: [
        {
          provider: "example",
          protocol: "openai_chat",
          model: "model",
          strengths: null,
          subtask_for: null,
        },
      ],
    } as unknown as RuntimeConfig);

    expect(config?.models[0]?.strengths).toEqual([]);
    expect(config?.models[0]?.subtask_for).toEqual([]);
  });
});

describe("canRestoreCachedFlow", () => {
  it("keeps a completed response when attach has no current run", () => {
    const cached: ActiveData = {
      flow: [{ kind: "assistant", id: 1, text: "completed reply", done: true }],
      pendingUsers: [],
      snapshot: {
        session: {
          id: "s1",
          cwd: "/tmp",
          message_count: 2,
          created_at: "",
          updated_at: "",
          status: "idle",
          client_count: 1,
        },
        current_run: { run_id: "run-1", status: "idle", can_control: false },
      },
    };
    const snapshot = { ...cached.snapshot!, current_run: undefined };

    expect(canRestoreCachedFlow(cached, snapshot)).toBe(true);
  });

  it("does not reuse a cache from a different active run", () => {
    const cached: ActiveData = {
      flow: [{ kind: "assistant", id: 1, text: "old", done: false }],
      pendingUsers: [],
      run: { run_id: "run-1", state: "running", can_control: true },
    };
    const snapshot = {
      session: {
        id: "s1",
        cwd: "/tmp",
        message_count: 2,
        created_at: "",
        updated_at: "",
        status: "running" as const,
        client_count: 1,
      },
      current_run: {
        run_id: "run-2",
        status: "running" as const,
        can_control: true,
      },
    };

    expect(canRestoreCachedFlow(cached, snapshot)).toBe(false);
  });
});

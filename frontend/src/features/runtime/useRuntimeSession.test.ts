import { describe, expect, it } from "vitest";
import type { RuntimeConfig } from "../../lib/runtimeBridge";
import { normalizeRuntimeConfig } from "./useRuntimeSession";

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

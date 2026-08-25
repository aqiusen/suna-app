import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadHiddenProjects,
  loadLocalProjects,
  saveHiddenProjects,
  saveLocalProjects,
} from "./projectStore";

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("projectStore", () => {
  it("persists project names and source folders", () => {
    saveLocalProjects({
      "/workspace/app": {
        name: "App",
        sourceFolders: ["/workspace/app", "/workspace/shared"],
      },
    });

    expect(loadLocalProjects()).toEqual({
      "/workspace/app": {
        name: "App",
        sourceFolders: ["/workspace/app", "/workspace/shared"],
      },
    });
  });

  it("loads hidden project paths as a set", () => {
    saveHiddenProjects(new Set(["/workspace/app", "/workspace/shared"]));

    expect(loadHiddenProjects()).toEqual(
      new Set(["/workspace/app", "/workspace/shared"]),
    );
  });

  it("ignores malformed project records", () => {
    localStorage.setItem(
      "suna-app:local-projects",
      JSON.stringify({
        broken: { sourceFolders: ["", 42] },
        valid: { name: "Valid", sourceFolders: ["/workspace/valid"] },
      }),
    );

    expect(loadLocalProjects()).toEqual({
      valid: { name: "Valid", sourceFolders: ["/workspace/valid"] },
    });
  });
});

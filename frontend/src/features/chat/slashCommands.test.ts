import { describe, expect, it } from "vitest";
import type { SkillInfo } from "../../lib/runtimeTypes";
import {
  insertSkillDraft,
  invokedSkillName,
  matchingSkills,
  registeredSlashCommand,
  runtimeSkillPrompt,
  slashMenuItems,
  slashSuggestions,
} from "./slashCommands";

const available = new Set(["/skills", "/compact", "/new", "/config"]);
const skills: SkillInfo[] = [
  {
    name: "agent-browser",
    description: "Browse the web",
    enabled: true,
    valid: true,
    scope: "project",
    path: "/repo/.agents/skills/agent-browser",
  },
  {
    name: "review",
    description: "Review a pull request",
    enabled: false,
    valid: true,
    scope: "global",
    can_toggle: true,
  },
];

describe("slashCommands", () => {
  it("suggests prefix matches but hides the exact command", () => {
    expect(slashSuggestions("/", available).map((item) => item.cmd)).toEqual([
      "/new",
      "/compact",
      "/skills",
      "/config",
    ]);
    expect(slashSuggestions("/sk", available).map((item) => item.cmd)).toEqual([
      "/skills",
    ]);
    expect(slashSuggestions("/skills", available)).toEqual([]);
  });

  it("matches skills while typing a slash name", () => {
    expect(matchingSkills("/agent", skills).map((item) => item.name)).toEqual([
      "agent-browser",
    ]);
    expect(matchingSkills("/skills", skills).map((item) => item.name)).toEqual([
      "agent-browser",
      "review",
    ]);
  });

  it("mixes commands and skills in the slash menu", () => {
    const items = slashMenuItems("/a", available, skills);
    expect(items.some((item) => item.kind === "skill")).toBe(true);
  });

  it("inserts a Codex skill mention and expands it for Runtime", () => {
    expect(insertSkillDraft("agent-browser")).toBe("$agent-browser ");
    expect(invokedSkillName("$agent-browser 打开页面")).toBe("agent-browser");
    expect(runtimeSkillPrompt("$agent-browser 打开页面", skills)).toContain(
      'Skill "agent-browser"',
    );
    expect(runtimeSkillPrompt("$agent-browser 打开页面", skills)).toContain(
      "打开页面",
    );
    expect(runtimeSkillPrompt("$agent-browser 打开页面", skills)).toContain(
      "skill_load",
    );
  });

  it("recognizes registered commands without sending them as chat", () => {
    expect(registeredSlashCommand("/skills", available)).toBe("/skills");
    expect(registeredSlashCommand("/unknown", available)).toBeUndefined();
  });
});

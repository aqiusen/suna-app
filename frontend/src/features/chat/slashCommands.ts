import type { SkillInfo } from "../../lib/runtimeTypes";

/** 与 TUI AllCommands 对齐的本地 slash 命令。未知 /text 仍作为普通消息发送。 */
export type SlashCommand = {
  cmd: string;
  descKey: string;
};

export type SlashItem =
  | { kind: "command"; command: SlashCommand }
  | { kind: "skill"; skill: SkillInfo };

export const SLASH_COMMANDS: SlashCommand[] = [
  { cmd: "/new", descKey: "slash.new" },
  { cmd: "/compact", descKey: "slash.compact" },
  { cmd: "/model", descKey: "slash.model" },
  { cmd: "/skills", descKey: "slash.skills" },
  { cmd: "/mcp", descKey: "slash.mcp" },
  { cmd: "/memory", descKey: "slash.memory" },
  { cmd: "/config", descKey: "slash.config" },
];

const MAX_SUGGESTIONS = 10;

export function isSlashDraft(input: string) {
  return input.startsWith("/") && !input.slice(1).includes(" ");
}

export function slashQuery(input: string) {
  if (!isSlashDraft(input)) return undefined;
  return input.slice(1).toLowerCase();
}

export function slashSuggestions(
  input: string,
  available: ReadonlySet<string>,
  max = MAX_SUGGESTIONS,
): SlashCommand[] {
  if (!isSlashDraft(input)) return [];
  const items: SlashCommand[] = [];
  for (const command of SLASH_COMMANDS) {
    if (
      available.has(command.cmd) &&
      command.cmd.startsWith(input) &&
      command.cmd !== input
    ) {
      items.push(command);
      if (items.length === max) break;
    }
  }
  return items;
}

export function matchingSkills(input: string, skills: SkillInfo[], max = 8) {
  const query = slashQuery(input);
  if (query === undefined) return [];
  const browsing = query === "" || query === "skills";
  const valid = skills.filter((skill) => skill.valid !== false);
  const matched = browsing
    ? valid
    : valid.filter((skill) => {
        const name = skill.name.toLowerCase();
        const description = (skill.description ?? "").toLowerCase();
        return name.includes(query) || description.includes(query);
      });
  return matched.slice(0, max);
}

export function slashMenuItems(
  input: string,
  available: ReadonlySet<string>,
  skills: SkillInfo[],
): SlashItem[] {
  const commands = slashSuggestions(input, available).map((command) => ({
    kind: "command" as const,
    command,
  }));
  const query = slashQuery(input);
  if (query === undefined) return commands;
  const remaining = Math.max(0, MAX_SUGGESTIONS - commands.length);
  const skillsItems = matchingSkills(input, skills, remaining).map((skill) => ({
    kind: "skill" as const,
    skill,
  }));
  return [...commands, ...skillsItems];
}

export function registeredSlashCommand(
  input: string,
  available: ReadonlySet<string>,
): string | undefined {
  const first = input.trim().split(/\s+/)[0];
  if (!first || !available.has(first)) return undefined;
  return first;
}

export function skillMention(name: string) {
  return `$${name}`;
}

export function insertSkillDraft(name: string) {
  return `${skillMention(name)} `;
}

const SKILL_MENTION = /^\$([a-zA-Z][\w-]*)(?:\s+|$)/;

export function invokedSkillName(draft: string) {
  const match = draft.trim().match(SKILL_MENTION);
  return match?.[1];
}

/** 仅把当前 Runtime 可用的 `$skill` 作为可视化调用标记。 */
export function activeSkillMention(draft: string, skills: SkillInfo[]) {
  const name = invokedSkillName(draft);
  return name && skills.some((skill) => skill.name === name)
    ? skillMention(name)
    : undefined;
}

function canToggleSkill(skill: SkillInfo) {
  return skill.scope !== "project" && skill.can_toggle !== false;
}

export function skillNeedingEnable(
  draft: string,
  skills: SkillInfo[],
): SkillInfo | undefined {
  const name = invokedSkillName(draft);
  if (!name) return undefined;
  const skill = skills.find((item) => item.name === name);
  if (!skill || skill.enabled || !canToggleSkill(skill)) return undefined;
  return skill;
}

/** 把 Codex 式 `$name` 提及变成 Runtime 能执行的 skill_load 指令。 */
export function runtimeSkillPrompt(draft: string, skills: SkillInfo[]) {
  const trimmed = draft.trim();
  const match = trimmed.match(SKILL_MENTION);
  if (!match) return trimmed;
  const name = match[1]!;
  const skill = skills.find((item) => item.name === name);
  const rest = trimmed.slice(match[0].length).trim();
  if (!skill) return trimmed;
  const scope = skill.scope === "project" ? "project" : "global";
  const path =
    scope === "project" && skill.path ? `, path \`${skill.path}\`` : "";
  const header = `The user invoked Skill "${name}" (scope=${scope}${path}). Call skill_load with those exact values from Available Skills before doing anything else.`;
  return rest ? `${header}\n\n${rest}` : header;
}

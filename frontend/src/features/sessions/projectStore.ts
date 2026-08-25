export type LocalProject = {
  name: string;
  sourceFolders: string[];
};

const PROJECTS_KEY = "suna-app:local-projects";
const HIDDEN_KEY = "suna-app:hidden-projects";

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

export function loadLocalProjects(): Record<string, LocalProject> {
  const parsed = readJson(PROJECTS_KEY);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const projects: Record<string, LocalProject> = {};
  for (const [cwd, value] of Object.entries(parsed)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const record = value as Record<string, unknown>;
    const sourceFolders = Array.isArray(record.sourceFolders)
      ? record.sourceFolders.filter(
          (folder): folder is string =>
            typeof folder === "string" && Boolean(folder.trim()),
        )
      : [];
    if (sourceFolders.length > 0)
      projects[cwd] = {
        name: typeof record.name === "string" ? record.name : "",
        sourceFolders,
      };
  }
  return projects;
}

export function loadHiddenProjects(): Set<string> {
  const parsed = readJson(HIDDEN_KEY);
  return Array.isArray(parsed)
    ? new Set(
        parsed.filter((value): value is string => typeof value === "string"),
      )
    : new Set();
}

export function saveLocalProjects(projects: Record<string, LocalProject>) {
  try {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
  } catch {
    // 本地偏好不可写时，当前页面状态仍然有效。
  }
}

export function saveHiddenProjects(hidden: Set<string>) {
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden]));
  } catch {
    // 本地偏好不可写时，当前页面状态仍然有效。
  }
}

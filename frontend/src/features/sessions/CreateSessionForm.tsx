import { useEffect, useMemo, useState } from "react";
import { Icon } from "../../components/Icon";
import {
  isNativeDesktopShell,
  selectLocalDirectory,
} from "../../lib/desktopGateway";
import { useT } from "../../lib/i18n";

type CreateSessionFormProps = {
  onCancel: () => void;
  onCreate: (cwd: string, title?: string) => Promise<void>;
  /** 会话历史中的工作目录（去重），作为候选来源之一。 */
  knownCwds?: string[];
};

/** localStorage 键：最近使用的项目（最多 5 个，最新的在前）。 */
const RECENT_KEY = "suna-app:recent-projects";
const RECENT_MAX = 5;

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

/** 记录一次成功创建的项目：去重 + 最新在前 + 截断到上限。 */
export function rememberRecentCwd(cwd: string) {
  try {
    const next = [cwd, ...loadRecent().filter((value) => value !== cwd)].slice(
      0,
      RECENT_MAX,
    );
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // localStorage 不可用时静默失败，不影响创建流程。
  }
}

function projectName(cwd: string) {
  const trimmed = cwd.replace(/\/+$/, "");
  const base = trimmed.split("/").pop() || trimmed;
  return base || cwd;
}

/** 新建会话表单：项目名 + 源文件夹 + 最近候选。 */
export function CreateSessionForm({
  onCancel,
  onCreate,
  knownCwds = [],
}: CreateSessionFormProps) {
  const t = useT();
  const recent = useMemo(loadRecent, []);
  const suggestions = useMemo(
    () =>
      [...recent, ...knownCwds].filter(
        (value, index, list) => list.indexOf(value) === index,
      ),
    [recent, knownCwds],
  );
  const [title, setTitle] = useState("");
  const [cwd, setCwd] = useState(() => suggestions[0] ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const nativeShell = isNativeDesktopShell();

  useEffect(() => {
    if (!cwd && suggestions[0]) setCwd(suggestions[0]);
  }, [cwd, suggestions]);

  async function submit() {
    const effectiveCwd = cwd.trim();
    if (!effectiveCwd) {
      setError(t("create.error.required"));
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      await onCreate(effectiveCwd, title.trim() || undefined);
      rememberRecentCwd(effectiveCwd);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("create.error.failed"),
      );
      setSubmitting(false);
    }
  }

  async function pickFolder() {
    try {
      const files = await selectLocalDirectory();
      const next = files[0]?.path?.trim();
      if (!next) return;
      setCwd(next);
      if (!title.trim()) setTitle(projectName(next));
      setError(undefined);
    } catch {
      setError(t("create.error.failed"));
    }
  }

  const effectiveCwd = cwd.trim();

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label className="grid gap-1.5 text-[12px] font-bold text-ink-soft">
        {t("create.projectName")}
        <input
          autoFocus
          className="rounded-lg border border-line bg-surface-raised px-2.5 py-2 text-ink focus:border-blue/50 focus:ring-2 focus:ring-blue/25 focus:outline-none"
          disabled={submitting}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={t("create.projectNamePlaceholder")}
          value={title}
        />
      </label>
      <div className="grid gap-1.5 text-[12px] font-bold text-ink-soft">
        {t("create.sourceFolder")}
        <div className="grid gap-3 rounded-xl border border-line bg-surface-raised p-3">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-subtle text-ink-muted">
              <Icon name="folder" size={15} />
            </span>
            <div className="min-w-0 flex-1">
              <strong className="block truncate text-[12px] font-extrabold text-ink">
                {effectiveCwd
                  ? projectName(effectiveCwd)
                  : t("create.folderEmpty")}
              </strong>
              <p className="mt-0.5 truncate font-mono text-[10.5px] font-normal text-ink-muted">
                {effectiveCwd || t("create.folderHint")}
              </p>
            </div>
            <button
              className="shrink-0 rounded-lg bg-ink px-3 py-2 text-[11px] font-bold text-white transition-colors duration-150 hover:bg-blue-strong disabled:cursor-not-allowed disabled:opacity-50"
              disabled={submitting || !nativeShell}
              onClick={() => void pickFolder()}
              type="button"
            >
              {t("create.pickFolder")}
            </button>
          </div>
          <label className="grid gap-1">
            <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-ink-muted">
              {t("create.searchProjects")}
            </span>
            <input
              className="rounded-lg border border-line bg-surface px-2.5 py-2 font-mono text-[12px] text-ink focus:border-blue/50 focus:ring-2 focus:ring-blue/25 focus:outline-none"
              disabled={submitting}
              onChange={(event) => setCwd(event.target.value)}
              placeholder="/Users/me/project"
              value={cwd}
            />
          </label>
        </div>
      </div>
      {suggestions.length > 0 && (
        <div className="grid gap-1.5 text-[12px] font-bold text-ink-soft">
          <span>{t("create.project")}</span>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.slice(0, 6).map((projectCwd) => {
              const active = projectCwd === effectiveCwd;
              return (
                <button
                  className={`flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-semibold transition-colors duration-100 ${
                    active
                      ? "border-blue/40 bg-blue-soft text-blue-strong"
                      : "border-line bg-surface-raised text-ink-soft hover:bg-surface-subtle hover:text-ink"
                  }`}
                  key={projectCwd}
                  onClick={() => {
                    setCwd(projectCwd);
                    if (!title.trim()) setTitle(projectName(projectCwd));
                  }}
                  type="button"
                >
                  <Icon name="folder" size={12} />
                  <span className="max-w-[180px] truncate">
                    {projectName(projectCwd)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {error && (
        <small className="text-[12px] font-semibold text-rose">{error}</small>
      )}
      <div className="mt-1 flex justify-end gap-2.5">
        <button
          className="cursor-pointer rounded-lg border border-line bg-surface px-3.5 py-2 text-[12px] font-bold text-ink-soft transition-colors duration-150 hover:bg-surface-subtle hover:text-ink"
          disabled={submitting}
          onClick={onCancel}
          type="button"
        >
          {t("create.cancel")}
        </button>
        <button
          className="cursor-pointer rounded-lg bg-blue px-3.5 py-2 text-[12px] font-bold text-white shadow-[0_4px_10px_var(--color-blue-glow)] transition-colors duration-150 hover:bg-blue-strong disabled:cursor-not-allowed disabled:opacity-50"
          disabled={submitting || !effectiveCwd}
          type="submit"
        >
          {submitting ? t("create.creating") : t("create.submitProject")}
        </button>
      </div>
    </form>
  );
}

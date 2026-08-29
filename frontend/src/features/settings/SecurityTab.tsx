import { useState } from "react";
import { useT } from "../../lib/i18n";
import type { SettingsTabProps } from "./RuntimeSettings";

/** Guard 四个 mode，顺序从最严到最松，与 Runtime ModeOrDefault 对齐。 */
const GUARD_MODES = [
  {
    value: "readonly",
    labelKey: "security.mode.readonly",
    descKey: "security.mode.readonlyDesc",
  },
  {
    value: "ask",
    labelKey: "security.mode.ask",
    descKey: "security.mode.askDesc",
  },
  {
    value: "smart",
    labelKey: "security.mode.smart",
    descKey: "security.mode.smartDesc",
  },
  {
    value: "auto",
    labelKey: "security.mode.auto",
    descKey: "security.mode.autoDesc",
  },
] as const;

/** 安全 Tab：Guard 模式 + 工作目录。mode 语义与 Runtime plans/04-guard.md 对齐。 */
export function SecurityTab({ config, onConfig, rpc }: SettingsTabProps) {
  const t = useT();
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState<string>();

  async function setMode(mode: string) {
    if (!config || saving) return;
    setSaving(mode);
    setError(undefined);
    try {
      const next = await rpc("config.set", {
        action: "update_general",
        guard_mode: mode,
      });
      onConfig(next);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("security.error.save"),
      );
    } finally {
      setSaving(undefined);
    }
  }

  if (!config) return null;
  // Runtime ModeOrDefault 是 ask，禁止把空值显示成 smart。
  const current = config.guard_mode ?? "ask";

  return (
    <div className="grid gap-4">
      <section>
        <h3 className="m-0 mb-1 text-[13px] font-extrabold text-ink">
          {t("security.title")}
        </h3>
        <p className="mt-0 mb-3 text-[12px] leading-relaxed text-ink-muted">
          {t("security.desc")}
        </p>
        <div className="grid gap-2">
          {GUARD_MODES.map((mode) => (
            <button
              aria-pressed={current === mode.value}
              className={`cursor-pointer rounded-xl border p-3 text-left transition-colors duration-150 ${
                current === mode.value
                  ? "border-blue/50 bg-blue-soft/60"
                  : "border-line bg-surface-raised/50 hover:bg-surface-subtle"
              }`}
              disabled={saving === mode.value}
              key={mode.value}
              onClick={() => void setMode(mode.value)}
              type="button"
            >
              <span className="flex items-center justify-between">
                <strong className="text-[13px] font-extrabold text-ink">
                  {t(mode.labelKey)}
                </strong>
                {current === mode.value && (
                  <span className="rounded-sm bg-blue-soft px-1.5 py-px text-[10px] font-bold text-blue-strong">
                    {t("security.current")}
                  </span>
                )}
              </span>
              <small className="mt-0.5 block text-[11.5px] text-ink-muted">
                {t(mode.descKey)}
              </small>
            </button>
          ))}
        </div>
        {error && (
          <small className="mt-2 block text-[12px] font-semibold text-rose">
            {error}
          </small>
        )}
      </section>

      <section className="rounded-xl border border-line bg-surface-raised/50 p-3.5">
        <h3 className="m-0 text-[13px] font-extrabold text-ink">
          {t("security.workspace")}
        </h3>
        <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">
          {t("security.workspaceDesc")}
        </p>
        <code className="mt-2 block truncate rounded-lg bg-surface-raised px-2.5 py-2 font-mono text-[12px] text-ink">
          {config.workspace || t("security.workspaceEmpty")}
        </code>
      </section>
    </div>
  );
}

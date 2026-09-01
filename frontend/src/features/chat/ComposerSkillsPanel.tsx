import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../../lib/i18n";
import { useComposerPopoverPlacement } from "./composerPopover";
import type { SkillInfo } from "../../lib/runtimeBridge";

export function ComposerSkillsPanel({
  loadSkills,
  onClose,
  onPick,
}: {
  loadSkills: () => Promise<SkillInfo[]>;
  onClose: () => void;
  onPick: (skill: SkillInfo) => void;
}) {
  const t = useT();
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [query, setQuery] = useState("");
  const panelRef = useRef<HTMLElement>(null);
  const position = useComposerPopoverPlacement(panelRef, 420);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void loadSkills()
      .then((items) => {
        if (!alive) return;
        setSkills(items);
        setError(undefined);
      })
      .catch((reason: unknown) => {
        if (!alive) return;
        setError(
          reason instanceof Error ? reason.message : t("slash.skillsError"),
        );
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [loadSkills, t]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const valid = skills.filter((skill) => skill.valid !== false);
    if (!q) return valid;
    return valid.filter(
      (skill) =>
        skill.name.toLowerCase().includes(q) ||
        (skill.description ?? "").toLowerCase().includes(q),
    );
  }, [query, skills]);

  return (
    <section
      aria-label={t("slash.skillsTitle")}
      className={`absolute inset-x-0 z-20 flex flex-col overflow-hidden rounded-xl border border-line bg-surface-solid shadow-lg ${position.className}`}
      ref={panelRef}
      role="dialog"
      style={position.style}
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-3 py-2">
        <h2 className="text-[13px] font-semibold text-ink">
          {t("slash.skillsTitle")}
        </h2>
        <button
          className="cursor-pointer rounded-md px-2 py-1 text-[11px] font-semibold text-ink-muted hover:bg-surface-subtle hover:text-ink"
          onClick={onClose}
          type="button"
        >
          {t("slash.close")}
        </button>
      </header>
      <input
        aria-label={t("slash.skillsSearch")}
        autoFocus
        className="shrink-0 border-b border-line bg-transparent px-3 py-2 text-[12px] text-ink outline-none placeholder:text-ink-muted"
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("slash.skillsSearch")}
        value={query}
      />
      <div className="min-h-0 flex-1 overflow-auto">
        {loading && (
          <p className="px-3 py-3 text-[12px] text-ink-muted">
            {t("slash.skillsLoading")}
          </p>
        )}
        {error && (
          <p className="px-3 py-2 text-[12px] font-semibold text-rose">
            {error}
          </p>
        )}
        {!loading && visible.length === 0 && (
          <p className="px-3 py-3 text-[12px] text-ink-muted">
            {t("slash.skillsEmpty")}
          </p>
        )}
        {visible.map((skill) => (
          <button
            className="flex w-full cursor-pointer flex-col items-start gap-0.5 border-b border-line/70 px-3 py-2.5 text-left last:border-b-0 hover:bg-surface-subtle"
            key={`${skill.scope ?? "global"}:${skill.path ?? skill.name}`}
            onClick={() => onPick(skill)}
            type="button"
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="font-medium text-ink">${skill.name}</span>
              <span className="rounded-sm bg-surface-raised px-1 py-px text-[10px] font-medium text-ink-muted">
                {skill.scope === "project"
                  ? t("slash.skillsProject")
                  : t("slash.skillsGlobal")}
              </span>
            </span>
            {skill.description && (
              <span className="w-full truncate text-[11px] text-ink-muted">
                {skill.description}
              </span>
            )}
          </button>
        ))}
      </div>
    </section>
  );
}

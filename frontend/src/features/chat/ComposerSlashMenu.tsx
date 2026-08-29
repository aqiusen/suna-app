import { useT } from "../../lib/i18n";
import type { SlashItem } from "./slashCommands";

export function ComposerSlashMenu({
  items,
  selected,
  onPick,
}: {
  items: SlashItem[];
  selected: number;
  onPick: (item: SlashItem) => void;
}) {
  const t = useT();
  if (items.length === 0) return null;
  return (
    <div
      aria-label={t("slash.menu")}
      className="absolute inset-x-0 bottom-full z-20 mb-2 max-h-[min(320px,40vh)] overflow-auto rounded-xl border border-line bg-surface-solid shadow-lg"
      role="listbox"
    >
      {items.map((item, index) => {
        const active = index === selected;
        const label =
          item.kind === "command" ? item.command.cmd : `/${item.skill.name}`;
        const detail =
          item.kind === "command"
            ? t(item.command.descKey)
            : (item.skill.description ?? t("slash.skillItem"));
        return (
          <button
            aria-selected={active}
            className={`flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2 text-left text-[13px] transition-colors duration-100 ${
              active
                ? "bg-surface-subtle text-ink"
                : "text-ink-soft hover:bg-surface-subtle hover:text-ink"
            }`}
            key={item.kind === "command" ? item.command.cmd : item.skill.name}
            onClick={() => onPick(item)}
            onMouseDown={(event) => event.preventDefault()}
            role="option"
            type="button"
          >
            <span className="font-medium">{label}</span>
            <span className="min-w-0 truncate text-[12px] text-ink-muted">
              {detail}
            </span>
          </button>
        );
      })}
    </div>
  );
}

import { useRef } from "react";
import { useT } from "../../lib/i18n";
import { useComposerPopoverPlacement } from "./composerPopover";
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
  const menuRef = useRef<HTMLDivElement>(null);
  const position = useComposerPopoverPlacement(menuRef, 320);
  if (items.length === 0) return null;
  return (
    <div
      aria-label={t("slash.menu")}
      className={`absolute inset-x-0 z-20 overflow-auto rounded-xl border border-line bg-surface-solid shadow-lg ${position.className}`}
      ref={menuRef}
      role="listbox"
      style={position.style}
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

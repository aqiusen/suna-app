import { Icon } from "../../components/Icon";
import { Tooltip } from "../../components/ui/Tooltip";
import { useT } from "../../lib/i18n";
import type { SessionInfo } from "../../lib/runtimeBridge";
import { statusLabels } from "./sidebarUtils";

export function SessionRow({
  disabled,
  joining,
  onDelete,
  onJoinActive,
  onSelect,
  onTogglePin,
  pinned,
  selected,
  session,
}: {
  disabled: boolean;
  joining: boolean;
  onDelete?: (id: string) => void;
  onJoinActive: (id: string) => void;
  onSelect: (id: string) => void;
  onTogglePin?: () => void;
  pinned?: boolean;
  selected: boolean;
  session: SessionInfo;
}) {
  const t = useT();
  const canJoin =
    session.status === "running" && !selected && !disabled && !joining;
  const hasQuickActions = Boolean(onTogglePin || onDelete);
  const actionPadding = hasQuickActions ? "pr-16" : "";

  return (
    <div className={`group relative my-0.5 ${joining ? "opacity-60" : ""}`}>
      {/* 选中态只保留轻底色和细指示条，避免每行都像一张浮动卡片。 */}
      {selected && (
        <span
          aria-hidden="true"
          className="absolute top-1/2 left-0 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-blue"
        />
      )}
      <button
        aria-current={selected ? "page" : undefined}
        aria-label={`${session.title || t("sidebar.untitled")}，${joining ? t("sidebar.opening") : t(statusLabels[session.status])}`}
        className={`grid w-full cursor-pointer grid-cols-[8px_minmax(0,1fr)] items-center gap-2 rounded-none px-2.5 py-1.5 text-left transition-[background,transform,opacity] duration-180 ${selected ? `bg-blue-soft ${actionPadding} text-ink` : `${actionPadding} text-ink-soft`} hover:bg-surface-subtle active:scale-[0.985] disabled:cursor-wait disabled:opacity-60`}
        disabled={disabled || joining}
        onClick={() => onSelect(session.id)}
        type="button"
      >
        <span
          aria-hidden="true"
          className={`h-[7px] w-[7px] rounded-full ${session.status === "running" ? "animate-[breathe_2.4s_ease-in-out_infinite] bg-blue shadow-[0_0_0_4px_var(--color-blue-soft)]" : session.status === "waiting" ? "bg-amber" : session.status === "compacting" ? "animate-[breathe_1.8s_ease-in-out_infinite] bg-blue shadow-[0_0_0_3px_var(--color-blue-soft)]" : "bg-ink-muted"}`}
        />
        <span className="grid min-w-0 gap-0.5">
          <strong className="truncate text-[12px] font-extrabold text-ink">
            {session.title || t("sidebar.untitled")}
          </strong>
        </span>
      </button>
      {hasQuickActions && (
        <div className="absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100">
          {onTogglePin && (
            <Tooltip label={pinned ? t("sidebar.unpin") : t("sidebar.pin")}>
              <button
                aria-label={pinned ? t("sidebar.unpin") : t("sidebar.pin")}
                className={`grid h-7 w-7 cursor-pointer place-items-center rounded-md transition-colors hover:bg-surface-solid hover:text-ink disabled:cursor-wait disabled:opacity-50 ${pinned ? "text-blue" : "text-ink-muted"}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onTogglePin();
                }}
                disabled={disabled || joining}
                type="button"
              >
                <Icon name="pin" size={14} />
              </button>
            </Tooltip>
          )}
          {onDelete && (
            <Tooltip label={t("sidebar.delete")}>
              <button
                aria-label={t("sidebar.delete")}
                className="grid h-7 w-7 cursor-pointer place-items-center rounded-md text-ink-muted transition-colors hover:bg-rose/10 hover:text-rose disabled:cursor-wait disabled:opacity-50"
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete(session.id);
                }}
                disabled={disabled || joining}
                type="button"
              >
                <Icon name="trash" size={14} />
              </button>
            </Tooltip>
          )}
        </div>
      )}
      {canJoin && (
        <button
          aria-label={t("sidebar.joinRunning")}
          className={`absolute top-1.5 ${hasQuickActions ? "right-16" : "right-2"} cursor-pointer rounded-md bg-blue px-2 py-1 text-[10px] font-bold text-white shadow-sm transition-colors duration-150 hover:bg-blue-strong`}
          onClick={() => onJoinActive(session.id)}
          type="button"
        >
          {t("sidebar.join")}
        </button>
      )}
    </div>
  );
}

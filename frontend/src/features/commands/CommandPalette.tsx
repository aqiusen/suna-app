import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "../../components/Icon";
import { useChangeLocale, useLocale, useT } from "../../lib/i18n";
import type { SessionInfo } from "../../lib/runtimeBridge";

type CommandPaletteProps = {
  open: boolean;
  sessions: SessionInfo[];
  selectedId?: string;
  /** 当前会话是否在运行（控制“停止当前任务”动作是否可用）。 */
  running?: boolean;
  /** 当前会话是否可压缩（无选中/同步中时禁用）。 */
  canCompact?: boolean;
  onClose: () => void;
  onSelectSession: (id: string) => void;
  onCreateTask: () => void;
  onOpenSettings: () => void;
  onToggleTheme: () => void;
  onStopTask: () => void;
  onCompact: () => void;
};

type Command = {
  id: string;
  label: string;
  detail?: string;
  icon: IconName;
  kind: "session" | "action";
  run: () => void;
};

/** Cmd/Ctrl+K 全局命令面板：搜索任务 + 快捷动作（分组展示）。 */
export function CommandPalette({
  open,
  sessions,
  selectedId,
  running = false,
  canCompact = false,
  onClose,
  onSelectSession,
  onCreateTask,
  onOpenSettings,
  onToggleTheme,
  onStopTask,
  onCompact,
}: CommandPaletteProps) {
  const t = useT();
  const locale = useLocale();
  const changeLocale = useChangeLocale();
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // 打开时聚焦 + 清空查询。
  useEffect(() => {
    if (open) {
      setQuery("");
      setHighlight(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Esc 关闭。
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const commands = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sessionCommands: Command[] = sessions
      .filter((session) => {
        if (!q) return true;
        return (
          (session.title ?? "").toLowerCase().includes(q) ||
          session.cwd.toLowerCase().includes(q)
        );
      })
      .slice(0, 8)
      .map((session) => ({
        id: `session-${session.id}`,
        label: session.title || t("cmd.untitled"),
        detail: session.cwd,
        icon: "message" as const,
        kind: "session" as const,
        run: () => onSelectSession(session.id),
      }));
    const actions: Command[] = [
      {
        id: "create",
        label: t("cmd.newTask"),
        icon: "plus" as const,
        kind: "action" as const,
        run: onCreateTask,
      },
      ...(running
        ? [
            {
              id: "stop",
              label: t("cmd.stopTask"),
              icon: "pause" as const,
              kind: "action" as const,
              run: onStopTask,
            },
          ]
        : []),
      ...(canCompact
        ? [
            {
              id: "compact",
              label: t("cmd.compact"),
              icon: "tool" as const,
              kind: "action" as const,
              run: onCompact,
            },
          ]
        : []),
      {
        id: "settings",
        label: t("cmd.settings"),
        icon: "settings" as const,
        kind: "action" as const,
        run: onOpenSettings,
      },
      {
        id: "theme",
        label: t("cmd.theme"),
        icon: "sun" as const,
        kind: "action" as const,
        run: onToggleTheme,
      },
      {
        id: "locale",
        label: locale === "zh" ? t("cmd.localeZh") : t("cmd.localeEn"),
        icon: "message" as const,
        kind: "action" as const,
        run: () => changeLocale(locale === "zh" ? "en" : "zh"),
      },
    ].filter((action) => {
      if (!q) return true;
      return action.label.toLowerCase().includes(q);
    });
    return { sessions: sessionCommands, actions };
  }, [
    canCompact,
    changeLocale,
    locale,
    onCompact,
    onCreateTask,
    onOpenSettings,
    onSelectSession,
    onStopTask,
    onToggleTheme,
    query,
    running,
    sessions,
    t,
  ]);

  // 打开时重置高亮；命令列表变化时夹紧高亮。
  const flat = useMemo(
    () => [...commands.sessions, ...commands.actions],
    [commands],
  );
  useEffect(() => {
    setHighlight(0);
  }, [open, query]);
  useEffect(() => {
    setHighlight((value) => Math.min(value, Math.max(0, flat.length - 1)));
  }, [flat.length]);

  // 键盘导航：上下移动高亮，回车执行。
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((value) => Math.min(value + 1, flat.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((value) => Math.max(value - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const command = flat[highlight];
      if (command) {
        command.run();
        onClose();
      }
    }
  };

  /** 渲染一组命令：任务/动作分区，组内连续索引用于高亮定位。 */
  const renderGroup = (title: string, group: Command[], offset: number) => {
    if (group.length === 0) return null;
    return (
      <div className="pb-1">
        <p className="px-2.5 pt-1.5 pb-1 text-[10px] font-extrabold tracking-[0.09em] text-ink-muted uppercase">
          {title}
        </p>
        {group.map((command, index) => {
          const active = index + offset === highlight;
          return (
            <button
              aria-selected={active}
              className={`flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-80 ${
                active ? "bg-blue-soft/70" : "hover:bg-surface-subtle"
              }`}
              key={command.id}
              onMouseEnter={() => setHighlight(index + offset)}
              onClick={() => {
                command.run();
                onClose();
              }}
              type="button"
            >
              <span
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${
                  active
                    ? "bg-blue text-white"
                    : "bg-surface-subtle text-ink-muted"
                }`}
              >
                <Icon name={command.icon} size={14} />
              </span>
              <span className="min-w-0 flex-1">
                <strong className="block truncate text-[12.5px] font-bold text-ink">
                  {command.label}
                </strong>
                {command.detail && (
                  <small className="block truncate font-mono text-[10px] text-ink-muted">
                    {command.detail}
                  </small>
                )}
              </span>
              {command.kind === "session" &&
                command.id === `session-${selectedId}` && (
                  <span className="shrink-0 text-[10px] font-bold text-blue-strong">
                    {t("cmd.current")}
                  </span>
                )}
            </button>
          );
        })}
      </div>
    );
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 grid place-items-start justify-items-center p-4 pt-[12vh]">
      {/* 遮罩 */}
      <button
        aria-label={t("cmd.close")}
        className="absolute inset-0 h-full w-full cursor-default border-0 bg-[rgb(15_18_28_/_0.4)] animate-[scrim-in_160ms_ease_both]"
        onClick={onClose}
        tabIndex={-1}
        type="button"
      />
      <div className="relative w-[min(100%,560px)] animate-[panel-pop_200ms_cubic-bezier(0.2,0.8,0.2,1)_both] overflow-hidden rounded-2xl border border-line bg-surface-solid shadow-xl">
        <div className="flex items-center gap-2 border-b border-line px-3.5">
          <Icon className="shrink-0 text-ink-muted" name="search" size={15} />
          <input
            aria-label={t("cmd.searchPlaceholder")}
            className="min-w-0 flex-1 bg-transparent py-3 text-[13px] text-ink outline-none placeholder:text-ink-muted"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("cmd.searchPlaceholder")}
            ref={inputRef}
            value={query}
          />
          <kbd className="shrink-0 rounded-md border border-line bg-surface-raised px-1.5 py-0.5 text-[10px] font-bold text-ink-muted">
            Esc
          </kbd>
        </div>
        <div className="max-h-[300px] overflow-y-auto p-1.5">
          {flat.length === 0 && (
            <p className="p-3 text-center text-[12px] text-ink-muted">
              {t("cmd.noResults")}
            </p>
          )}
          {renderGroup(t("cmd.groupTasks"), commands.sessions, 0)}
          {renderGroup(
            t("cmd.groupActions"),
            commands.actions,
            commands.sessions.length,
          )}
        </div>
      </div>
    </div>
  );
}

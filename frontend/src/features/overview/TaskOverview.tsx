import { useEffect, useReducer } from "react";
import { Icon } from "../../components/Icon";
import { useT } from "../../lib/i18n";
import type { SessionInfo } from "../../lib/runtimeBridge";

type TaskOverviewProps = {
  sessions: SessionInfo[];
  connected: boolean;
  selectedId?: string;
  pendingId?: string;
  /** 是否已配置模型（false 时显示引导卡）。 */
  hasModels: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onReconnect: () => void;
  onOpenSettings: () => void;
};

const statusLabels: Record<SessionInfo["status"], string> = {
  idle: "session.status.idle",
  running: "session.status.running",
  waiting: "session.status.waiting",
  compacting: "session.status.compacting",
};

function relativeTime(
  value: string,
  t: (key: string, params?: Record<string, string | number>) => string,
) {
  const seconds = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return t("time.justNow");
  if (seconds < 3600) {
    return t("time.minutesAgo", { m: Math.floor(seconds / 60) });
  }
  if (seconds < 86400) {
    return t("time.hoursAgo", { h: Math.floor(seconds / 3600) });
  }
  return new Date(value).toLocaleDateString();
}

function SessionRow({
  session,
  selected,
  pending,
  onClick,
}: {
  session: SessionInfo;
  selected: boolean;
  pending: boolean;
  onClick: () => void;
}) {
  const t = useT();
  return (
    <button
      aria-label={`${session.title || t("sidebar.untitled")}，${pending ? t("sidebar.opening") : t(statusLabels[session.status])}`}
      className={`grid w-full cursor-pointer grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-3 py-3 text-left transition-[background,transform] duration-180 hover:bg-surface-subtle active:scale-[0.985] disabled:cursor-wait disabled:opacity-60 ${selected ? "bg-surface-solid shadow-sm" : ""}`}
      disabled={pending}
      onClick={onClick}
      type="button"
    >
      <span
        aria-hidden="true"
        className={`h-[8px] w-[8px] rounded-full ${session.status === "running" ? "animate-[breathe_2.4s_ease-in-out_infinite] bg-blue shadow-[0_0_0_5px_var(--color-blue-soft)]" : session.status === "waiting" ? "bg-amber shadow-[0_0_0_5px_var(--color-amber-soft)]" : session.status === "compacting" ? "animate-[breathe_1.8s_ease-in-out_infinite] bg-blue shadow-[0_0_0_4px_var(--color-blue-soft)]" : "bg-ink-muted"}`}
      />
      <span className="grid min-w-0 gap-0.5">
        <strong className="truncate text-[13px] font-extrabold text-ink">
          {session.title || t("sidebar.untitled")}
        </strong>
        <small className="truncate text-[11px] text-ink-muted">
          {session.cwd}
        </small>
      </span>
      <span className="grid justify-items-end gap-0.5">
        <time className="text-[10px] text-ink-muted">
          {t(relativeTime(session.updated_at, t))}
        </time>
        <span
          className={`text-[10px] font-bold ${session.status === "running" ? "text-blue-strong" : session.status === "waiting" ? "text-amber" : "text-ink-muted"}`}
        >
          {pending ? t("sidebar.opening") : t(statusLabels[session.status])}
        </span>
      </span>
    </button>
  );
}

/**
 * 任务总览：移动端首页 / 桌面端无选中会话时的默认视图。
 *
 * 利用 Suna 多会话并行的全局视角，把“需要你处理”放在最前——
 * 这正是本地 Agent Runtime 的 Web 客户端相对单会话聊天产品
 * 最有价值的入口。数据完全来自全局 session.updated 广播。
 */
export function TaskOverview({
  sessions,
  connected,
  selectedId,
  pendingId,
  hasModels,
  onSelect,
  onCreate,
  onReconnect,
  onOpenSettings,
}: TaskOverviewProps) {
  const t = useT();
  // 每分钟刷新相对时间（"刚刚/分钟前"不长期停留在旧值）。
  const [, tick] = useReducer((value: number) => value + 1, 0);
  useEffect(() => {
    const timer = window.setInterval(tick, 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const waiting = sessions.filter((session) => session.status === "waiting");
  const running = sessions.filter(
    (session) =>
      session.status === "running" || session.status === "compacting",
  );
  const rest = sessions.filter(
    (session) =>
      session.status !== "waiting" &&
      session.status !== "running" &&
      session.status !== "compacting",
  );

  const section = (
    title: string,
    count: number,
    tone: string,
    items: SessionInfo[],
    delay: number,
  ) => (
    <section
      className={`animate-[message-in_420ms_cubic-bezier(0.2,0.8,0.2,1)_both] ${delay > 0 ? `[animation-delay:${delay}ms]` : ""}`}
    >
      <h2 className="mb-1.5 flex items-center gap-2 px-1 text-[11px] font-extrabold tracking-[0.095em] text-ink-muted uppercase">
        <span className={`h-2 w-2 rounded-full ${tone}`} />
        {t(title)}
        {count > 0 && (
          <span className="rounded-full bg-surface-subtle px-1.5 py-px text-[10px] text-ink-soft">
            {count}
          </span>
        )}
      </h2>
      {items.length === 0 ? (
        <p className="px-1 pb-2 text-[12px] text-ink-muted">
          {t(
            title === "overview.needsYou"
              ? "overview.empty.needsYou"
              : "overview.empty",
          )}
        </p>
      ) : (
        <div className="space-y-1">
          {items.map((session) => (
            <SessionRow
              key={session.id}
              onClick={() => onSelect(session.id)}
              pending={pendingId === session.id}
              selected={selectedId === session.id}
              session={session}
            />
          ))}
        </div>
      )}
    </section>
  );

  return (
    <div className="mx-auto flex h-full w-full max-w-[560px] flex-col overflow-y-auto px-5 pt-7 pb-8">
      <header className="mb-6 animate-[message-in_420ms_cubic-bezier(0.2,0.8,0.2,1)_both]">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-ink text-white">
            <Icon name="sparkle" size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-[20px] font-extrabold tracking-tight text-ink">
              {t("overview.title")}
            </h1>
            <p className="text-[12px] text-ink-muted">
              {connected
                ? t("overview.subtitle.connected")
                : t("overview.subtitle.disconnected")}
            </p>
          </div>
          <button
            aria-label={t("overview.new")}
            className="grid h-10 w-10 cursor-pointer place-items-center rounded-xl bg-blue text-white shadow-[0_4px_10px_var(--color-blue-glow)] transition-[transform,background] duration-150 hover:bg-blue-strong active:scale-90"
            onClick={onCreate}
            type="button"
          >
            <Icon name="plus" size={18} />
          </button>
        </div>
        {!connected && (
          <button
            className="mt-4 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-line bg-surface-solid px-4 py-2.5 text-[12px] font-bold text-ink transition-colors duration-150 hover:bg-surface-subtle"
            onClick={onReconnect}
            type="button"
          >
            <span className="h-2 w-2 rounded-full bg-[#8a8f9d]" />
            {t("overview.reconnect")}
          </button>
        )}
      </header>

      {connected && !hasModels && (
        <section className="mb-6 animate-[panel-pop_220ms_cubic-bezier(0.2,0.8,0.2,1)_both] rounded-2xl border border-blue/25 bg-blue-soft/40 p-4">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-blue text-white shadow-[0_4px_10px_var(--color-blue-glow)]">
              <Icon name="sparkle" size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <strong className="block text-[13px] font-extrabold text-ink">
                {t("overview.onboarding.title")}
              </strong>
              <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">
                {t("overview.onboarding.desc")}
              </p>
              <button
                className="mt-2.5 cursor-pointer rounded-lg bg-blue px-3.5 py-2 text-[12px] font-semibold text-white transition-colors duration-150 hover:bg-blue-strong active:opacity-90"
                onClick={onOpenSettings}
                type="button"
              >
                {t("overview.onboarding.cta")}
              </button>
            </div>
          </div>
        </section>
      )}

      <div className="space-y-6">
        {section("overview.needsYou", waiting.length, "bg-amber", waiting, 60)}
        {section("overview.running", running.length, "bg-blue", running, 120)}
        {section("overview.recent", rest.length, "bg-ink-muted", rest, 180)}
      </div>
    </div>
  );
}

import { Icon } from "../../components/Icon";
import { useT } from "../../lib/i18n";
import type { SessionInfo } from "../../lib/runtimeBridge";

export function DisconnectedScreen({
  message,
  onInitialize,
  status,
}: {
  message: string;
  onInitialize: () => void;
  status: string;
}) {
  const t = useT();
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <section
        aria-live="polite"
        className="animate-[message-in_480ms_cubic-bezier(0.2,0.8,0.2,1)_both] w-[min(100%,456px)] rounded-[28px] border border-line bg-surface p-[42px] text-center shadow-lg backdrop-blur-2xl"
      >
        <span className="mx-auto mb-5 grid h-12 w-12 place-items-center rounded-2xl bg-amber-soft text-amber">
          <Icon name="warning" size={22} />
        </span>
        <p className="text-[10px] font-extrabold tracking-[0.095em] text-ink-muted uppercase">
          Suna App
        </p>
        <h1 className="mt-2.5 mb-2.5 text-[23px] font-extrabold tracking-tight text-ink">
          {status === "connecting"
            ? t("connect.connecting")
            : t("connect.title")}
        </h1>
        <p className="text-[13px] leading-relaxed text-ink-soft">{message}</p>
        <button
          className="mt-6 inline-flex h-[42px] w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-blue text-[12.5px] font-semibold text-white transition-colors duration-150 hover:bg-blue-strong active:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={status === "connecting" || status === "disconnecting"}
          onClick={onInitialize}
          type="button"
        >
          {status === "connecting"
            ? t("connect.connectingBtn")
            : t("connect.button")}
        </button>
      </section>
    </main>
  );
}

export function WaitingNotice({
  disabled,
  sessions,
  onDismiss,
  onGo,
}: {
  disabled: boolean;
  sessions: SessionInfo[];
  onDismiss: () => void;
  onGo: () => void;
}) {
  const t = useT();
  if (sessions.length === 0) return null;
  return (
    <div className="relative z-30 flex items-center gap-2 border-b border-amber/25 bg-amber-soft/70 px-3 py-2">
      <Icon className="shrink-0 text-amber" name="warning" size={14} />
      <span className="min-w-0 flex-1 truncate text-[12px] font-bold text-ink">
        {t("waiting.notice", { count: sessions.length })}
      </span>
      <button
        className="shrink-0 cursor-pointer rounded-md bg-surface-solid px-2 py-1 text-[11px] font-bold text-ink-soft transition-colors duration-150 hover:text-ink disabled:opacity-45"
        disabled={disabled}
        onClick={onGo}
        type="button"
      >
        {t("waiting.go")}
      </button>
      <button
        aria-label={t("waiting.dismiss")}
        className="grid h-6 w-6 shrink-0 cursor-pointer place-items-center rounded-md text-ink-muted transition-colors duration-150 hover:bg-surface-subtle hover:text-ink"
        onClick={onDismiss}
        type="button"
      >
        <Icon name="close" size={13} />
      </button>
    </div>
  );
}

export function MobileTabBar({
  mobileTab,
  selected,
  onOpenSettings,
  onSelectOverview,
  onSelectSession,
}: {
  mobileTab: "overview" | "session" | "settings";
  selected?: SessionInfo;
  onOpenSettings: () => void;
  onSelectOverview: () => void;
  onSelectSession: () => void;
}) {
  const t = useT();
  return (
    <nav aria-label={t("common.mainNav")} className="mobile-tabbar">
      <button
        aria-current={mobileTab === "overview" ? "page" : undefined}
        className="flex min-w-0 flex-1 cursor-pointer flex-col items-center gap-0.5 py-1.5 text-[10px] font-bold transition-colors duration-150 disabled:opacity-40"
        onClick={onSelectOverview}
        type="button"
      >
        <Icon
          className={
            mobileTab === "overview" ? "text-blue-strong" : "text-ink-muted"
          }
          name="message"
          size={17}
        />
        {t("nav.overview")}
      </button>
      <button
        aria-current={mobileTab === "session" && selected ? "page" : undefined}
        className="flex min-w-0 flex-1 cursor-pointer flex-col items-center gap-0.5 py-1.5 text-[10px] font-bold transition-colors duration-150 disabled:opacity-40"
        disabled={!selected}
        onClick={onSelectSession}
        type="button"
      >
        <Icon
          className={
            mobileTab === "session" && selected
              ? "text-blue-strong"
              : "text-ink-muted"
          }
          name="sparkle"
          size={17}
        />
        {t("nav.task")}
      </button>
      <button
        aria-current={mobileTab === "settings" ? "page" : undefined}
        className="flex min-w-0 flex-1 cursor-pointer flex-col items-center gap-0.5 py-1.5 text-[10px] font-bold transition-colors duration-150"
        onClick={onOpenSettings}
        type="button"
      >
        <Icon
          className={
            mobileTab === "settings" ? "text-blue-strong" : "text-ink-muted"
          }
          name="settings"
          size={17}
        />
        {t("nav.settings")}
      </button>
    </nav>
  );
}

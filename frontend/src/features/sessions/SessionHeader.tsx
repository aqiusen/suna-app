import { useEffect, useState } from "react";
import { Icon, IconButton } from "../../components/Icon";
import { OverflowMarquee } from "../../components/OverflowMarquee";
import { useT } from "../../lib/i18n";
import { Tooltip } from "../../components/ui/Tooltip";
import type { SessionInfo } from "../../lib/runtimeBridge";

type SessionHeaderProps = {
  selected?: SessionInfo;
  running: boolean;
  canControl: boolean;
  syncing: boolean;
  onStop: () => void;
  onOpenMobileMenu: () => void;
  onRename?: () => void;
};

/** 工作区顶部栏：会话标题、状态徽章与停止。设置入口在侧栏左下角。 */
export function SessionHeader({
  selected,
  running,
  canControl,
  syncing,
  onStop,
  onOpenMobileMenu,
  onRename,
}: SessionHeaderProps) {
  const t = useT();
  // 停止两段式：第一次点击进入 3 秒确认窗口，再点才真正取消，防误触。
  const [stopArming, setStopArming] = useState(false);
  useEffect(() => {
    if (!stopArming) return;
    const timer = window.setTimeout(() => setStopArming(false), 3000);
    return () => window.clearTimeout(timer);
  }, [stopArming]);
  return (
    <header className="relative flex min-h-[74px] min-w-0 items-center justify-between gap-4 overflow-hidden border-b border-line bg-surface/75 px-7 py-3.5 backdrop-blur-xl max-[720px]:min-h-[65px] max-[720px]:gap-2.5 max-[720px]:px-3.5 max-[720px]:pt-[max(10px,env(safe-area-inset-top))] max-[720px]:pb-2.5">
      {/* 顶部品牌渐变细条：与用户消息/发送按钮统一视觉语言。 */}
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-[2px] bg-[linear-gradient(90deg,#5b67f1,#6d5df0_55%,#7c54e8)] opacity-80"
      />
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <IconButton
          className="hidden max-[720px]:inline-grid"
          label={t("header.openSidebar")}
          onClick={onOpenMobileMenu}
        >
          <Icon name="message" />
        </IconButton>
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="group flex min-w-0 items-center gap-2.5">
            <h1 className="m-0 min-w-0 flex-1 overflow-hidden text-[15px] font-extrabold tracking-tight text-ink max-[720px]:text-[13px]">
              <OverflowMarquee
                endEllipsis
                text={selected?.title || t("header.overview")}
              />
            </h1>
            {selected && onRename && (
              <Tooltip label={t("sidebar.rename")}>
                <IconButton
                  className="shrink-0"
                  disabled={syncing}
                  label={t("sidebar.rename")}
                  onClick={onRename}
                >
                  <Icon name="pencil" size={14} />
                </IconButton>
              </Tooltip>
            )}
            {selected && (
              <span
                aria-live="polite"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold whitespace-nowrap text-ink-soft max-[390px]:hidden"
              >
                <span
                  className={`h-[6px] w-[6px] rounded-full ${selected.status === "running" ? "animate-[breathe_2.4s_ease-in-out_infinite] bg-blue shadow-[0_0_0_4px_var(--color-blue-soft)]" : selected.status === "waiting" ? "bg-amber" : "bg-ink-muted"}`}
                />
                {selected.status === "running"
                  ? t("header.running")
                  : selected.status === "waiting"
                    ? t("header.waiting")
                    : t("header.idle")}
              </span>
            )}
            {selected && selected.client_count > 1 && (
              <span
                aria-label={t("header.shared")}
                className="inline-flex shrink-0 items-center gap-1 rounded-full bg-blue-soft px-2 py-0.5 text-[10px] font-bold whitespace-nowrap text-blue-strong"
              >
                <Icon name="users" size={11} />
                <span className="max-[720px]:hidden">{t("header.shared")}</span>
                {`· ${selected.client_count}`}
              </span>
            )}
          </div>
          <p
            className="m-0 max-w-[420px] truncate text-[11px] font-medium text-ink-muted max-[720px]:hidden"
            title={selected?.cwd}
          >
            {selected?.cwd || t("header.workspace")}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1 max-[720px]:gap-px">
        {running && canControl && !syncing && (
          <button
            aria-live="polite"
            className={`flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-bold transition-colors duration-150 active:scale-95 max-[720px]:h-8 max-[720px]:px-2 ${
              stopArming
                ? "bg-rose text-white shadow-[0_4px_10px_rgba(212,92,103,0.35)]"
                : "bg-rose/10 text-rose hover:bg-rose/15"
            }`}
            onClick={() => {
              if (stopArming) {
                setStopArming(false);
                onStop();
              } else {
                setStopArming(true);
              }
            }}
            type="button"
          >
            <Icon name="pause" size={15} />
            <span className="max-[390px]:hidden">
              {stopArming ? t("header.confirmStop") : t("header.stop")}
            </span>
          </button>
        )}
      </div>
    </header>
  );
}

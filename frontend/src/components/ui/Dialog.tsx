import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useT } from "../../lib/i18n";

/**
 * 轻量 Dialog：自管 mounted/closing 状态，打开播放 panel-pop / scrim-in，
 * 关闭先播 panel-out / fade-out 再卸载（避免瞬消）。
 * 提供 Esc 关闭、遮罩点击关闭、打开时锁定背景滚动与焦点。
 * （不使用 Radix Dialog：其 Presence 在关闭后仍会立即隐藏/卸载 DOM，
 * 退出动画不可控；本项目 Dialog 是薄封装，自管更简单可靠。）
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  className = "",
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  className?: string;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const t = useT();

  // 挂载/卸载控制：打开立即挂载，关闭先播动画再卸载。
  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
      return;
    }
    if (!mounted) return;
    setClosing(true);
    const timer = window.setTimeout(() => {
      setMounted(false);
      setClosing(false);
    }, 190);
    return () => window.clearTimeout(timer);
  }, [open, mounted]);

  // Esc 关闭。
  useEffect(() => {
    if (!mounted) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mounted, onOpenChange]);

  // 打开时锁定背景滚动 + 聚焦面板（简易焦点管理）。
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = requestAnimationFrame(() => panelRef.current?.focus());
    return () => {
      document.body.style.overflow = previous;
      cancelAnimationFrame(frame);
    };
  }, [open]);

  if (!mounted) return null;
  const panelAnimation = closing
    ? "animate-[panel-out_180ms_cubic-bezier(0.2,0.8,0.2,1)_both]"
    : "animate-[panel-pop_220ms_cubic-bezier(0.2,0.8,0.2,1)_both]";
  const scrimAnimation = closing
    ? "animate-[fade-out_170ms_ease_both]"
    : "animate-[scrim-in_200ms_ease_both]";

  return createPortal(
    <div
      aria-hidden={closing}
      className="fixed inset-0 z-30 grid place-items-center p-4"
    >
      {/* 遮罩：点击关闭 */}
      <button
        aria-label={t("common.close")}
        className={`absolute inset-0 h-full w-full cursor-default border-0 bg-[rgb(15_18_28_/_0.55)] ${scrimAnimation}`}
        onClick={() => onOpenChange(false)}
        tabIndex={-1}
        type="button"
      />
      {/* 面板：焦点陷阱的简易版——焦点落在面板内 */}
      <div
        aria-label={title}
        aria-modal="true"
        className={`relative grid w-[min(100%,440px)] max-w-[440px] gap-3 rounded-2xl border border-line bg-surface-solid p-5 shadow-lg focus:outline-none ${className} ${panelAnimation}`}
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[17px] font-extrabold tracking-tight text-ink">
              {title}
            </h2>
            {description && (
              <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
                {description}
              </p>
            )}
          </div>
          <button
            aria-label={t("common.close")}
            className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-lg text-ink-muted transition-colors duration-150 hover:bg-surface-subtle hover:text-ink"
            onClick={() => onOpenChange(false)}
            type="button"
          >
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import { useT } from "../../lib/i18n";

type ComposerAttachmentMenuProps = {
  /** 桌面壳：选择文件。 */
  onAttachFiles?: () => void;
  canAttachFiles?: boolean;
  /** 桌面壳：选择文件夹。 */
  onAttachFolder?: () => void;
  canAttachFolder?: boolean;
  /** 图片 URL 输入开关。 */
  onToggleImageUrl?: () => void;
  showImageUrl?: boolean;
  canAttachImageUrl?: boolean;
  disabled?: boolean;
};

export function ComposerAttachmentMenu({
  onAttachFiles,
  canAttachFiles = false,
  onAttachFolder,
  canAttachFolder = false,
  onToggleImageUrl,
  showImageUrl,
  canAttachImageUrl,
  disabled = false,
}: ComposerAttachmentMenuProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => setOpen(false), []);

  // 点击外部 / Escape 关闭。
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onClickOutside = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        close();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onClickOutside);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onClickOutside);
    };
  }, [open, close]);

  const hasAttachments = Boolean(
    canAttachFiles || canAttachFolder || canAttachImageUrl,
  );

  if (!hasAttachments) return null;

  return (
    <div className="relative">
      <button
        aria-expanded={open}
        aria-label={t("chat.addAttachments")}
        className={`grid h-8 w-8 cursor-pointer place-items-center rounded-[9px] transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${
          open
            ? "bg-blue-soft text-blue-strong"
            : "text-ink-muted hover:bg-surface-subtle hover:text-ink"
        }`}
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        ref={triggerRef}
        type="button"
      >
        <Icon name={open ? "close" : "plus"} size={16} />
      </button>
      {open && (
        <div
          className="absolute bottom-full left-0 z-50 mb-2 min-w-[160px] animate-[panel-pop_160ms_cubic-bezier(0.2,0.8,0.2,1)_both] overflow-hidden rounded-xl border border-line bg-surface-solid py-1.5 shadow-lg"
          ref={menuRef}
        >
          {onAttachFiles && (
            <button
              className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-[12px] font-semibold text-ink-soft transition-colors duration-100 hover:bg-surface-subtle hover:text-ink"
              disabled={disabled || !canAttachFiles}
              onClick={() => {
                onAttachFiles();
                close();
              }}
              type="button"
            >
              <Icon name="paperclip" size={14} />
              {t("chat.attachFile")}
            </button>
          )}
          {onAttachFolder && (
            <button
              className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-[12px] font-semibold text-ink-soft transition-colors duration-100 hover:bg-surface-subtle hover:text-ink"
              disabled={disabled || !canAttachFolder}
              onClick={() => {
                onAttachFolder();
                close();
              }}
              type="button"
            >
              <Icon name="folder" size={14} />
              {t("chat.attachFolder")}
            </button>
          )}
          {canAttachImageUrl && onToggleImageUrl && (
            <button
              className={`flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-[12px] font-semibold transition-colors duration-100 ${
                showImageUrl
                  ? "bg-blue-soft text-blue-strong"
                  : "text-ink-soft hover:bg-surface-subtle hover:text-ink"
              }`}
              disabled={disabled}
              onClick={() => {
                onToggleImageUrl();
                close();
              }}
              type="button"
            >
              <Icon name="image" size={14} />
              {t("chat.imageUrl")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

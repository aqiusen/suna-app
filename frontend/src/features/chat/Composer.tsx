import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Icon } from "../../components/Icon";
import { useT } from "../../lib/i18n";
import type { MessagePart } from "../../lib/runtimeBridge";

type ComposerProps = {
  onSubmit: (parts: MessagePart[]) => Promise<void>;
  disabled?: boolean;
  waiting?: boolean;
  observer?: boolean;
  canAttachImageUrl?: boolean;
  /** Increment to request focus on the composer textarea. */
  focusTrigger?: number;
};

export type ComposerHandle = {
  /** 外部（如空状态建议卡）向输入框填充草稿并聚焦。 */
  fillDraft: (text: string) => void;
};

export const Composer = forwardRef<ComposerHandle, ComposerProps>(
  function Composer(
    {
      onSubmit,
      disabled,
      waiting,
      observer = false,
      canAttachImageUrl,
      focusTrigger = 0,
    },
    ref,
  ) {
    const t = useT();
    const [draft, setDraft] = useState("");
    const [imageUrl, setImageUrl] = useState("");
    const [imageUrls, setImageUrls] = useState<string[]>([]);
    const [showImageInput, setShowImageInput] = useState(false);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string>();
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
      // 发送后清空草稿时，把自动增高的高度恢复为初始值。
      if (!draft && textareaRef.current) textareaRef.current.style.height = "";
    }, [draft]);

    useEffect(() => {
      if (focusTrigger > 0 && !disabled) textareaRef.current?.focus();
    }, [disabled, focusTrigger]);

    // 暴露给应用壳：空状态建议卡点击后填入示例 prompt 并聚焦输入框。
    useImperativeHandle(
      ref,
      () => ({
        fillDraft(text: string) {
          setDraft(text);
          setError(undefined);
          requestAnimationFrame(() => textareaRef.current?.focus());
        },
      }),
      [],
    );

    /** 校验图片 URL 是否合法 http(s)。 */
    function validateUrl(url: string) {
      try {
        const parsed = new URL(url);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
      } catch {
        return false;
      }
    }

    /** 把输入框的 URL 添加为附件 chip（去重）。 */
    function addImageUrl() {
      const url = imageUrl.trim();
      if (!url) return;
      if (!validateUrl(url)) {
        setError(t("chat.invalidImageUrl"));
        return;
      }
      setError(undefined);
      setImageUrls((value) => (value.includes(url) ? value : [...value, url]));
      setImageUrl("");
    }

    async function submit() {
      const message = draft.trim();
      if ((!message && imageUrls.length === 0) || sending || disabled) return;
      if (imageUrl.trim()) {
        // 输入框有未添加的 URL：先校验再视为待提交附件。
        if (!validateUrl(imageUrl.trim())) {
          setError(t("chat.invalidImageUrl"));
          return;
        }
      }
      setSending(true);
      setError(undefined);
      const parts: MessagePart[] = [];
      if (message) parts.push({ type: "text", text: message });
      // 全部附件（已添加 chips + 输入框未添加的一个）一起提交。
      const urls = imageUrls.map((url) => url.trim()).filter(Boolean);
      if (imageUrl.trim()) urls.push(imageUrl.trim());
      for (const url of urls) {
        parts.push({ type: "image", source: { kind: "url", url } });
      }
      // 乐观清空：立即清空输入（发送按钮进入 sending 态），失败时恢复草稿，
      // 避免网络慢时用户误以为没发出而重复提交。
      const prevDraft = draft;
      const prevUrls = imageUrls;
      const prevImageUrl = imageUrl;
      setDraft("");
      setImageUrls([]);
      setImageUrl("");
      setShowImageInput(false);
      try {
        await onSubmit(parts);
      } catch (reason) {
        setDraft(prevDraft);
        setImageUrls(prevUrls);
        setImageUrl(prevImageUrl);
        setError(
          reason instanceof Error ? reason.message : t("chat.sendError"),
        );
      } finally {
        setSending(false);
      }
    }

    return (
      <footer className="composer-area">
        {(waiting || error) && (
          <div className="mx-auto mb-2 flex w-[min(720px,100%)] items-center justify-between">
            {waiting && (
              <span className="inline-flex min-h-[27px] animate-[slide-up_240ms_cubic-bezier(0.2,0.8,0.2,1)_both] items-center gap-1.5 rounded-full border border-amber/20 bg-amber-soft px-2 py-1 text-[10px] font-extrabold text-amber">
                <span className="grid h-[18px] w-[18px] place-items-center rounded-full bg-amber/15">
                  <Icon name="warning" size={13} />
                </span>
                {t("chat.waitingReply")}
              </span>
            )}
            {error && (
              <span className="text-[12px] font-semibold text-rose">
                {error}
              </span>
            )}
          </div>
        )}
        <div
          className={`mx-auto w-[min(720px,100%)] rounded-[14px] border bg-surface-solid px-4 pt-3 pb-2.5 transition-colors duration-150 max-[720px]:rounded-xl max-[720px]:px-3 max-[720px]:pt-2.5 max-[720px]:pb-2 ${observer ? "border-dashed border-rose/30 bg-surface-subtle/70 opacity-75" : "border-line-strong focus-within:border-blue/50"}`}
        >
          {observer && (
            <div className="mb-1.5 flex items-center gap-1.5 px-1 text-[10.5px] font-semibold text-rose/80">
              <Icon name="eye" size={12} />
              {t("chat.observerNotice")}
            </div>
          )}
          {showImageInput && (
            <div className="mb-2 grid gap-1.5 px-0.5">
              <label className="grid gap-1 text-[10px] font-bold text-ink-muted">
                {t("chat.imageUrl")}
                <span className="flex gap-1.5">
                  <input
                    autoFocus
                    className="min-w-0 flex-1 rounded-lg bg-surface-raised px-3 py-2 text-ink outline-none transition-[background-color] duration-150"
                    disabled={disabled || sending}
                    onChange={(event) => setImageUrl(event.target.value)}
                    onKeyDown={(event) => {
                      if (
                        event.key === "Enter" &&
                        !event.nativeEvent.isComposing
                      ) {
                        event.preventDefault();
                        addImageUrl();
                      }
                    }}
                    placeholder="https://example.com/image.png"
                    type="url"
                    value={imageUrl}
                  />
                  <button
                    aria-label={t("chat.addImage")}
                    className="shrink-0 cursor-pointer rounded-lg bg-surface-raised px-2.5 text-[11px] font-bold text-ink-soft transition-colors duration-150 hover:bg-surface-subtle hover:text-ink disabled:opacity-45"
                    disabled={disabled || sending || !imageUrl.trim()}
                    onClick={addImageUrl}
                    type="button"
                  >
                    {t("chat.addImage")}
                  </button>
                </span>
              </label>
              {/* 已添加的图片附件 chips：可逐个删除（多图支持，设计 §7.5） */}
              {imageUrls.length > 0 && (
                <span className="flex flex-wrap gap-1.5">
                  {imageUrls.map((url) => (
                    <span
                      className="inline-flex max-w-full items-center gap-1 rounded-full border border-line bg-surface-raised py-0.5 pr-1 pl-2.5 text-[10.5px] font-semibold text-ink-soft"
                      key={url}
                    >
                      <span className="truncate">{url}</span>
                      <button
                        aria-label={t("chat.removeImage", { url })}
                        className="grid h-4 w-4 shrink-0 cursor-pointer place-items-center rounded-full text-ink-muted transition-colors duration-150 hover:bg-surface-subtle hover:text-ink"
                        disabled={disabled || sending}
                        onClick={() =>
                          setImageUrls((value) =>
                            value.filter((item) => item !== url),
                          )
                        }
                        type="button"
                      >
                        <Icon name="close" size={11} />
                      </button>
                    </span>
                  ))}
                </span>
              )}
            </div>
          )}
          <div className="flex items-end gap-1.5">
            <textarea
              aria-label={t("chat.inputLabel")}
              className="min-h-[38px] max-h-[132px] flex-1 resize-none bg-transparent px-1 py-[9px] text-[13px] leading-[20px] text-ink outline-none placeholder:text-ink-muted max-[720px]:min-h-[44px] max-[720px]:py-[11px]"
              disabled={disabled || sending}
              onChange={(event) => setDraft(event.target.value)}
              onInput={(event) => {
                // 随内容自动增高，最多 132px（与 CSS max-height 一致）；超出后内部滚动。
                const element = event.currentTarget;
                element.style.height = "auto";
                element.style.height = `${Math.min(element.scrollHeight, 132)}px`;
              }}
              onKeyDown={(event) => {
                // isComposing：中文输入法组合输入中的回车用于选词，不能发送。
                // Cmd/Ctrl+Enter 强制发送（组合键下忽略 Shift，防止 IME 占用场景）；
                // 普通 Enter 非 Shift 发送，Shift+Enter 换行。
                const mod = event.metaKey || event.ctrlKey;
                if (
                  event.key === "Enter" &&
                  !event.nativeEvent.isComposing &&
                  (mod || !event.shiftKey)
                ) {
                  event.preventDefault();
                  void submit();
                }
              }}
              placeholder={
                disabled
                  ? observer
                    ? t("chat.observerPlaceholder")
                    : t("chat.selectSessionFirst")
                  : t("chat.sendPlaceholder")
              }
              ref={textareaRef}
              rows={1}
              value={draft}
            />
            <div className="flex shrink-0 items-center gap-1.5 pb-1.5">
              {canAttachImageUrl && (
                <button
                  aria-expanded={showImageInput}
                  aria-label={t("chat.imageUrl")}
                  className={`grid h-[34px] w-[34px] cursor-pointer place-items-center rounded-[11px] transition-colors duration-150 ${showImageInput ? "bg-blue-soft text-blue-strong" : "text-ink-muted hover:bg-surface-subtle hover:text-ink"}`}
                  disabled={disabled || sending}
                  onClick={() => setShowImageInput((value) => !value)}
                  type="button"
                >
                  <Icon name="image" size={16} />
                </button>
              )}
              <button
                aria-label={t("chat.send")}
                className="grid h-[34px] w-[34px] cursor-pointer place-items-center rounded-[10px] bg-ink text-white transition-[background-color,opacity] duration-150 hover:bg-blue active:opacity-85 disabled:cursor-default disabled:opacity-40 max-[720px]:h-[42px] max-[720px]:w-[42px]"
                disabled={
                  (!draft.trim() &&
                    !imageUrl.trim() &&
                    imageUrls.length === 0) ||
                  disabled ||
                  sending
                }
                onClick={() => void submit()}
                type="button"
              >
                <Icon name="arrow-up" size={17} />
              </button>
            </div>
          </div>
        </div>
        {/* 提示行仅桌面显示（窄屏空间有限且用户熟悉触屏输入）。 */}
        <p className="mx-auto mt-1.5 w-[min(720px,100%)] text-center text-[11px] text-ink-muted/80 max-[720px]:hidden">
          {t("chat.composerHint")}
        </p>
      </footer>
    );
  },
);

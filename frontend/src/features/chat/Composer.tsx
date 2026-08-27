import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Icon } from "../../components/Icon";
import { useT } from "../../lib/i18n";
import type { MessagePart } from "../../lib/runtimeTypes";
import {
  isNativeDesktopShell,
  resolvePastedFiles,
  selectLocalDirectory,
  selectLocalFiles,
  type PickedFile,
} from "../../lib/desktopGateway";
import type { ConfigModel } from "../../lib/runtimeTypes";
import { ComposerApprovalMode } from "./ComposerApprovalMode";
import { ComposerAttachmentMenu } from "./ComposerAttachmentMenu";
import { ComposerModelSelect } from "./ComposerModelSelect";

type ComposerProps = {
  onSubmit: (parts: MessagePart[]) => Promise<void>;
  disabled?: boolean;
  waiting?: boolean;
  observer?: boolean;
  canAttachImageUrl?: boolean;
  /** Increment to request focus on the composer textarea. */
  focusTrigger?: number;
  /** 可用模型列表（来自 config.get）。 */
  models?: ConfigModel[];
  /** 当前会话或全局活跃模型引用。 */
  activeModel?: string;
  /** 切换模型。 */
  onModelChange?: (modelRef: string) => void;
  /** 保存当前模型的推理强度配置。 */
  onReasoningChange?: (model: ConfigModel) => Promise<void>;
  /** 当前 guard_mode 值。 */
  approvalMode?: string;
  /** 保存批准方式。 */
  onApprovalModeChange?: (mode: string) => Promise<void>;
};

function isImageFile(file: PickedFile): boolean {
  return (
    !file.is_dir && file.mime_type?.toLowerCase().startsWith("image/") === true
  );
}

/** 把附件意图作为文本传给 Agent，路径本身不代表可执行指令。 */
export function buildAttachmentParts(
  message: string,
  imageUrls: string[],
  localFiles: PickedFile[],
): MessagePart[] {
  const resources: string[] = [];
  for (const url of imageUrls) {
    resources.push(`- Inspect this image URL: ${url}`);
  }
  for (const file of localFiles) {
    if (file.is_dir) {
      resources.push(`- Work in this directory: ${file.path}`);
    } else if (isImageFile(file)) {
      resources.push(`- Inspect this image: ${file.path}`);
    } else {
      resources.push(`- Read and analyze this file: ${file.path}`);
    }
  }

  const parts: MessagePart[] = [];
  if (message) parts.push({ type: "text", text: message });
  if (resources.length > 0) {
    parts.push({
      type: "text",
      text: [
        "The user attached the following resources. Use the paths as user-provided references and use file tools as needed:",
        ...resources,
      ].join("\n"),
    });
  }
  for (const url of imageUrls) {
    parts.push({ type: "image", source: { kind: "url", url } });
  }
  for (const file of localFiles) {
    if (!isImageFile(file)) continue;
    parts.push({
      type: "image",
      source: {
        kind: "path",
        path: file.path,
        name: file.name,
        mime_type: file.mime_type,
        size: file.size,
      },
    });
  }
  return parts;
}

// Wails WebView 粘贴文件时 File 对象带非标准 path 属性（本机绝对路径）。
// DOM 类型不包含它，这里做一次窄化声明；仅桌面壳场景有值。
declare global {
  interface File {
    path?: string;
  }
}

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
      models,
      activeModel,
      onModelChange,
      approvalMode,
      onApprovalModeChange,
      onReasoningChange,
    },
    ref,
  ) {
    const t = useT();
    const [draft, setDraft] = useState("");
    const [imageUrl, setImageUrl] = useState("");
    const [imageUrls, setImageUrls] = useState<string[]>([]);
    // 桌面壳的本机文件附件（path kind）：原生对话框选择或粘贴 file:// 解析。
    const [localFiles, setLocalFiles] = useState<PickedFile[]>([]);
    const [showImageInput, setShowImageInput] = useState(false);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string>();
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    // 桌面壳才提供原生文件选择/粘贴路径解析能力。
    const nativeShell = isNativeDesktopShell();

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

    /** 添加本机文件附件（按绝对路径去重）。 */
    function addLocalFiles(files: PickedFile[]) {
      if (files.length === 0) return;
      setLocalFiles((value) => {
        const seen = new Set(value.map((item) => item.path));
        return [...value, ...files.filter((item) => !seen.has(item.path))];
      });
      setError(undefined);
    }

    async function pickLocalFiles() {
      try {
        addLocalFiles(await selectLocalFiles());
      } catch {
        setError(t("chat.sendError"));
      }
    }

    async function pickLocalDirectory() {
      try {
        addLocalFiles(await selectLocalDirectory());
      } catch {
        setError(t("chat.sendError"));
      }
    }

    // 粘贴处理：桌面壳下 Finder 复制的文件以 file:// 形式出现在剪贴板，
    // 交给 Go 侧解析为本机路径；普通文本/图片 URL 粘贴不受影响。
    async function handlePaste(event: React.ClipboardEvent) {
      if (!nativeShell || disabled || sending) return;
      const urls = Array.from(event.clipboardData.items)
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile())
        .filter((file): file is File => file !== null)
        .filter((file) => file.size === 0 && !file.type)
        .map((file) => file.path)
        .filter((path): path is string => typeof path === "string");
      if (urls.length > 0) {
        event.preventDefault();
        try {
          addLocalFiles(await resolvePastedFiles(urls));
        } catch {
          setError(t("chat.sendError"));
        }
      }
    }

    async function submit() {
      const message = draft.trim();
      if (
        (!message && imageUrls.length === 0 && localFiles.length === 0) ||
        sending ||
        disabled
      ) {
        return;
      }
      if (imageUrl.trim()) {
        // 输入框有未添加的 URL：先校验再视为待提交附件。
        if (!validateUrl(imageUrl.trim())) {
          setError(t("chat.invalidImageUrl"));
          return;
        }
      }
      setSending(true);
      setError(undefined);
      // 全部附件（已添加 chips + 输入框未添加的一个）一起提交。
      const urls = imageUrls.map((url) => url.trim()).filter(Boolean);
      if (imageUrl.trim()) urls.push(imageUrl.trim());
      const parts = buildAttachmentParts(message, urls, localFiles);
      // 乐观清空：立即清空输入（发送按钮进入 sending 态），失败时恢复草稿，
      // 避免网络慢时用户误以为没发出而重复提交。
      const prevDraft = draft;
      const prevUrls = imageUrls;
      const prevImageUrl = imageUrl;
      const prevLocalFiles = localFiles;
      setDraft("");
      setImageUrls([]);
      setImageUrl("");
      setLocalFiles([]);
      setShowImageInput(false);
      try {
        await onSubmit(parts);
      } catch (reason) {
        setDraft(prevDraft);
        setImageUrls(prevUrls);
        setImageUrl(prevImageUrl);
        setLocalFiles(prevLocalFiles);
        setError(
          reason instanceof Error ? reason.message : t("chat.sendError"),
        );
      } finally {
        setSending(false);
      }
    }

    return (
      <footer className="composer-area">
        {/* 状态提示行 */}
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
          className={`mx-auto w-[min(720px,100%)] rounded-[16px] border bg-surface-solid px-3.5 pt-3 pb-2.5 transition-colors duration-150 max-[720px]:rounded-xl max-[720px]:px-3 max-[720px]:pt-2.5 max-[720px]:pb-2 ${observer ? "border-dashed border-rose/30 bg-surface-subtle/70 opacity-75" : "border-line-strong focus-within:border-blue/50"}`}
        >
          {observer && (
            <div className="mb-1.5 flex items-center gap-1.5 px-1 text-[10.5px] font-semibold text-rose/80">
              <Icon name="eye" size={12} />
              {t("chat.observerNotice")}
            </div>
          )}
          {/* 图片 URL 输入框 */}
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
              {/* 已添加的图片附件 chips */}
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
          {/* 本机文件附件 chips */}
          {localFiles.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5 px-0.5">
              {localFiles.map((file) => (
                <span
                  className="inline-flex max-w-full items-center gap-1 rounded-lg border border-line bg-surface-subtle py-0.5 pr-1 pl-2 text-[11px] font-medium text-ink-soft"
                  key={file.path}
                  title={file.path}
                >
                  <Icon aria-hidden="true" name="tool" size={12} />
                  <span className="max-w-[220px] truncate">{file.name}</span>
                  <button
                    aria-label={t("chat.removePath", { path: file.name })}
                    className="grid h-4 w-4 shrink-0 cursor-pointer place-items-center rounded-full text-ink-muted transition-colors duration-150 hover:bg-surface-raised hover:text-ink"
                    disabled={disabled || sending}
                    onClick={() =>
                      setLocalFiles((value) =>
                        value.filter((item) => item.path !== file.path),
                      )
                    }
                    type="button"
                  >
                    <Icon name="close" size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}
          {/* 文字输入区 */}
          <textarea
            aria-label={t("chat.inputLabel")}
            className="min-h-[42px] max-h-[132px] w-full resize-none bg-transparent px-1 py-1 text-[13.5px] leading-[21px] text-ink outline-none placeholder:text-ink-muted max-[720px]:min-h-[44px] max-[720px]:py-[11px]"
            disabled={disabled || sending}
            onChange={(event) => setDraft(event.target.value)}
            onInput={(event) => {
              const element = event.currentTarget;
              element.style.height = "auto";
              element.style.height = `${Math.min(element.scrollHeight, 132)}px`;
            }}
            onKeyDown={(event) => {
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
            onPaste={(event) => void handlePaste(event)}
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
          {/* 底部工具栏 */}
          <div className="mt-1.5 flex items-center justify-between gap-2">
            {/* 左区：+ 附件菜单 / 批准方式 / 模型选择 */}
            <div className="flex items-center gap-1.5">
              <ComposerAttachmentMenu
                canAttachImageUrl={canAttachImageUrl}
                disabled={disabled || sending}
                canAttachFiles={nativeShell}
                canAttachFolder={nativeShell}
                onAttachFiles={pickLocalFiles}
                onAttachFolder={pickLocalDirectory}
                onToggleImageUrl={
                  canAttachImageUrl
                    ? () => setShowImageInput((value) => !value)
                    : undefined
                }
                showImageUrl={showImageInput}
              />
              <ComposerApprovalMode
                disabled={disabled || sending || observer}
                onSave={onApprovalModeChange}
                value={approvalMode}
              />
            </div>
            {/* 右区：模型选择 / 发送按钮 */}
            <div className="flex shrink-0 items-center gap-1.5">
              <ComposerModelSelect
                activeModelRef={activeModel}
                disabled={disabled || sending || observer}
                models={models}
                onModelChange={onModelChange}
                onReasoningChange={onReasoningChange}
              />
              <button
                aria-label={t("chat.send")}
                className="grid h-8 w-8 cursor-pointer place-items-center rounded-full bg-ink text-white transition-[background-color,opacity] duration-150 hover:bg-blue active:opacity-85 disabled:cursor-default disabled:opacity-40 max-[720px]:h-[42px] max-[720px]:w-[42px]"
                disabled={
                  (!draft.trim() &&
                    !imageUrl.trim() &&
                    imageUrls.length === 0 &&
                    localFiles.length === 0) ||
                  disabled ||
                  sending
                }
                onClick={() => void submit()}
                type="button"
              >
                <Icon name="arrow-up" size={16} />
              </button>
            </div>
          </div>
        </div>
        {/* 提示行仅桌面显示 */}
        <p className="mx-auto mt-1.5 w-[min(720px,100%)] text-center text-[11px] text-ink-muted/80 max-[720px]:hidden">
          {t("chat.composerHint")}
        </p>
      </footer>
    );
  },
);

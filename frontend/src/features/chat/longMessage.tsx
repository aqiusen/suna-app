import { useState } from "react";
import { useT } from "../../lib/i18n";
import { LazyMarkdown } from "./LazyMarkdown";

/** 超长消息折叠阈值：超过则默认只显示预览，避免一次性渲染几万 token。 */
export const LONG_MESSAGE_THRESHOLD = 20_000;

/** 超长 assistant 消息：默认折叠为预览，点击展开完整 Markdown。 */
export function LongMessage({ text }: { text: string }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="markdown-body rounded-xl bg-surface-subtle px-4 py-3">
      {!expanded && (
        <button
          className="mb-2 block cursor-pointer text-[12px] font-bold text-blue-strong transition-opacity duration-150 hover:opacity-75"
          onClick={() => setExpanded(true)}
          type="button"
        >
          {t("chat.expandFull", { kb: Math.round(text.length / 1000) })}
        </button>
      )}
      {expanded ? (
        <LazyMarkdown>{text}</LazyMarkdown>
      ) : (
        <p className="m-0 line-clamp-4 whitespace-pre-wrap text-[13px] leading-[1.82] text-ink">
          {text.slice(0, 800)}
        </p>
      )}
    </div>
  );
}

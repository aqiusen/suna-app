import { Icon } from "../../components/Icon";
import { Tooltip } from "../../components/ui/Tooltip";
import { useT } from "../../lib/i18n";
import type { QueuedMessage } from "../runtime/sessionState";

type QueuedMessagesProps = {
  items: QueuedMessage[];
  disabled?: boolean;
  onRemove: (item: QueuedMessage) => void;
  onInterrupt: (item: QueuedMessage) => void;
};

/** Runtime steering 队列：只按 Runtime sequence 展示，不提供重排或编辑。 */
export function QueuedMessages({
  items,
  disabled = false,
  onRemove,
  onInterrupt,
}: QueuedMessagesProps) {
  const t = useT();
  if (items.length === 0) return null;

  return (
    <section aria-label={t("chat.queuedMessages")} className="mt-4 space-y-2">
      <div className="px-1 text-[10px] font-bold text-ink-muted">
        {t("chat.queuedMessages")}
      </div>
      <div className="grid gap-1">
        {items.map((item) => (
          <article
            className="flex min-w-0 items-center gap-3 rounded-lg border border-line bg-surface-solid px-3.5 py-3 text-[13px] text-ink"
            key={item.id}
          >
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-surface-subtle text-ink-muted">
              <Icon name="message" size={12} />
            </span>
            <span className="min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere]">
              {item.content}
            </span>
            <div className="flex shrink-0 items-center gap-3">
              <span className="text-[10px] font-semibold text-ink-muted">
                {t("chat.queuedStatus")}
              </span>
              <Tooltip label={t("chat.interrupt")}>
                <button
                  aria-label={t("chat.interrupt")}
                  className="flex h-6 cursor-pointer items-center gap-1 rounded-md px-1.5 text-[11px] font-semibold text-ink-muted transition-colors hover:bg-blue-soft hover:text-blue-strong disabled:cursor-not-allowed disabled:opacity-35"
                  disabled={disabled || !item.id}
                  onClick={() => onInterrupt(item)}
                  type="button"
                >
                  <Icon name="turn" size={13} />
                  {t("chat.interruptShort")}
                </button>
              </Tooltip>
              <Tooltip label={t("chat.removeQueuedMessage")}>
                <button
                  aria-label={t("chat.removeQueuedMessage")}
                  className="grid h-6 w-6 cursor-pointer place-items-center rounded-md text-ink-muted transition-colors hover:bg-rose/10 hover:text-rose disabled:cursor-not-allowed disabled:opacity-35"
                  disabled={disabled || !item.id}
                  onClick={() => onRemove(item)}
                  type="button"
                >
                  <Icon name="trash" size={13} />
                </button>
              </Tooltip>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

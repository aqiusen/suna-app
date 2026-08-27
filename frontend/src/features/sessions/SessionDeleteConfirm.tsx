import { Dialog } from "../../components/ui/Dialog";
import { useT } from "../../lib/i18n";

/** 删除单会话或整目录会话前的确认框。 */
export function SessionDeleteConfirm({
  kind,
  onCancel,
  onConfirm,
}: {
  kind: "session" | "workdir";
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useT();
  const title = kind === "session" ? t("sidebar.delete") : t("group.delete");
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title={title}
      description={
        kind === "session"
          ? t("action.deleteConfirm")
          : t("group.deleteConfirm")
      }
      className="w-[min(100%,440px)] max-w-[440px]"
    >
      <div className="flex justify-end gap-2.5">
        <button
          className="cursor-pointer rounded-lg px-3.5 py-2 text-[12px] font-bold text-ink-muted transition-colors hover:bg-surface-subtle hover:text-ink"
          onClick={onCancel}
          type="button"
        >
          {t("create.cancel")}
        </button>
        <button
          className="cursor-pointer rounded-lg bg-rose px-3.5 py-2 text-[12px] font-bold text-white transition-colors hover:bg-rose/85"
          onClick={onConfirm}
          type="button"
        >
          {title}
        </button>
      </div>
    </Dialog>
  );
}

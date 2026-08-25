import { Dialog } from "../../components/ui/Dialog";
import { useT } from "../../lib/i18n";
import { CreateSessionForm } from "./CreateSessionForm";

type SessionDialogsProps = {
  editingTitle: boolean;
  onEditingTitleChange: (open: boolean) => void;
  titleDraft: string;
  onTitleDraftChange: (value: string) => void;
  onRename: () => void;
  createOpen: boolean;
  onCreateOpenChange: (open: boolean) => void;
  onCreate: (cwd: string, title?: string) => Promise<void>;
};

/** 会话级对话框：重命名与新建会话。 */
export function SessionDialogs({
  editingTitle,
  onEditingTitleChange,
  titleDraft,
  onTitleDraftChange,
  onRename,
  createOpen,
  onCreateOpenChange,
  onCreate,
}: SessionDialogsProps) {
  const t = useT();
  return (
    <>
      <Dialog
        open={editingTitle}
        onOpenChange={onEditingTitleChange}
        title={t("create.renameTitle")}
        description={t("create.renameDesc")}
      >
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            onRename();
          }}
        >
          <label className="grid gap-1.5 text-[12px] font-bold text-ink-soft">
            {t("create.sessionTitle")}
            <input
              autoFocus
              className="rounded-lg border border-line bg-surface-raised px-2.5 py-2 text-ink focus:border-blue/50 focus:ring-2 focus:ring-blue/25 focus:outline-none"
              onChange={(event) => onTitleDraftChange(event.target.value)}
              value={titleDraft}
            />
          </label>
          <div className="mt-1 flex justify-end gap-2.5">
            <button
              className="cursor-pointer rounded-lg border border-line bg-surface px-3.5 py-2 text-[12px] font-bold text-ink-soft transition-colors duration-150 hover:bg-surface-subtle hover:text-ink"
              onClick={() => onEditingTitleChange(false)}
              type="button"
            >
              {t("create.cancel")}
            </button>
            <button
              className="cursor-pointer rounded-lg bg-blue px-3.5 py-2 text-[12px] font-bold text-white shadow-[0_4px_10px_var(--color-blue-glow)] transition-colors duration-150 hover:bg-blue-strong"
              type="submit"
            >
              {t("settings.save")}
            </button>
          </div>
        </form>
      </Dialog>
      <Dialog
        open={createOpen}
        onOpenChange={onCreateOpenChange}
        title={t("create.createProject")}
        description={t("create.folderHint")}
      >
        <CreateSessionForm
          onCancel={() => onCreateOpenChange(false)}
          onCreate={onCreate}
        />
      </Dialog>
    </>
  );
}

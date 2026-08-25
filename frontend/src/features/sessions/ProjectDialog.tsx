import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Dialog } from "../../components/ui/Dialog";
import { Icon } from "../../components/Icon";
import {
  selectLocalDirectory,
  isNativeDesktopShell,
} from "../../lib/desktopGateway";
import { useT } from "../../lib/i18n";

type ProjectDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectName: string;
  sourceFolders: string[];
  onSave: (name: string, sourceFolders: string[]) => void;
  onRemove: () => void;
};

function folderName(path: string) {
  const trimmed = path.replace(/\\+$/, "");
  return trimmed.split(/[\\/]/).pop() || path;
}

export function ProjectDialog({
  open,
  onOpenChange,
  projectName,
  sourceFolders,
  onSave,
  onRemove,
}: ProjectDialogProps) {
  const t = useT();
  const [name, setName] = useState(projectName);
  const [folders, setFolders] = useState(sourceFolders);
  const [error, setError] = useState<string>();
  const nativeShell = isNativeDesktopShell();

  useEffect(() => {
    if (!open) return;
    setName(projectName);
    setFolders(sourceFolders);
    setError(undefined);
  }, [open, projectName, sourceFolders]);

  function updateFolder(index: number, value: string) {
    setFolders((current) =>
      current.map((folder, folderIndex) =>
        folderIndex === index ? value : folder,
      ),
    );
  }

  function removeFolder(index: number) {
    setFolders((current) =>
      current.filter((_, folderIndex) => folderIndex !== index),
    );
  }

  async function addFolder() {
    if (nativeShell) {
      try {
        const selected = await selectLocalDirectory();
        const path = selected[0]?.path?.trim();
        if (path) {
          setFolders((current) =>
            current.includes(path) ? current : [...current, path],
          );
          return;
        }
      } catch {
        setError(t("project.error.folder"));
        return;
      }
    }
    setFolders((current) => [...current, ""]);
  }

  function save() {
    const nextFolders = [
      ...new Set(folders.map((folder) => folder.trim()).filter(Boolean)),
    ];
    if (!name.trim() || nextFolders.length === 0) {
      setError(t("project.error.required"));
      return;
    }
    onSave(name.trim(), nextFolders);
    onOpenChange(false);
  }

  return createPortal(
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      className="w-[min(100%,520px)] max-w-[520px]"
      title={t("project.editTitle")}
    >
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <label className="relative grid gap-1.5 text-[12px] font-bold text-ink-soft">
          <span className="sr-only">{t("project.name")}</span>
          <Icon
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-muted"
            name="folder"
            size={15}
          />
          <input
            aria-label={t("project.name")}
            autoFocus
            className="rounded-xl border border-blue bg-surface-raised py-2.5 pr-3 pl-10 text-ink shadow-[0_0_0_3px_var(--color-blue-soft)] focus:outline-none"
            onChange={(event) => setName(event.target.value)}
            value={name}
          />
        </label>

        <div className="grid gap-2 text-[12px] font-bold text-ink-soft">
          <span>{t("project.sourceFolders")}</span>
          <div className="overflow-hidden rounded-xl border border-line bg-surface-raised">
            {folders.map((folder, index) => (
              <div
                className="flex min-h-12 items-center gap-2 border-b border-line px-3 last:border-b-0"
                key={`${folder}-${index}`}
              >
                <Icon
                  className="shrink-0 text-ink-muted"
                  name="folder"
                  size={15}
                />
                <input
                  aria-label={`${t("project.sourceFolder")} ${index + 1}`}
                  className="min-w-0 flex-1 bg-transparent py-2 text-[12px] font-normal text-ink focus:outline-none"
                  onChange={(event) => updateFolder(index, event.target.value)}
                  placeholder={t("project.folderPlaceholder")}
                  value={folder}
                />
                <span className="hidden max-w-[110px] truncate text-[10px] font-normal text-ink-muted min-[520px]:block">
                  {folder ? folderName(folder) : ""}
                </span>
                <button
                  aria-label={t("project.removeFolder")}
                  className="grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-lg text-ink-muted transition-colors hover:bg-surface-subtle hover:text-ink"
                  onClick={() => removeFolder(index)}
                  type="button"
                >
                  <Icon name="close" size={14} />
                </button>
              </div>
            ))}
            <button
              className="flex w-full cursor-pointer items-center gap-2 px-3 py-3 text-left text-[12px] font-bold text-ink-soft transition-colors hover:bg-surface-subtle hover:text-ink"
              onClick={() => void addFolder()}
              type="button"
            >
              <Icon name="plus" size={15} />
              {t("project.addFolder")}
            </button>
          </div>
        </div>

        {error && (
          <p className="text-[12px] font-semibold text-rose">{error}</p>
        )}

        <div className="mt-1 flex items-center justify-between gap-3">
          <button
            className="cursor-pointer rounded-lg bg-rose/10 px-3 py-2 text-[12px] font-bold text-rose transition-colors hover:bg-rose/15"
            onClick={onRemove}
            type="button"
          >
            {t("project.remove")}
          </button>
          <div className="flex gap-2.5">
            <button
              className="cursor-pointer rounded-lg px-3.5 py-2 text-[12px] font-bold text-ink-muted transition-colors hover:bg-surface-subtle hover:text-ink"
              onClick={() => onOpenChange(false)}
              type="button"
            >
              {t("create.cancel")}
            </button>
            <button
              className="cursor-pointer rounded-lg bg-ink px-3.5 py-2 text-[12px] font-bold text-white transition-colors hover:bg-blue-strong"
              type="submit"
            >
              {t("settings.save")}
            </button>
          </div>
        </div>
      </form>
    </Dialog>,
    document.body,
  );
}

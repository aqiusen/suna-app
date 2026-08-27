import { useEffect, useState, type DragEvent } from "react";
import { Icon } from "../../components/Icon";
import {
  isNativeDesktopShell,
  resolvePastedFiles,
  selectLocalDirectory,
} from "../../lib/desktopGateway";
import { useT } from "../../lib/i18n";

type CreateSessionFormProps = {
  onCancel: () => void;
  onCreate: (cwd: string, title?: string) => Promise<void>;
  initialCwd?: string;
};

function directoryName(cwd: string) {
  const trimmed = cwd.replace(/\/+$/, "");
  const base = trimmed.split("/").pop() || trimmed;
  return base || cwd;
}

/** 新建会话表单：可选标题 + 可拖放的工作目录。 */
export function CreateSessionForm({
  onCancel,
  onCreate,
  initialCwd,
}: CreateSessionFormProps) {
  const t = useT();
  const [title, setTitle] = useState("");
  const [cwd, setCwd] = useState(initialCwd ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const [dragging, setDragging] = useState(false);
  const nativeShell = isNativeDesktopShell();

  useEffect(() => {
    const nextCwd = initialCwd?.trim() ?? "";
    setCwd(nextCwd);
    setTitle("");
    setError(undefined);
  }, [initialCwd]);

  function setFolder(path: string) {
    const next = path.trim();
    if (!next) return;
    setCwd(next);
    setError(undefined);
  }

  async function submit() {
    const effectiveCwd = cwd.trim();
    if (!effectiveCwd) {
      setError(t("create.error.required"));
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      await onCreate(effectiveCwd, title.trim() || undefined);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("create.error.failed"),
      );
      setSubmitting(false);
    }
  }

  async function pickFolder() {
    try {
      const files = await selectLocalDirectory();
      const next = files[0]?.path?.trim();
      if (next) setFolder(next);
    } catch {
      setError(t("create.error.failed"));
    }
  }

  async function dropFolder(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    try {
      const directPath = Array.from(event.dataTransfer.files)
        .map((file) => (file as File & { path?: string }).path?.trim())
        .find(Boolean);
      if (directPath) {
        setFolder(directPath);
        return;
      }

      const fileURLs = event.dataTransfer
        .getData("text/uri-list")
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter((value) => value.startsWith("file://"));
      if (fileURLs.length > 0) {
        const files = await resolvePastedFiles(fileURLs);
        const next = files[0]?.path?.trim();
        if (next) {
          setFolder(next);
          return;
        }
      }
      setError(t("create.error.dropFolder"));
    } catch {
      setError(t("create.error.dropFolder"));
    }
  }

  const effectiveCwd = cwd.trim();

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label className="grid gap-1.5 text-[12px] font-bold text-ink-soft">
        {t("create.sessionTitle")}
        <input
          autoFocus
          className="rounded-lg border border-line bg-surface-raised px-2.5 py-2 text-ink focus:border-blue/50 focus:ring-2 focus:ring-blue/25 focus:outline-none"
          disabled={submitting}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={t("create.titlePlaceholder")}
          value={title}
        />
      </label>
      <div className="grid gap-1.5 text-[12px] font-bold text-ink-soft">
        {t("create.workingDirectory")}
        <div
          aria-label={t("create.dropFolder")}
          className={`grid gap-3 rounded-xl border-2 border-dashed p-4 transition-colors ${
            dragging
              ? "border-blue bg-blue-soft"
              : "border-line bg-surface-raised"
          }`}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={(event) => {
            if (event.currentTarget === event.target) setDragging(false);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            setDragging(true);
          }}
          onDrop={(event) => void dropFolder(event)}
        >
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-surface-subtle text-ink-muted">
              <Icon name="folder" size={15} />
            </span>
            <div className="min-w-0 flex-1">
              <strong className="block truncate text-[12px] font-extrabold text-ink">
                {effectiveCwd
                  ? directoryName(effectiveCwd)
                  : dragging
                    ? t("create.dropFolderActive")
                    : t("create.folderEmpty")}
              </strong>
              <p className="mt-0.5 truncate font-mono text-[10.5px] font-normal text-ink-muted">
                {effectiveCwd || t("create.folderHint")}
              </p>
            </div>
            <button
              className="shrink-0 rounded-lg bg-ink px-3 py-2 text-[11px] font-bold text-white transition-colors duration-150 hover:bg-blue-strong disabled:cursor-not-allowed disabled:opacity-50"
              disabled={submitting || !nativeShell}
              onClick={() => void pickFolder()}
              type="button"
            >
              {t("create.pickFolder")}
            </button>
          </div>
          <label className="grid gap-1">
            <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-ink-muted">
              {t("create.pathLabel")}
            </span>
            <input
              className="rounded-lg border border-line bg-surface px-2.5 py-2 font-mono text-[12px] text-ink focus:border-blue/50 focus:ring-2 focus:ring-blue/25 focus:outline-none"
              disabled={submitting}
              onChange={(event) => {
                setCwd(event.target.value);
                setError(undefined);
              }}
              placeholder={t("create.pathPlaceholder")}
              value={cwd}
            />
          </label>
        </div>
      </div>
      {error && (
        <small className="text-[12px] font-semibold text-rose">{error}</small>
      )}
      <div className="mt-1 flex justify-end gap-2.5">
        <button
          className="cursor-pointer rounded-lg border border-line bg-surface px-3.5 py-2 text-[12px] font-bold text-ink-soft transition-colors duration-150 hover:bg-surface-subtle hover:text-ink"
          disabled={submitting}
          onClick={onCancel}
          type="button"
        >
          {t("create.cancel")}
        </button>
        <button
          className="cursor-pointer rounded-lg bg-blue px-3.5 py-2 text-[12px] font-bold text-white shadow-[0_4px_10px_var(--color-blue-glow)] transition-colors duration-150 hover:bg-blue-strong disabled:cursor-not-allowed disabled:opacity-50"
          disabled={submitting || !effectiveCwd}
          type="submit"
        >
          {submitting ? t("create.creating") : t("create.submitSession")}
        </button>
      </div>
    </form>
  );
}

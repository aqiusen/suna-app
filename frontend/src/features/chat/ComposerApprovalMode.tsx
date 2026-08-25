import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import { useT } from "../../lib/i18n";

/**
 * 批准方式模式映射。
 *
 * Runtime `guard_mode` 权威取值（来自 backend 确认）：
 *   `readonly` / `ask` / `smart` / `auto`
 * 默认值：`ask`
 *
 * 此映射表与 Runtime contract 对齐；修改前需经 backend/cto 确认。
 */
const GUARD_MODE_MAP: {
  value: string;
  labelKey: string;
  descKey: string;
  danger: boolean;
}[] = [
  {
    value: "ask",
    labelKey: "chat.approval.ask",
    descKey: "chat.approval.askDesc",
    danger: false,
  },
  {
    value: "smart",
    labelKey: "chat.approval.smart",
    descKey: "chat.approval.smartDesc",
    danger: false,
  },
  {
    value: "auto",
    labelKey: "chat.approval.auto",
    descKey: "chat.approval.autoDesc",
    danger: true,
  },
];

type ComposerApprovalModeProps = {
  /** 当前 guard_mode 值（从 config.get 来的权威值）。 */
  value?: string;
  /** 保存回调：调用 `rpc("config.set", { action: "update_general", guard_mode })`。 */
  onSave?: (mode: string) => Promise<void>;
  disabled?: boolean;
};

export function ComposerApprovalMode({
  value,
  onSave,
  disabled = false,
}: ComposerApprovalModeProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // 当前是否为 readonly 受限模式。
  const isReadonly = value === "readonly";

  // 找出当前有效模式（readonly 时无匹配）。
  const currentMode = GUARD_MODE_MAP.find((m) => m.value === value);
  const currentLabel = currentMode
    ? t(currentMode.labelKey)
    : isReadonly
      ? t("chat.approval.readonly")
      : t("chat.approval.smart");

  // 关闭 popover。
  const close = useCallback(() => {
    setOpen(false);
    setSaveError(undefined);
  }, []);

  // 点击外部 / Escape 关闭。
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onClickOutside = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
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

  const handleSelect = useCallback(
    async (mode: string) => {
      if (!onSave || saving) return;
      setSaving(true);
      setSaveError(undefined);
      try {
        await onSave(mode);
        close();
      } catch {
        setSaveError(t("chat.approval.saveError"));
      } finally {
        setSaving(false);
      }
    },
    [onSave, saving, close, t],
  );

  const canSave = Boolean(onSave) && !disabled && !isReadonly;

  return (
    <div className="relative">
      <button
        aria-expanded={open}
        aria-label={t("chat.approvalMode")}
        className={`inline-flex h-8 cursor-pointer items-center gap-1 rounded-full border px-2.5 text-[11px] font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45 ${
          isReadonly
            ? "border-rose/20 bg-rose-soft/50 text-rose"
            : "border-line bg-surface-subtle text-ink-soft hover:bg-surface-raised hover:text-ink"
        }`}
        disabled={disabled || saving}
        onClick={() => {
          if (!disabled && !saving) setOpen((prev) => !prev);
        }}
        ref={triggerRef}
        type="button"
      >
        <Icon name={isReadonly ? "warning" : "shield"} size={12} />
        {currentLabel}
        {!isReadonly && (
          <Icon className="text-ink-muted" name="chevron-down" size={11} />
        )}
      </button>
      {open && (
        <div
          className="absolute bottom-full left-0 z-50 mb-2 w-[330px] animate-[panel-pop_160ms_cubic-bezier(0.2,0.8,0.2,1)_both] overflow-hidden rounded-xl border border-line bg-surface-solid py-2 shadow-lg"
          ref={popoverRef}
        >
          {/* readonly 说明行 */}
          {isReadonly && (
            <div className="flex items-start gap-3 px-4 py-2.5 text-ink-muted">
              <Icon
                className="mt-0.5 shrink-0 text-rose"
                name="warning"
                size={14}
              />
              <span className="text-[12px] leading-relaxed">
                {t("chat.approval.readonlyDesc")}
              </span>
            </div>
          )}
          {GUARD_MODE_MAP.map((mode) => {
            const selected = mode.value === value;
            const isDanger = mode.danger;
            return (
              <button
                className={`flex w-full cursor-pointer items-start gap-3 px-4 py-2.5 text-left transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-50 ${
                  isDanger ? "hover:bg-rose/[0.06]" : "hover:bg-surface-subtle"
                }`}
                disabled={!canSave || saving}
                key={mode.value}
                onClick={() => void handleSelect(mode.value)}
                type="button"
              >
                <span
                  className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg ${
                    isDanger
                      ? "bg-rose-soft text-rose"
                      : "bg-blue-soft text-blue-strong"
                  }`}
                >
                  <Icon name="shield" size={13} />
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={`flex items-center justify-between text-[12.5px] font-bold ${
                      isDanger ? "text-rose" : "text-ink"
                    }`}
                  >
                    {t(mode.labelKey)}
                    {selected && (
                      <Icon
                        className={isDanger ? "text-rose" : "text-blue-strong"}
                        name="check"
                        size={14}
                      />
                    )}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-muted">
                    {t(mode.descKey)}
                  </span>
                </span>
              </button>
            );
          })}
          {saveError && (
            <p className="px-4 pt-1 pb-0 text-[11px] font-semibold text-rose">
              {saveError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

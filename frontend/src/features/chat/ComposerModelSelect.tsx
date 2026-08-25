import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import { useT } from "../../lib/i18n";
import type { ConfigModel, JSONRecord } from "../../lib/runtimeTypes";

/** 由 provider + model 拼出模型引用。 */
function modelRef(model: Pick<ConfigModel, "provider" | "model">) {
  return `${model.provider}/${model.model}`;
}

/** 截取模型短名（去掉 provider），供触发按钮与右侧提示用。 */
function shortModelLabel(ref?: string) {
  if (!ref) return "";
  const [, model = ref] = ref.split("/");
  return model;
}

function prettyModelLabel(ref?: string) {
  const model = shortModelLabel(ref);
  const withoutCommonPrefix = model.replace(/^(gpt|claude|gemini)-/i, "");
  return withoutCommonPrefix
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function compactModelLabel(ref?: string) {
  const label = prettyModelLabel(ref);
  return label || shortModelLabel(ref) || "Model";
}

type ReasoningOption = "low" | "medium" | "high";

const REASONING_OPTIONS: {
  value: ReasoningOption;
  labelKey: string;
  shortKey: string;
}[] = [
  {
    value: "low",
    labelKey: "chat.reasoning.low",
    shortKey: "chat.reasoning.lowShort",
  },
  {
    value: "medium",
    labelKey: "chat.reasoning.medium",
    shortKey: "chat.reasoning.mediumShort",
  },
  {
    value: "high",
    labelKey: "chat.reasoning.high",
    shortKey: "chat.reasoning.highShort",
  },
];

function normalizeReasoning(value: unknown): ReasoningOption {
  return value === "low" || value === "high" ? value : "medium";
}

function reasoningEffort(model?: ConfigModel): ReasoningOption {
  const reasoning = model?.reasoning;
  return normalizeReasoning(reasoning?.effort ?? reasoning?.reasoning_effort);
}

function nextReasoning(
  model: ConfigModel,
  effort: ReasoningOption,
): JSONRecord {
  const current = model.reasoning ?? {};
  return { ...current, effort };
}

type ComposerModelSelectProps = {
  models?: ConfigModel[];
  activeModelRef?: string;
  onModelChange?: (modelRef: string) => void;
  onReasoningChange?: (
    model: ConfigModel,
    effort: ReasoningOption,
  ) => Promise<void>;
  disabled?: boolean;
};

export function ComposerModelSelect({
  models = [],
  activeModelRef,
  onModelChange,
  onReasoningChange,
  disabled = false,
}: ComposerModelSelectProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [activePane, setActivePane] = useState<
    "model" | "reasoning" | undefined
  >();
  const [savingReasoning, setSavingReasoning] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const activeModel =
    models.find((model) => modelRef(model) === activeModelRef) ?? models[0];
  const value = activeModelRef ?? (activeModel ? modelRef(activeModel) : "");
  const currentReasoning = reasoningEffort(activeModel);
  const reasoningLabel = t(
    REASONING_OPTIONS.find((item) => item.value === currentReasoning)
      ?.shortKey ?? "chat.reasoning.mediumShort",
  );

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const onClickOutside = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node))
        close();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onClickOutside);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onClickOutside);
    };
  }, [close, open]);

  // 无可用模型时渲染一个禁用只读标签。
  if (models.length === 0 || !onModelChange) {
    return (
      <span className="inline-flex h-8 cursor-not-allowed items-center rounded-[9px] px-2 text-[11px] font-medium text-ink-muted">
        {t("chat.noModel")}
      </span>
    );
  }

  async function selectReasoning(effort: ReasoningOption) {
    if (!activeModel || !onReasoningChange || savingReasoning) return;
    setSavingReasoning(true);
    try {
      await onReasoningChange(
        { ...activeModel, reasoning: nextReasoning(activeModel, effort) },
        effort,
      );
      close();
    } finally {
      setSavingReasoning(false);
    }
  }

  return (
    <div className="relative" ref={rootRef} title={value}>
      <button
        aria-expanded={open}
        aria-label={t("chat.changeModel")}
        className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-full border border-line bg-surface-subtle px-2.5 text-[11px] font-semibold text-ink-soft transition-colors duration-150 hover:bg-surface-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-blue/40 disabled:cursor-not-allowed disabled:opacity-45"
        disabled={disabled}
        onClick={() => {
          if (!disabled) {
            setActivePane(undefined);
            setOpen((current) => !current);
          }
        }}
        ref={triggerRef}
        type="button"
      >
        <span className="max-w-[88px] truncate">
          {compactModelLabel(value)}
        </span>
        <span className="text-ink-muted">{reasoningLabel}</span>
      </button>
      {open && (
        <div className="absolute right-0 bottom-full z-50 mb-2">
          <div className="relative w-[230px] animate-[panel-pop_160ms_cubic-bezier(0.2,0.8,0.2,1)_both] rounded-xl border border-line bg-surface-solid p-1 shadow-lg">
            <MenuRow
              active={activePane === "model"}
              label={t("chat.model")}
              onClick={() => setActivePane("model")}
              onMouseEnter={() => setActivePane("model")}
              value={compactModelLabel(value)}
            />
            <MenuRow
              active={activePane === "reasoning"}
              disabled={!onReasoningChange || savingReasoning}
              label={t("chat.reasoning")}
              onClick={() => setActivePane("reasoning")}
              onMouseEnter={() => setActivePane("reasoning")}
              value={t(
                REASONING_OPTIONS.find(
                  (item) => item.value === currentReasoning,
                )?.labelKey ?? "chat.reasoning.medium",
              )}
            />
            <button
              className="flex h-9 w-full cursor-not-allowed items-center justify-between rounded-lg px-2.5 text-left text-[12px] font-medium text-ink-muted/55"
              disabled
              type="button"
            >
              {t("chat.resetDefaults")}
              <Icon name="close" size={12} />
            </button>
          </div>
          {activePane && (
            <div className="absolute bottom-0 left-full ml-2 w-[260px] animate-[panel-pop_160ms_cubic-bezier(0.2,0.8,0.2,1)_both] overflow-hidden rounded-xl border border-line bg-surface-solid p-1 shadow-lg">
              {activePane === "model"
                ? models.map((model) => {
                    const ref = modelRef(model);
                    const selected = ref === value;
                    return (
                      <button
                        className="flex h-9 w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-2.5 text-left text-[12px] font-medium text-ink-soft transition-colors duration-100 hover:bg-surface-subtle hover:text-ink disabled:cursor-default disabled:text-ink"
                        disabled={selected}
                        key={ref}
                        onClick={() => {
                          onModelChange(ref);
                          close();
                        }}
                        title={ref}
                        type="button"
                      >
                        <span className="truncate">
                          {prettyModelLabel(ref)}
                        </span>
                        {selected && (
                          <Icon
                            className="text-ink-muted"
                            name="check"
                            size={13}
                          />
                        )}
                      </button>
                    );
                  })
                : REASONING_OPTIONS.map((option) => {
                    const selected = option.value === currentReasoning;
                    return (
                      <button
                        className="flex h-9 w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-2.5 text-left text-[12px] font-medium text-ink-soft transition-colors duration-100 hover:bg-surface-subtle hover:text-ink disabled:cursor-not-allowed disabled:opacity-55"
                        disabled={
                          !onReasoningChange || savingReasoning || selected
                        }
                        key={option.value}
                        onClick={() => void selectReasoning(option.value)}
                        type="button"
                      >
                        <span>{t(option.labelKey)}</span>
                        {selected && (
                          <Icon
                            className="text-ink-muted"
                            name="check"
                            size={13}
                          />
                        )}
                      </button>
                    );
                  })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MenuRow({
  label,
  value,
  active,
  disabled,
  onClick,
  onMouseEnter,
}: {
  label: string;
  value: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
}) {
  return (
    <button
      className={`flex h-9 w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-2.5 text-left text-[12px] transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-50 ${
        active
          ? "bg-surface-subtle text-ink"
          : "text-ink-soft hover:bg-surface-subtle"
      }`}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      type="button"
    >
      <span className="font-medium">{label}</span>
      <span className="inline-flex min-w-0 items-center gap-1 text-ink-muted">
        <span className="max-w-[82px] truncate">{value}</span>
        <Icon name="chevron-right" size={12} />
      </span>
    </button>
  );
}

export { shortModelLabel };

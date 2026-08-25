import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon, IconButton } from "../../components/Icon";
import { useT } from "../../lib/i18n";
import { ActivityDots } from "../chat/activity";
import type {
  AgentRunEvent,
  AgentUsageEvent,
  AskUserEvent,
  CompactResultEvent,
  GuardConfirmEvent,
  RuntimeConfig,
  ToolSummary,
  UsagePeriod,
} from "../../lib/runtimeBridge";

type RunDetailsProps = {
  /** Defaults to run-details so the shell toggle can reference this panel. */
  id?: string;
  open: boolean;
  onClose: () => void;
  status?: string;
  phase?: string;
  run?: AgentRunEvent;
  usage?: AgentUsageEvent;
  totals?: UsagePeriod;
  toolSummary?: ToolSummary;
  ask?: AskUserEvent;
  guard?: GuardConfirmEvent;
  /** 压缩过程/结果（由 session.compact_result 驱动）。 */
  compact?: CompactResultEvent;
  config?: RuntimeConfig;
  modelRef?: string;
  canConfigure: boolean;
  controlsDisabled?: boolean;
  onCompact: () => Promise<void>;
  onUpdateModel: (model: string) => Promise<void>;
  onResume?: () => Promise<void>;
};
function tokenCount(value?: number) {
  return value
    ? Intl.NumberFormat("en", { notation: "compact" }).format(value)
    : "—";
}
export function RunDetails(props: RunDetailsProps) {
  const t = useT();
  const {
    id = "run-details",
    open,
    onClose,
    status,
    phase,
    run,
    usage,
    totals,
    ask,
    guard,
    compact,
    config,
    modelRef,
    canConfigure,
    controlsDisabled,
    onCompact,
    onUpdateModel,
    onResume,
  } = props;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setError(undefined);
  }, [ask?.id, guard?.id]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => closeButtonRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("run.requestFailed"),
      );
    } finally {
      setBusy(false);
    }
  }
  const context = usage?.context_tokens ?? usage?.estimated_context_tokens;
  const contextPercent =
    context && usage?.context_window
      ? Math.min(100, (context / usage.context_window) * 100)
      : 0;
  // 缓存命中率：缓存读取 token 占输入 token 的比例（DeepSeek 前缀缓存）。
  const cachePercent =
    usage?.cache_read_tokens && usage.input_tokens
      ? Math.min(100, (usage.cache_read_tokens / usage.input_tokens) * 100)
      : undefined;
  const selectedModel = modelRef ?? "";
  const modelOptions = [
    ...(config?.models.some(
      (model) => `${model.provider}/${model.model}` === selectedModel,
    ) || !selectedModel
      ? []
      : [
          {
            value: selectedModel,
            label: t("run.unavailableBadge", { model: selectedModel }),
          },
        ]),
    ...(config?.models.map((model) => {
      const ref = `${model.provider}/${model.model}`;
      return { value: ref, label: ref };
    }) ?? []),
  ];
  return (
    <>
      {/* 详情遮罩：常驻 DOM，is-visible 控制淡入淡出（CSS 过渡）。 */}
      <button
        aria-label={t("run.close")}
        className={`details-scrim ${open ? "is-visible" : ""}`}
        onClick={onClose}
        tabIndex={open ? 0 : -1}
        type="button"
      />
      <aside
        aria-hidden={!open}
        aria-label={t("run.detailsLabel")}
        className={`details-panel ${open ? "is-open" : ""}`}
        id={id}
        inert={!open ? true : undefined}
      >
        <div className="mb-5 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-extrabold tracking-[0.095em] text-ink-muted uppercase">
              {t("run.currentSession")}
            </p>
            <h2 className="mt-1 text-[16px] font-extrabold text-ink">
              {t("run.title")}
            </h2>
          </div>
          <IconButton
            buttonRef={closeButtonRef}
            label={t("run.close")}
            onClick={onClose}
          >
            <Icon name="close" size={18} />
          </IconButton>
        </div>
        <div className="details-scroll">
          <section
            aria-live="polite"
            className="relative overflow-hidden rounded-2xl border border-line bg-surface-subtle p-3.5"
          >
            {/* 顶部品牌色渐变细条：与用户消息/发送按钮统一视觉语言 */}
            <span
              aria-hidden="true"
              className="absolute inset-x-0 top-0 h-[2.5px] bg-[linear-gradient(90deg,#5b67f1,#6d5df0_55%,#7c54e8)]"
            />
            <div className="flex items-center gap-3">
              <span className="running-orb">
                <i />
              </span>
              <div className="min-w-0 flex-1">
                <strong className="block text-[13px] font-extrabold text-ink">
                  {status === "running"
                    ? t("run.running")
                    : status === "waiting"
                      ? t("run.waiting")
                      : status === "compacting"
                        ? t("run.compacting")
                        : t("run.idle")}
                </strong>
                <small className="block truncate text-[11px] text-ink-muted">
                  {phase
                    ? t("run.phase", { phase })
                    : status === "running"
                      ? t("run.processing")
                      : status === "waiting"
                        ? t("run.replyToContinue")
                        : t("run.idleHint")}
                </small>
              </div>
              {status !== "running" && onResume && (
                <button
                  className="shrink-0 cursor-pointer rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 text-[11px] font-bold text-ink transition-colors duration-150 hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-45"
                  disabled={busy}
                  onClick={() => void act(onResume)}
                  type="button"
                >
                  {t("run.resume")}
                </button>
              )}
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-ink-soft">
              {run?.state === "retrying"
                ? t("run.retrying", {
                    attempt: run.attempt ?? 0,
                    max: run.max_attempts ?? 0,
                    seconds: run.delay_ms ? Math.ceil(run.delay_ms / 1000) : 0,
                  })
                : run?.message || t("run.liveStatus")}
            </p>
            {run?.error && (
              <small className="mt-1 block text-[12px] font-semibold text-rose">
                {run.error.message}
              </small>
            )}
            {run?.run_error && (
              <small className="mt-1 block text-[12px] font-semibold text-rose">
                {run.run_error.kind === "session_model_unavailable"
                  ? t("run.modelUnavailable", {
                      model: run.run_error.model_ref ?? "—",
                    })
                  : t("run.noModel")}
              </small>
            )}
          </section>
          {(ask || guard) && (
            <section className="mt-4 rounded-2xl border border-amber/30 bg-amber-soft/50 p-3.5 animate-[panel-pop_220ms_cubic-bezier(0.2,0.8,0.2,1)_both]">
              <div className="flex items-center gap-2.5">
                <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-amber/15 text-amber">
                  <Icon name="warning" size={17} />
                </span>
                <div>
                  <strong className="block text-[13px] font-extrabold text-ink">
                    {guard ? t("guard.title") : t("ask.title")}
                  </strong>
                  <small className="text-[11px] text-ink-muted">
                    {guard ? guard.tool : t("ask.replyToContinue")}
                  </small>
                </div>
              </div>
              <p className="mt-2 text-[12px] leading-relaxed text-ink-soft">
                {guard ? guard.reason : ask?.question}
              </p>
              {guard?.suggestion && (
                <p className="mt-1.5 rounded-lg border border-amber/25 bg-amber/10 px-2.5 py-2 text-[12px] leading-relaxed text-ink-soft">
                  <span className="font-extrabold text-ink">
                    {t("guard.suggest")}
                  </span>
                  <code className="font-mono">{guard.suggestion}</code>
                </p>
              )}
              {/* 只读摘要：决策按钮在时间线内嵌决策卡上（设计 §7.4），
                  右栏不重复操作，避免同一决策两处可点分散注意力。 */}
              <small className="mt-2 block text-[11px] font-semibold text-ink-muted">
                {t("run.approveInChat")}
              </small>
              {(ask && !ask.can_reply) || (guard && !guard.can_reply) ? (
                <small className="mt-1 block text-[11px] text-ink-muted">
                  {t("decision.otherClient")}
                </small>
              ) : null}
              {error && (
                <small className="mt-2 block text-[12px] font-semibold text-rose">
                  {error}
                </small>
              )}
            </section>
          )}
          <section
            className="border-t border-line pt-4 mt-4 animate-[message-in_260ms_cubic-bezier(0.2,0.8,0.2,1)_both]"
            key={`usage-${usage?.run_id ?? "none"}-${status ?? "none"}`}
          >
            <div className="mb-2 flex items-center justify-between">
              <h3 className="m-0 text-[13px] font-bold text-ink">
                {t("run.usage")}
              </h3>
              <button
                aria-label={t("run.compact")}
                className="cursor-pointer rounded-lg border border-line px-2 py-1 text-[11px] font-bold text-ink-soft transition-colors duration-150 hover:bg-surface-subtle hover:text-ink disabled:cursor-not-allowed disabled:opacity-45"
                disabled={
                  controlsDisabled ||
                  status === "running" ||
                  status === "compacting" ||
                  compact?.running
                }
                onClick={() => void act(onCompact)}
                type="button"
              >
                {t("run.compact")}
              </button>
            </div>
            {/* 压缩过程/结果：running 动画 → 完成结果（N→M tokens）→ 失败错误 */}
            {compact?.running ? (
              <div className="mb-2 flex items-center gap-2 rounded-lg border border-blue/25 bg-blue-soft/40 px-2.5 py-2 text-[12px] font-bold text-blue-strong">
                <ActivityDots />
                {t("run.compactingNow")}
              </div>
            ) : compact?.error ? (
              <div className="mb-2 rounded-lg border border-rose/25 bg-rose/10 px-2.5 py-2 text-[12px] font-semibold text-rose">
                {t("run.compactFailed", { error: compact.error })}
              </div>
            ) : compact?.noop ? (
              <div className="mb-2 rounded-lg border border-line bg-surface-raised/60 px-2.5 py-2 text-[12px] font-semibold text-ink-muted">
                {t("run.compactNoop")}
              </div>
            ) : compact ? (
              <div className="mb-2 rounded-lg border border-green/25 bg-green-soft/40 px-2.5 py-2 text-[12px] font-semibold text-ink">
                <span className="font-bold text-green">✓</span>{" "}
                {t("run.compacted", {
                  before: tokenCount(compact.before_tokens),
                  after: tokenCount(compact.after_tokens),
                })}
                {compact.turns_compressed
                  ? ` · ${t("run.turnsCompressed", {
                      count: compact.turns_compressed,
                    })}`
                  : ""}
              </div>
            ) : null}
            <div className="flex items-center justify-between border-b border-line py-2 text-[13px]">
              <span className="text-ink-muted">{t("run.inputOutput")}</span>
              <b className="text-ink">
                {tokenCount(usage?.input_tokens)} /{" "}
                {tokenCount(usage?.output_tokens)}
              </b>
            </div>
            {usage?.cache_read_tokens !== undefined &&
              cachePercent !== undefined && (
                <>
                  <div className="flex items-center justify-between border-b border-line py-2 text-[13px]">
                    <span className="text-ink-muted">{t("run.cacheHit")}</span>
                    <b className="text-green">{cachePercent.toFixed(0)}%</b>
                  </div>
                  <div className="mt-2 mb-2.5 h-[5px] overflow-hidden rounded-full bg-surface-subtle">
                    <span
                      className="block h-full rounded-full bg-green transition-[width] duration-500"
                      style={{ width: `${cachePercent}%` }}
                    />
                  </div>
                </>
              )}
            <div className="flex items-center justify-between border-b border-line py-2 text-[13px]">
              <span className="text-ink-muted">{t("run.todayRequests")}</span>
              <b className="text-ink">{totals?.requests ?? "—"}</b>
            </div>
            <div className="mt-2.5 h-[5px] overflow-hidden rounded-full bg-surface-subtle">
              <span
                className="block h-full rounded-full bg-blue transition-[width] duration-500"
                style={{ width: `${contextPercent}%` }}
              />
            </div>
            {usage?.context_window && (
              <small className="mt-1.5 block text-[11px] text-ink-muted">
                {t("run.context", {
                  used: tokenCount(context),
                  total: tokenCount(usage.context_window),
                })}
              </small>
            )}
          </section>
          {canConfigure && config && (
            <section className="border-t border-line pt-4 mt-4">
              <h3 className="m-0 mb-2 text-[13px] font-bold text-ink">
                {t("run.sessionModel")}
              </h3>
              <button
                aria-label={t("run.sessionModel")}
                className="flex min-h-10 w-full cursor-pointer items-center justify-between gap-3 rounded-lg border border-line bg-surface-raised px-3 py-2 text-left text-[13px] font-semibold text-ink transition-colors duration-150 hover:border-line-strong hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-45"
                disabled={!selectedModel || controlsDisabled || busy}
                onClick={() => setModelPickerOpen(true)}
                title={selectedModel}
                type="button"
              >
                <span className="min-w-0 truncate">{selectedModel}</span>
                <Icon
                  className="shrink-0 text-ink-muted"
                  name="chevron-down"
                  size={14}
                />
              </button>
              <ModelPickerModal
                models={modelOptions}
                onClose={() => setModelPickerOpen(false)}
                onSelect={(value) =>
                  void act(async () => {
                    await onUpdateModel(value);
                    setModelPickerOpen(false);
                  })
                }
                open={modelPickerOpen}
                selectedModel={selectedModel}
              />
            </section>
          )}
        </div>
      </aside>
    </>
  );
}

type ModelOption = { value: string; label: string; disabled?: boolean };

function ModelPickerModal({
  open,
  selectedModel,
  models,
  onSelect,
  onClose,
}: {
  open: boolean;
  selectedModel: string;
  models: ModelOption[];
  onSelect: (value: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = requestAnimationFrame(() => panelRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <button
        aria-label={t("common.close")}
        className="absolute inset-0 h-full w-full cursor-default border-0 bg-[rgb(15_18_28_/_0.48)] animate-[scrim-in_160ms_ease_both]"
        onClick={onClose}
        tabIndex={-1}
        type="button"
      />
      <div
        aria-label={t("run.sessionModel")}
        aria-modal="true"
        className="relative grid w-[min(560px,calc(100vw-32px))] max-h-[min(680px,calc(100vh-48px))] animate-[panel-pop_180ms_cubic-bezier(0.2,0.8,0.2,1)_both] overflow-hidden rounded-2xl border border-line bg-surface-solid shadow-lg focus:outline-none"
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-[16px] font-extrabold text-ink">
              {t("run.selectSessionModel")}
            </h2>
            <p className="mt-1 truncate text-[12px] text-ink-muted">
              {selectedModel}
            </p>
          </div>
          <button
            aria-label={t("common.close")}
            className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-lg text-ink-muted transition-colors duration-150 hover:bg-surface-subtle hover:text-ink"
            onClick={onClose}
            type="button"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="max-h-[min(560px,calc(100vh-170px))] overflow-y-auto p-2">
          {models.map((model) => {
            const selected = model.value === selectedModel;
            return (
              <button
                className="flex w-full cursor-pointer items-center justify-between gap-4 rounded-xl px-3 py-3 text-left transition-colors duration-100 hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-55"
                disabled={model.disabled}
                key={model.value}
                onClick={() => onSelect(model.value)}
                type="button"
              >
                <span className="min-w-0">
                  <span className="block break-all text-[13px] font-semibold text-ink">
                    {model.label}
                  </span>
                  <span className="mt-0.5 block break-all text-[11px] text-ink-muted">
                    {model.value}
                  </span>
                </span>
                {selected && (
                  <Icon
                    className="shrink-0 text-blue-strong"
                    name="check"
                    size={16}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}

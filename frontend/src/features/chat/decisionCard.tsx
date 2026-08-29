import { useState } from "react";
import { Icon } from "../../components/Icon";
import { useT } from "../../lib/i18n";
import type { AskUserEvent, GuardConfirmEvent } from "../../lib/runtimeBridge";

/** AskUser 自定义回答输入：回车发送，IME 组合输入时不误触。 */
export function AskInlineInput({
  disabled,
  onSubmit,
}: {
  disabled: boolean;
  onSubmit: (answer: string) => void;
}) {
  const t = useT();
  const [answer, setAnswer] = useState("");
  return (
    <div className="mt-2.5 flex gap-1.5">
      <input
        aria-label={t("ask.answer")}
        className="min-w-0 flex-1 rounded-lg border border-line bg-surface-solid px-2.5 py-2 text-ink focus:border-blue/50 focus:ring-2 focus:ring-blue/25 focus:outline-none"
        disabled={disabled}
        onChange={(event) => setAnswer(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            if (answer.trim() && !disabled) {
              onSubmit(answer.trim());
              setAnswer("");
            }
          }
        }}
        placeholder={t("ask.inputPlaceholder")}
        value={answer}
      />
      <button
        className="cursor-pointer rounded-lg bg-blue px-3 text-[12px] font-bold text-white shadow-[0_4px_10px_var(--color-blue-glow)] transition-colors duration-150 hover:bg-blue-strong disabled:cursor-not-allowed disabled:opacity-45"
        disabled={disabled || !answer.trim()}
        onClick={() => {
          onSubmit(answer.trim());
          setAnswer("");
        }}
        type="button"
      >
        {t("ask.send")}
      </button>
    </div>
  );
}

/** 内嵌决策卡：Guard 授权 / AskUser 问答，出现在产生它的上下文旁边。
 * guard 带 suggestion 时展示三按钮（按建议执行/拒绝/批准原操作），
 * 对齐 suna Guard 的 modify 决策语义（设计 §7.4）。 */
export function DecisionCard({
  ask,
  guard,
  controlsDisabled,
  onAskReply,
  onGuardReply,
}: {
  ask?: AskUserEvent;
  guard?: GuardConfirmEvent;
  controlsDisabled: boolean;
  onAskReply?: (id: string, answer: string) => Promise<void>;
  onGuardReply?: (
    id: string,
    decision: "approve" | "reject" | "modify",
  ) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const t = useT();
  if (!ask && !guard) return null;
  // 提交中禁用全部决策按钮，避免快速连点重复入队。
  async function reply(fn: () => Promise<void> | undefined) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      aria-atomic="true"
      aria-live="polite"
      className="mb-7 max-w-[520px] animate-[panel-pop_220ms_cubic-bezier(0.2,0.8,0.2,1)_both] rounded-[15px] border border-amber/30 bg-amber-soft/70 p-3.5 shadow-sm"
      role="status"
    >
      <div className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-amber/15 text-amber">
          <Icon name="warning" size={17} />
        </span>
        <div className="min-w-0">
          <strong className="block text-[13px] font-extrabold text-ink">
            {guard ? t("guard.title") : t("ask.title")}
          </strong>
          <small className="truncate text-[11px] text-ink-muted">
            {guard ? guard.tool : t("ask.replyToContinue")}
          </small>
        </div>
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-ink-soft">
        {guard ? guard.reason : ask?.question}
      </p>
      {guard?.suggestion && (
        <p className="mt-1.5 rounded-lg border border-amber/25 bg-amber/10 px-2.5 py-2 text-[12px] leading-relaxed text-ink-soft">
          <span className="font-extrabold text-ink">{t("guard.suggest")}</span>
          <code className="font-mono">{guard.suggestion}</code>
        </p>
      )}
      {(ask && !ask.can_reply) || (guard && !guard.can_reply) ? (
        <small className="mt-1.5 block text-[11px] font-semibold text-ink-muted">
          {t("decision.unavailable")}
        </small>
      ) : null}
      {ask && ask.options && ask.options.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {ask.options.map((option) => (
            <button
              className="cursor-pointer rounded-[7px] border border-line bg-surface-solid px-2.5 py-1.5 text-[12px] font-semibold text-ink transition-colors duration-150 hover:border-blue/40 hover:text-blue-strong disabled:cursor-not-allowed disabled:opacity-45"
              disabled={!ask.can_reply || controlsDisabled || busy}
              key={option}
              onClick={() => void reply(() => onAskReply?.(ask.id, option))}
              type="button"
            >
              {option}
            </button>
          ))}
        </div>
      )}
      {ask && ask.allow_custom && (
        <AskInlineInput
          disabled={!ask.can_reply || controlsDisabled}
          onSubmit={(answer) => void reply(() => onAskReply?.(ask.id, answer))}
        />
      )}
      {guard && (
        <div className="mt-2.5 flex gap-2">
          {guard.suggestion ? (
            // 有修改建议：三按钮（按建议执行 = modify / 拒绝 / 批准原操作）
            <button
              className="flex-1 cursor-pointer rounded-lg bg-blue px-3 py-2 text-[12px] font-semibold text-white transition-colors duration-150 hover:bg-blue-strong active:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
              disabled={!guard.can_reply || controlsDisabled || busy}
              onClick={() =>
                void reply(() => onGuardReply?.(guard.id, "modify"))
              }
              type="button"
            >
              {t("guard.modify")}
            </button>
          ) : (
            <button
              className="flex-1 cursor-pointer rounded-lg bg-blue px-3 py-2 text-[12px] font-bold text-white shadow-[0_4px_10px_var(--color-blue-glow)] transition-colors duration-150 hover:bg-blue-strong disabled:cursor-not-allowed disabled:opacity-45"
              disabled={!guard.can_reply || controlsDisabled || busy}
              onClick={() =>
                void reply(() => onGuardReply?.(guard.id, "approve"))
              }
              type="button"
            >
              {t("guard.approve")}
            </button>
          )}
          <button
            className="flex-1 cursor-pointer rounded-lg border border-line bg-surface-solid px-3 py-2 text-[12px] font-bold text-ink transition-colors duration-150 hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-45"
            disabled={!guard.can_reply || controlsDisabled || busy}
            onClick={() => void reply(() => onGuardReply?.(guard.id, "reject"))}
            type="button"
          >
            {t("guard.reject")}
          </button>
          {guard.suggestion && (
            <button
              className="flex-1 cursor-pointer rounded-lg border border-line bg-surface-solid px-3 py-2 text-[12px] font-bold text-ink transition-colors duration-150 hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-45"
              disabled={!guard.can_reply || controlsDisabled || busy}
              onClick={() =>
                void reply(() => onGuardReply?.(guard.id, "approve"))
              }
              type="button"
            >
              {t("guard.approveOriginal")}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

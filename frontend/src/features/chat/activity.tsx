import { useState } from "react";
import { Icon } from "../../components/Icon";
import { useT, type Translate } from "../../lib/i18n";
import { LazyMarkdown } from "./LazyMarkdown";

function activityCopy(
  t: Translate,
  phase?: string,
  pending?: boolean,
  activeTool?: { tool: string; intent?: string; status?: string },
) {
  if (phase === "ask") {
    return {
      label: t("activity.ask"),
      detail: t("activity.askDetail"),
      tone: "ask",
    };
  }
  if (activeTool?.status === "failed") {
    return {
      label: t("activity.toolFailed"),
      detail: activeTool.intent || activeTool.tool,
      tone: "failed",
    };
  }
  if (activeTool?.status === "guard" || phase === "guard") {
    return {
      label: t("activity.guard"),
      detail:
        activeTool?.intent || activeTool?.tool || t("activity.guardDetail"),
      tone: "guard",
    };
  }
  if (phase === "compact" || phase === "compacting") {
    return {
      label: t("activity.compact"),
      detail: t("activity.compactDetail"),
      tone: "compact",
    };
  }
  if (phase === "skill") {
    return {
      label: t("activity.skill"),
      detail: t("activity.skillDetail"),
      tone: "skill",
    };
  }
  if (activeTool || phase === "tool") {
    return {
      label:
        activeTool?.status === "running"
          ? t("activity.toolRunning")
          : t("activity.toolPreparing"),
      detail:
        activeTool?.intent || activeTool?.tool || t("activity.toolDetail"),
      tone: "tool",
    };
  }
  if (phase === "model") {
    return {
      label: t("activity.model"),
      detail: t("activity.modelDetail"),
      tone: "model",
    };
  }
  if (pending) {
    return {
      label: t("activity.pending"),
      detail: t("activity.pendingDetail"),
      tone: "pending",
    };
  }
  return {
    label: t("activity.processing"),
    detail: t("activity.nextStep"),
    tone: "model",
  };
}

export { activityCopy };

export function ActivityDots() {
  return (
    <span aria-hidden="true" className="inline-flex items-center gap-[3px]">
      <i className="h-1 w-1 animate-[activity-dot_1.15s_ease-in-out_infinite_both] rounded-full bg-current" />
      <i className="h-1 w-1 animate-[activity-dot_1.15s_ease-in-out_infinite_both] rounded-full bg-current [animation-delay:140ms]" />
      <i className="h-1 w-1 animate-[activity-dot_1.15s_ease-in-out_infinite_both] rounded-full bg-current [animation-delay:280ms]" />
    </span>
  );
}

export function StreamActivity({
  label,
  detail,
}: {
  label: string;
  detail?: string;
}) {
  return (
    <span className="ml-0.5 inline-flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-blue-strong">
      <ActivityDots />
      <span role="status">{label}</span>
      {detail && (
        <span className="max-w-[175px] truncate text-[11px] text-ink-muted">
          · {detail}
        </span>
      )}
    </span>
  );
}

/** 思考段：琥珀色 brain 头像，与蓝色 sparkle 的正式回复区分；
 * 未结束时显示“思考中 + 呼吸点”，结束后折叠为可展开的过程记录。 */
export function ReasoningBlock({
  text,
  running,
  done,
}: {
  text: string;
  running: boolean;
  done?: boolean;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  return (
    <article className="animate-[message-in_440ms_cubic-bezier(0.2,0.8,0.2,1)_both]">
      <button
        aria-expanded={expanded}
        className="mb-1.5 flex w-full cursor-pointer items-center gap-1.5 text-[11px] text-ink-soft"
        onClick={() => setExpanded((value) => !value)}
        type="button"
      >
        <span className="shrink-0 text-ink-muted">
          <Icon name="brain" size={13} />
        </span>
        <strong className="text-ink">Suna</strong>
        <span className="ml-0.5 inline-flex items-center gap-1 text-[10.5px] font-medium text-ink-muted">
          <Icon
            className={`transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
            name="chevron-down"
            size={12}
          />
          {done
            ? expanded
              ? t("chat.collapseThinking")
              : t("chat.viewThinking")
            : t("chat.thinking")}
        </span>
        {running && !done && <StreamActivity label={t("chat.thinking")} />}
      </button>
      {expanded && (
        <div className="markdown-body min-w-0 max-w-[650px] animate-[panel-pop_180ms_cubic-bezier(0.2,0.8,0.2,1)_both] border-l-2 border-line-strong pl-3 text-[13px] leading-[1.75] text-ink-soft [overflow-wrap:anywhere]">
          <LazyMarkdown>{text}</LazyMarkdown>
        </div>
      )}
    </article>
  );
}

export const toneClasses: Record<string, string> = {
  guard:
    "bg-amber-soft/70 border-amber/30 [&_.agent-activity-icon]:text-amber [&_.activity-dots]:text-amber",
  failed:
    "bg-rose/10 border-rose/25 [&_.agent-activity-icon]:text-rose [&_.activity-dots]:text-rose",
  default:
    "bg-blue-soft/60 border-blue/25 [&_.agent-activity-icon]:text-blue-strong [&_.activity-dots]:text-blue",
};

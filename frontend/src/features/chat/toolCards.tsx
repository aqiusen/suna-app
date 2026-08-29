import { useState } from "react";
import { Icon } from "../../components/Icon";
import { useT } from "../../lib/i18n";
import type {
  SkillFlowItem,
  SubtaskFlowItem,
  ToolFlowItem,
  ToolSummary,
} from "../../lib/runtimeBridge";

/** 格式化工具耗时：不足 1 秒显示毫秒，超过显示秒（一位小数）。 */
export function formatDuration(ms?: number) {
  if (ms == null) return undefined;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** 工具行折叠态的目标摘要：优先 intent，其次 params 里的路径/命令。 */
export function toolTarget(item: ToolFlowItem) {
  if (item.intent) return item.intent;
  const params = item.params ?? {};
  const candidates = [params.path, params.command, params.url, params.pattern];
  const found = candidates.find((value) => typeof value === "string" && value);
  return typeof found === "string" ? found : undefined;
}

/** 工具行：单行状态 + 工具名 + 目标摘要 + 耗时，点击展开参数与结果。
 * 紧凑形态是主流 agent UI 的共识（Claude Code / Cursor / OpenHands），
 * 一屏可扫读更多工具，展开才看细节。 */
export function ToolRow({ item }: { item: ToolFlowItem }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [resultCopied, setResultCopied] = useState(false);
  const status = item.status;
  const statusMeta = {
    running: {
      dot: "bg-blue animate-pulse",
      label: t("tool.running"),
      text: "text-blue-strong",
    },
    guard: {
      dot: "bg-amber animate-pulse",
      label: t("tool.guard"),
      text: "text-amber",
    },
    success: {
      dot: "bg-green animate-[pop-in_260ms_cubic-bezier(0.2,0.8,0.2,1)_both]",
      label: t("tool.success"),
      text: "text-green",
    },
    failed: { dot: "bg-rose", label: t("tool.failed"), text: "text-rose" },
  }[status];
  const hasDetail =
    Boolean(item.params && Object.keys(item.params).length > 0) ||
    Boolean(item.result) ||
    Boolean(item.error);
  // 图标单色无底色：Codex 式低噪音工具行，状态只由左侧圆点 + 颜色表达。
  const target = toolTarget(item);
  const duration = formatDuration(item.durationMs);
  return (
    <article className="animate-[message-in_320ms_cubic-bezier(0.2,0.8,0.2,1)_both] overflow-hidden rounded-lg border border-transparent transition-colors duration-150 hover:border-line hover:bg-surface-subtle/60">
      <button
        aria-expanded={expanded}
        className="flex w-full min-w-0 cursor-pointer items-center gap-2 px-2 py-[6px] text-left disabled:cursor-default"
        disabled={!hasDetail}
        onClick={() => setExpanded((value) => !value)}
        type="button"
      >
        <span
          aria-hidden="true"
          className={`h-[6px] w-[6px] shrink-0 rounded-full ${statusMeta.dot}`}
        />
        <Icon className="shrink-0 text-ink-muted" name="tool" size={13} />
        <code className="shrink-0 font-mono text-[11.5px] font-medium text-ink">
          {item.tool}
        </code>
        {target && (
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-muted">
            {target}
          </span>
        )}
        {duration && (
          <time className="shrink-0 font-mono text-[10.5px] text-ink-muted">
            {duration}
          </time>
        )}
        {/* 状态文字仅非成功态显示：成功靠绿点即可，减少一行内的视觉元素。 */}
        {status !== "success" && (
          <span className={`shrink-0 text-[11px] ${statusMeta.text}`}>
            {statusMeta.label}
          </span>
        )}
        {hasDetail && (
          <Icon
            name="chevron-down"
            size={12}
            className={`shrink-0 text-ink-muted transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
          />
        )}
      </button>
      {expanded && hasDetail && (
        <div className="mx-2 mb-2 space-y-2 rounded-lg border border-line/70 bg-surface-raised/60 px-2.5 py-2">
          {item.params && Object.keys(item.params).length > 0 && (
            <div>
              <span className="mb-1 block text-[10px] font-extrabold uppercase tracking-wide text-ink-muted">
                {t("chat.params")}
              </span>
              <pre className="max-h-[180px] overflow-auto rounded-lg bg-surface-raised p-2.5 font-mono text-[10.5px] leading-relaxed text-ink-soft">
                {JSON.stringify(item.params, null, 2)}
              </pre>
            </div>
          )}
          {item.result && !item.error && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="block text-[10px] font-extrabold uppercase tracking-wide text-ink-muted">
                  {t("chat.result")}
                </span>
                <button
                  aria-label={
                    resultCopied ? t("chat.resultCopied") : t("chat.copyResult")
                  }
                  className={`grid h-5 w-5 cursor-pointer place-items-center rounded-md transition-colors duration-150 hover:bg-surface-subtle ${
                    resultCopied
                      ? "text-green"
                      : "text-ink-muted hover:text-ink"
                  }`}
                  onClick={() => {
                    // 剪贴板写入失败静默忽略（非安全上下文等场景）。
                    void navigator.clipboard
                      ?.writeText(item.result ?? "")
                      .catch(() => undefined);
                    setResultCopied(true);
                    window.setTimeout(() => setResultCopied(false), 1600);
                  }}
                  type="button"
                >
                  <Icon name={resultCopied ? "check" : "copy"} size={11} />
                </button>
              </div>
              <pre className="max-h-[220px] overflow-auto whitespace-pre-wrap rounded-lg bg-surface-raised p-2.5 font-mono text-[10.5px] leading-relaxed text-ink-soft">
                {item.result}
                {item.resultTruncated && (
                  <span className="mt-1 block text-[10px] font-semibold text-ink-muted">
                    {t("chat.resultTruncated")}
                  </span>
                )}
              </pre>
            </div>
          )}
          {item.error && (
            <div>
              <span className="mb-1 block text-[10px] font-extrabold uppercase tracking-wide text-rose">
                {t("chat.error")}
              </span>
              <pre className="max-h-[180px] overflow-auto whitespace-pre-wrap rounded-lg bg-surface-raised p-2.5 font-mono text-[10.5px] leading-relaxed text-rose">
                {item.result}
              </pre>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

/** 技能行：单行状态 + 技能名 + 徽章，review 结论点击展开（SkillCard 行化）。 */
export function SkillRow({ item }: { item: SkillFlowItem }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const statusMeta = {
    loading: {
      dot: "bg-blue animate-pulse",
      label: t("skill.loading"),
      text: "text-blue-strong",
    },
    reviewing: {
      dot: "bg-amber animate-pulse",
      label: t("skill.reviewing"),
      text: "text-amber",
    },
    loaded: { dot: "bg-green", label: t("skill.loaded"), text: "text-green" },
    done: { dot: "bg-green", label: t("skill.done"), text: "text-green" },
    error: { dot: "bg-rose", label: t("skill.error"), text: "text-rose" },
  }[item.status];
  const iconTone = {
    loading: "text-ink-muted",
    reviewing: "text-ink-muted",
    loaded: "text-ink-muted",
    done: "text-ink-muted",
    error: "text-rose",
  }[item.status];
  return (
    <article className="animate-[message-in_320ms_cubic-bezier(0.2,0.8,0.2,1)_both] overflow-hidden rounded-lg border border-transparent transition-colors duration-150 hover:border-line hover:bg-surface-subtle/60">
      <button
        aria-expanded={expanded}
        className="flex w-full min-w-0 cursor-pointer items-center gap-2 px-2 py-[6px] text-left disabled:cursor-default"
        disabled={!item.detail}
        onClick={() => setExpanded((value) => !value)}
        type="button"
      >
        <span
          aria-hidden="true"
          className={`h-[6px] w-[6px] shrink-0 rounded-full ${statusMeta.dot}`}
        />
        <span className={`shrink-0 ${iconTone}`}>
          <Icon name="book" size={13} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-ink">
          {t("chat.skill", { name: item.name })}
        </span>
        {item.status !== "loaded" && item.status !== "done" && (
          <span className={`shrink-0 text-[11px] ${statusMeta.text}`}>
            {statusMeta.label}
          </span>
        )}
        {item.detail && (
          <Icon
            name="chevron-down"
            size={12}
            className={`shrink-0 text-ink-muted transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
          />
        )}
      </button>
      {expanded && item.detail && (
        <div className="mx-2 mb-2 rounded-lg border border-line/70 bg-surface-raised/60 px-2.5 py-2">
          <pre className="max-h-[180px] overflow-auto whitespace-pre-wrap rounded-lg bg-surface-raised p-2.5 font-mono text-[10.5px] leading-relaxed text-ink-soft">
            {item.detail}
          </pre>
        </div>
      )}
    </article>
  );
}

/** 兼容别名：旧调用点（测试/外部）仍可引用 ToolCard/SkillCard 名称。 */
export const ToolCard = ToolRow;
export const SkillCard = SkillRow;

/** 子任务组：折叠行显示任务目标 + 工具数 + 状态，展开后内嵌工具行。
 * 由 spawn 工具的 tool_start/end 创建与结算，组内工具来自
 * `spawn:<spawnID>:<toolID>` 命名空间（suna 协议透传）。 */
export function SubtaskCard({ item }: { item: SubtaskFlowItem }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const statusMeta = {
    running: {
      dot: "bg-blue animate-pulse",
      label: t("subtask.running"),
      text: "text-blue-strong",
    },
    success: {
      dot: "bg-green animate-[pop-in_260ms_cubic-bezier(0.2,0.8,0.2,1)_both]",
      label: t("subtask.success"),
      text: "text-green",
    },
    failed: { dot: "bg-rose", label: t("subtask.failed"), text: "text-rose" },
  }[item.status];
  const iconTone = {
    running: "text-ink-muted",
    success: "text-ink-muted",
    failed: "text-rose",
  }[item.status];
  const toolCount = item.tools.length;
  return (
    <article className="animate-[message-in_320ms_cubic-bezier(0.2,0.8,0.2,1)_both] overflow-hidden rounded-lg border border-line/80 bg-surface-solid/70 transition-colors duration-150 hover:border-line-strong">
      <button
        aria-expanded={expanded}
        className="flex w-full min-w-0 cursor-pointer items-center gap-2 px-2 py-[6px] text-left"
        onClick={() => setExpanded((value) => !value)}
        type="button"
      >
        <Icon
          className={`shrink-0 text-ink-muted transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
          name="chevron-right"
          size={12}
        />
        <span
          aria-hidden="true"
          className={`h-[6px] w-[6px] shrink-0 rounded-full ${statusMeta.dot}`}
        />
        <span className={`shrink-0 ${iconTone}`}>
          <Icon name="users" size={13} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-ink">
          {item.task || t("chat.subtask")}
        </span>
        <span className="shrink-0 text-[10.5px] text-ink-muted">
          {toolCount > 0 ? t("chat.subtaskTools", { count: toolCount }) : ""}
        </span>
        {item.status !== "success" && (
          <span className={`shrink-0 text-[11px] ${statusMeta.text}`}>
            {statusMeta.label}
          </span>
        )}
      </button>
      {expanded && (
        <div className="mx-1 mb-1 grid gap-0.5 border-t border-line/60 pt-1">
          {item.tools.map((tool) => (
            <ToolRow item={tool} key={tool.id} />
          ))}
          {toolCount === 0 && (
            <p className="px-2 py-1.5 text-[10.5px] text-ink-muted">
              {item.status === "running"
                ? t("chat.subtaskWaiting")
                : t("chat.subtaskNoTools")}
            </p>
          )}
          {item.result && (
            <pre className="mx-1 mb-1 mt-1 max-h-[160px] overflow-auto whitespace-pre-wrap rounded-lg bg-surface-raised p-2.5 font-mono text-[10.5px] leading-relaxed text-ink-soft">
              {item.result}
            </pre>
          )}
        </div>
      )}
    </article>
  );
}

/** 快照兜底的工具汇总：默认收起，避免 HTTP 状态行占对话主区。 */
export function ToolSummaryCard({ summary }: { summary: ToolSummary }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const recent = summary.recent?.slice(0, 4) ?? [];
  return (
    <article className="mb-7 max-w-[520px] overflow-hidden rounded-lg border border-transparent transition-colors duration-150 hover:border-line hover:bg-surface-subtle/60">
      <button
        aria-expanded={expanded}
        className="flex w-full min-w-0 cursor-pointer items-center gap-2 px-2 py-[6px] text-left disabled:cursor-default"
        disabled={recent.length === 0}
        onClick={() => setExpanded((value) => !value)}
        type="button"
      >
        <Icon
          className={`shrink-0 text-ink-muted transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
          name="chevron-right"
          size={12}
        />
        <Icon className="shrink-0 text-ink-muted" name="tool" size={13} />
        <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-ink">
          {t("toolSummary.title")}
        </span>
        <span className="shrink-0 text-[10.5px] text-ink-muted">
          {t("toolSummary.total", {
            total: summary.total,
            success: summary.success,
          })}
          {summary.failed > 0 && (
            <span className="text-rose">
              {" "}
              {t("toolSummary.failed", { failed: summary.failed })}
            </span>
          )}
        </span>
      </button>
      {expanded &&
        recent.map((tool, index) => (
          <div
            className="flex items-center gap-2 border-t border-line/60 px-2 py-2 text-[11px]"
            key={`${tool.tool}-${index}`}
          >
            <span
              aria-hidden="true"
              className={`h-[6px] w-[6px] shrink-0 rounded-full ${tool.status === "success" ? "bg-green" : tool.status === "failed" ? "bg-rose" : "bg-ink-muted"}`}
            />
            <code className="shrink-0 font-mono text-[11px] font-semibold text-ink">
              {tool.tool}
            </code>
            {tool.summary && (
              <span className="truncate text-ink-muted">{tool.summary}</span>
            )}
          </div>
        ))}
    </article>
  );
}

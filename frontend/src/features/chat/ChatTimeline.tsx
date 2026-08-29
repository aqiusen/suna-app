import {
  Fragment,
  useLayoutEffect,
  useRef,
  useState,
  type UIEvent,
} from "react";
import { Icon } from "../../components/Icon";
import type {
  AgentRunEvent,
  AskUserEvent,
  FlowSegment,
  GuardConfirmEvent,
  ToolSummary,
} from "../../lib/runtimeBridge";
import {
  activityCopy,
  ActivityDots,
  ReasoningBlock,
  StreamActivity,
  toneClasses,
} from "./activity";
import { DecisionCard } from "./decisionCard";
import { LONG_MESSAGE_THRESHOLD, LongMessage } from "./longMessage";
import { SkillCard, SubtaskCard, ToolCard, ToolSummaryCard } from "./toolCards";
import { LazyMarkdown } from "./LazyMarkdown";
import { QueuedMessages } from "./QueuedMessages";
import { useT } from "../../lib/i18n";
import type { QueuedMessage } from "../runtime/sessionState";
import type { FlowTurn, TimelineMessage } from "../runtime/sessionState";

type ActiveTool = {
  id?: string;
  tool: string;
  intent?: string;
  status?: "running" | "guard" | "failed";
};

type ChatTimelineProps = {
  messages: TimelineMessage[];
  /** 本轮 run 的按序叙事流：思考 / 工具 / 回复按到达顺序排列。 */
  flow?: FlowSegment[];
  /** 每个用户回合在运行流中的起点，按 Runtime 应用顺序提供。 */
  flowTurns?: FlowTurn[];
  running: boolean;
  /** Runtime 阶段（由应用壳提供时）。 */
  phase?: string;
  /** 当前 run 状态；失败时把 Runtime 返回的错误展示到对话流。 */
  run?: AgentRunEvent;
  /** 已发送、正在等待 Runtime 响应的用户回合。 */
  pending?: boolean;
  /** 当前正在执行的 Runtime 工具（由应用壳提供时）。 */
  activeTool?: ActiveTool;
  /** 当前会话的工具执行汇总。 */
  toolSummary?: ToolSummary;
  /** 待处理的用户决策，内嵌渲染在时间线中。 */
  ask?: AskUserEvent;
  guard?: GuardConfirmEvent;
  onAskReply?: (id: string, answer: string) => Promise<void>;
  onGuardReply?: (
    id: string,
    decision: "approve" | "reject" | "modify",
  ) => Promise<void>;
  /** 另一个客户端拥有 run 时禁用决策控件。 */
  controlsDisabled?: boolean;
  /** Runtime attach 了其他会话时变化，用于重置滚动锚点。 */
  sessionId?: string;
  /** 会话快照加载中时显示骨架占位。 */
  loading?: boolean;
  /** 空状态建议卡点击：把示例 prompt 交给外层（填入输入框）。 */
  onSuggestion?: (text: string) => void;
  /** 把当前选中的时间线文本作为引用追加到输入框。 */
  onQuoteSelection?: (text: string) => void;
  queuedMessages?: QueuedMessage[];
  queueControlsDisabled?: boolean;
  onRemoveQueuedMessage?: (item: QueuedMessage) => void;
  onInterruptQueuedMessage?: (item: QueuedMessage) => void;
};

export function ChatTimeline({
  messages,
  flow = [],
  flowTurns = [],
  running,
  phase,
  run,
  pending,
  activeTool,
  toolSummary,
  ask,
  guard,
  onAskReply,
  onGuardReply,
  controlsDisabled = false,
  sessionId,
  loading = false,
  onSuggestion,
  onQuoteSelection,
  queuedMessages = [],
  queueControlsDisabled = false,
  onRemoveQueuedMessage,
  onInterruptQueuedMessage,
}: ChatTimelineProps) {
  const t = useT();
  const [historyWindow, setHistoryWindow] = useState(80);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [selectionAction, setSelectionAction] = useState<{
    text: string;
    x: number;
    y: number;
  }>();
  const [selectionCopied, setSelectionCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const historyAnchorRef = useRef<{ height: number; top: number } | undefined>(
    undefined,
  );
  const historyStart = Math.max(0, messages.length - historyWindow);
  const visibleMessages = messages.slice(historyStart);
  // 正在 dispatch 的队首已经进入 pendingUsers / 时间线，不能再标成“排队中”。
  const waitingMessages = queuedMessages.filter(
    (item) => !messages.some((message) => message.id === item.id),
  );
  const scrollToLatest = (behavior: ScrollBehavior = "smooth") => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior });
    nearBottomRef.current = true;
    setShowJumpToLatest(false);
  };
  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    const nearBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight < 96;
    nearBottomRef.current = nearBottom;
    setShowJumpToLatest(!nearBottom);
    setSelectionAction(undefined);
    setSelectionCopied(false);
  };
  const copySelectedText = async (text: string) => {
    try {
      await navigator.clipboard?.writeText(text);
      setSelectionCopied(true);
    } catch {
      // 剪贴板不可用时静默失败，选区仍可用浏览器原生复制。
    }
  };
  const updateSelectionAction = () => {
    const root = scrollRef.current;
    const selection = window.getSelection();
    if (
      !root ||
      !selection ||
      selection.isCollapsed ||
      selection.rangeCount === 0
    ) {
      setSelectionAction(undefined);
      return;
    }
    const anchor = selection.anchorNode;
    const focus = selection.focusNode;
    if (
      (anchor && !root.contains(anchor)) ||
      (focus && !root.contains(focus))
    ) {
      setSelectionAction(undefined);
      return;
    }
    const text = selection.toString().trim();
    if (!text) {
      setSelectionAction(undefined);
      return;
    }
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    setSelectionAction({
      text,
      x: Math.min(
        window.innerWidth - 88,
        Math.max(88, rect.left + rect.width / 2),
      ),
      y: Math.max(12, rect.top - 12),
    });
    setSelectionCopied(false);
    void copySelectedText(text);
  };
  useLayoutEffect(() => {
    // 不同的会话可能恰好包含相同数量的消息：重置时间线而不是继承
    // 上一个会话的滚动位置。
    nearBottomRef.current = true;
    setShowJumpToLatest(false);
    setSelectionAction(undefined);
    setSelectionCopied(false);
    setHistoryWindow(80);
    requestAnimationFrame(() => scrollToLatest("auto"));
  }, [sessionId]);
  useLayoutEffect(() => {
    const anchor = historyAnchorRef.current;
    const element = scrollRef.current;
    if (!anchor || !element) return;
    element.scrollTop = anchor.top + (element.scrollHeight - anchor.height);
    historyAnchorRef.current = undefined;
  }, [historyWindow]);
  useLayoutEffect(() => {
    // 只在读者已经位于最新边缘时保持活跃对话锚定；浏览历史时绝不能被
    // 强制滚动离开。
    if (nearBottomRef.current) scrollToLatest("auto");
  }, [
    activeTool?.id,
    activeTool?.status,
    flow,
    flowTurns,
    messages.length,
    pending,
    phase,
    queuedMessages,
    running,
    sessionId,
  ]);

  const hasStream = flow.some(
    (segment) =>
      (segment.kind === "reasoning" || segment.kind === "assistant") &&
      !segment.done,
  );
  const showActivityCard = Boolean((running || pending) && !hasStream);
  const streamActivity = activityCopy(t, phase, false, activeTool);
  const activity = activityCopy(t, phase, pending, activeTool);
  const toneClass = toneClasses[activity.tone] ?? toneClasses.default;
  const sortedTurns = [...flowTurns].sort(
    (left, right) => left.flowStart - right.flowStart,
  );
  const anchoredFlow = new Set<number>();
  const flowForTurn = (turnId: string) => {
    const turnIndex = sortedTurns.findIndex((turn) => turn.turnId === turnId);
    if (turnIndex < 0) return [];
    const start = sortedTurns[turnIndex]!.flowStart;
    const end = sortedTurns[turnIndex + 1]?.flowStart ?? flow.length;
    for (let index = start; index < end; index++) anchoredFlow.add(index);
    return flow.slice(start, end);
  };
  const renderFlow = (segments: FlowSegment[]) => (
    <div aria-label={t("chat.processLabel")} className="space-y-0.5">
      {segments.map((segment) => {
        if (segment.kind === "reasoning") {
          return (
            <div className="mb-6" key={segment.id}>
              <ReasoningBlock
                done={segment.done}
                running={running && !segment.done}
                text={segment.text}
              />
            </div>
          );
        }
        if (segment.kind === "tool") {
          return <ToolCard item={segment.item} key={segment.item.id} />;
        }
        if (segment.kind === "skill") {
          return (
            <SkillCard item={segment.item} key={`skill-${segment.item.name}`} />
          );
        }
        if (segment.kind === "subtask") {
          return (
            <SubtaskCard
              item={segment.item}
              key={`subtask-${segment.item.id}`}
            />
          );
        }
        const streaming = !segment.done;
        return (
          <article
            className="arriving mb-6 animate-[message-in_360ms_cubic-bezier(0.2,0.8,0.2,1)_both] [animation-delay:80ms]"
            key={segment.id}
          >
            <div className="mb-2 flex items-center gap-1.5 text-[11px] text-ink-soft">
              <span className="grid h-[21px] w-[21px] place-items-center rounded-md bg-ink text-white">
                <Icon name="sparkle" size={14} />
              </span>
              <strong className="text-ink">Suna</strong>
              {streaming && (running || pending) && (
                <StreamActivity
                  label={t("chat.replying")}
                  detail={streamActivity.detail}
                />
              )}
            </div>
            <div
              className={`min-w-0 max-w-[650px] text-[13.5px] leading-[1.78] [overflow-wrap:anywhere] ${streaming ? "text-ink whitespace-pre-wrap" : "markdown-body text-ink"}`}
            >
              {streaming ? (
                <>
                  {segment.text}
                  <span
                    aria-hidden="true"
                    className="ml-[3px] inline-block h-[1em] w-[2px] animate-[stream-blink_1s_steps(1)_infinite] rounded-[1px] bg-blue align-[-0.15em]"
                  />
                </>
              ) : (
                <LazyMarkdown>{segment.text}</LazyMarkdown>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
  const activeTurnId = sortedTurns.at(-1)?.turnId;
  const runErrorNotice =
    run?.state === "failed" ? <RunErrorNotice run={run} /> : undefined;
  const activityCard = showActivityCard && (
    <section
      aria-atomic="true"
      aria-live="polite"
      className={`mb-7 grid max-w-[520px] min-h-[56px] animate-[message-in_360ms_cubic-bezier(0.2,0.8,0.2,1)_both] grid-cols-[26px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-xl border p-3 ${toneClass}`}
      role="status"
    >
      <span className="agent-activity-icon grid h-[26px] w-[26px] place-items-center rounded-lg bg-surface-solid">
        <Icon
          name={activity.tone === "guard" ? "warning" : "sparkle"}
          size={14}
        />
      </span>
      <span className="grid min-w-0 gap-0.5">
        <span className="text-[12px] font-semibold text-ink">
          {activity.label}
        </span>
        <small className="truncate text-[11px] leading-[1.4] text-ink-muted">
          {activity.detail}
        </small>
      </span>
      <ActivityDots />
    </section>
  );

  return (
    <div
      className="conversation-wrap"
      onKeyUp={updateSelectionAction}
      onMouseUp={updateSelectionAction}
      onScroll={onScroll}
      onTouchEnd={updateSelectionAction}
      ref={scrollRef}
    >
      {selectionAction && (
        <div
          className="fixed z-30 flex -translate-x-1/2 -translate-y-full overflow-hidden rounded-xl border border-line bg-surface-solid text-[12px] font-extrabold text-ink shadow-lg"
          onMouseDown={(event) => event.preventDefault()}
          style={{ left: selectionAction.x, top: selectionAction.y }}
        >
          {onQuoteSelection && (
            <button
              className="flex cursor-pointer items-center gap-1.5 px-3 py-2 transition-colors duration-150 hover:bg-surface-raised"
              onClick={() => {
                onQuoteSelection(selectionAction.text);
                setSelectionAction(undefined);
                setSelectionCopied(false);
                window.getSelection()?.removeAllRanges();
              }}
              type="button"
            >
              <Icon name="turn" size={13} />
              {t("chat.addSelectionToConversation")}
            </button>
          )}
          <span
            aria-live="polite"
            className={`flex items-center gap-1.5 px-3 py-2 text-ink-muted ${onQuoteSelection ? "border-l border-line" : ""}`}
          >
            <Icon name={selectionCopied ? "check" : "copy"} size={13} />
            {selectionCopied ? t("chat.selectionCopied") : t("chat.copying")}
          </span>
        </div>
      )}
      <section
        aria-label={t("chat.timelineLabel")}
        className="animate-[message-in_300ms_cubic-bezier(0.2,0.8,0.2,1)_both] mx-auto w-[min(860px,calc(100%-48px))] px-0 pt-8 pb-12 max-[720px]:w-[min(100%-28px,640px)] max-[720px]:pt-6 max-[720px]:pb-7"
        key={sessionId ?? "none"}
      >
        {loading && (
          <div aria-busy="true" className="space-y-7">
            {[0, 1, 2].map((i) => (
              <div key={i} className="animate-pulse">
                <div className="mb-2 flex items-center gap-1.5">
                  <div className="h-[21px] w-[21px] rounded-[7px] bg-surface-subtle" />
                  <div className="h-2.5 w-14 rounded bg-surface-subtle" />
                </div>
                <div className="space-y-2">
                  <div className="h-3 w-full max-w-[420px] rounded bg-surface-subtle" />
                  <div className="h-3 w-3/4 max-w-[320px] rounded bg-surface-subtle" />
                </div>
              </div>
            ))}
          </div>
        )}
        {!loading &&
          messages.length === 0 &&
          flow.length === 0 &&
          !showActivityCard && (
            <div className="flex min-h-[300px] animate-[message-in_440ms_cubic-bezier(0.2,0.8,0.2,1)_both] flex-col items-center justify-center text-center">
              {/* 空状态：单色图标 + 静态呈现，专业工具不做装饰性漂浮。 */}
              <span className="grid h-12 w-12 place-items-center rounded-xl border border-line bg-surface-solid text-ink-muted">
                <Icon name="sparkle" size={20} />
              </span>
              <h2 className="mt-4 mb-1.5 text-[17px] font-extrabold tracking-tight text-ink">
                {t("chat.empty.title")}
              </h2>
              <p className="m-0 max-w-[300px] text-[12.5px] leading-relaxed text-ink-muted">
                {t("chat.empty.desc")}
              </p>
              {onSuggestion && (
                <div className="mt-6 grid gap-2 text-left">
                  <button
                    className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-line bg-surface-solid px-3.5 py-2.5 text-left shadow-sm transition-[transform,border-color,box-shadow] duration-180 hover:-translate-y-px hover:border-blue/25 hover:shadow-md active:scale-[0.985]"
                    onClick={() => onSuggestion?.(t("chat.suggestion.analyze"))}
                    type="button"
                  >
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-blue-soft text-blue-strong">
                      <Icon name="search" size={14} />
                    </span>
                    <span className="text-[12px] text-ink-soft">
                      {t("chat.suggestion.analyzeLabel")}
                    </span>
                  </button>
                  <button
                    className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-line bg-surface-solid px-3.5 py-2.5 text-left shadow-sm transition-[transform,border-color,box-shadow] duration-180 hover:-translate-y-px hover:border-green/30 hover:shadow-md active:scale-[0.985]"
                    onClick={() => onSuggestion?.(t("chat.suggestion.fix"))}
                    type="button"
                  >
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-green-soft text-green">
                      <Icon name="check" size={14} />
                    </span>
                    <span className="text-[12px] text-ink-soft">
                      {t("chat.suggestion.fixLabel")}
                    </span>
                  </button>
                </div>
              )}
            </div>
          )}
        {!loading && messages.length > historyWindow && (
          <button
            className="mb-6 block cursor-pointer rounded-full bg-blue-soft px-3 py-2 text-[11px] font-extrabold text-blue-strong transition-[transform,background] duration-160 hover:bg-blue/20 hover:-translate-y-px mx-auto"
            onClick={() => {
              const element = scrollRef.current;
              if (element)
                historyAnchorRef.current = {
                  height: element.scrollHeight,
                  top: element.scrollTop,
                };
              setHistoryWindow((count) => count + 80);
            }}
            type="button"
          >
            {t("chat.moreHistory", {
              count: Math.min(80, messages.length - historyWindow),
            })}
          </button>
        )}
        {!loading &&
          (() => {
            return visibleMessages.map((message) => {
              const turnFlow =
                message.role === "user" ? flowForTurn(message.id) : [];
              return (
                <Fragment key={message.id}>
                  <article
                    className={`group mb-8 animate-[message-in_440ms_cubic-bezier(0.2,0.8,0.2,1)_both] max-[720px]:mb-7`}
                  >
                    <div
                      className={`mb-2 flex items-center gap-1.5 text-[11px] text-ink-soft ${message.role === "user" ? "flex-row-reverse" : ""}`}
                    >
                      <button
                        aria-label={t("chat.copyMessage")}
                        className="grid h-6 w-6 animate-[slide-in-right_160ms_cubic-bezier(0.2,0.8,0.2,1)_both] cursor-pointer place-items-center rounded-md text-ink-muted opacity-0 transition-opacity duration-150 hover:bg-surface-subtle hover:text-ink focus:opacity-100 group-hover:opacity-100 max-[720px]:opacity-100"
                        onClick={() => {
                          // 剪贴板写入失败静默忽略（非安全上下文等场景）。
                          void navigator.clipboard
                            ?.writeText(message.content)
                            .catch(() => undefined);
                        }}
                        type="button"
                      >
                        <Icon name="copy" size={12} />
                      </button>
                      <span
                        className={
                          message.role === "user"
                            ? "grid h-[21px] w-[21px] place-items-center rounded-md border border-line bg-surface-subtle text-[7px] font-bold text-ink-soft"
                            : "grid h-[21px] w-[21px] place-items-center rounded-md bg-ink text-white"
                        }
                      >
                        {message.role === "user" ? (
                          t("chat.user")
                        ) : (
                          <Icon name="sparkle" size={14} />
                        )}
                      </span>
                      <strong className="text-ink">
                        {message.role === "user" ? t("chat.user") : "Suna"}
                      </strong>
                    </div>
                    <div
                      className={`min-w-0 text-[13.5px] leading-[1.78] [overflow-wrap:anywhere] max-[720px]:text-[13px] ${message.role === "user" ? "flex justify-end" : "max-w-[780px] text-ink"}`}
                    >
                      {message.role === "assistant" ? (
                        message.content.length > LONG_MESSAGE_THRESHOLD ? (
                          <LongMessage text={message.content} />
                        ) : (
                          // 助手消息：Codex 式无气泡——仅靠留白与头像区分，不包卡片。
                          <div className="markdown-body">
                            <LazyMarkdown>{message.content}</LazyMarkdown>
                          </div>
                        )
                      ) : (
                        // 用户消息：右对齐浅底块，去渐变与投影，靠位置区分说话人。
                        <span className="inline-block max-w-[min(720px,100%)] rounded-xl bg-surface-subtle px-3.5 py-2.5 text-[13.5px] leading-[1.7] text-ink">
                          {message.content}
                        </span>
                      )}
                    </div>
                  </article>
                  {turnFlow.length > 0 && renderFlow(turnFlow)}
                  {message.id === activeTurnId && runErrorNotice}
                  {message.id === activeTurnId && activityCard}
                </Fragment>
              );
            });
          })()}
        {!loading && (
          <DecisionCard
            ask={ask}
            controlsDisabled={controlsDisabled}
            guard={guard}
            onAskReply={onAskReply}
            onGuardReply={onGuardReply}
          />
        )}
        {!loading &&
          renderFlow(flow.filter((_, index) => !anchoredFlow.has(index)))}
        {!loading && !activeTurnId && runErrorNotice}
        {!loading && !activeTurnId && activityCard}
        {!loading &&
          flow.filter((segment) => segment.kind === "tool").length === 0 &&
          toolSummary &&
          toolSummary.total > 0 && <ToolSummaryCard summary={toolSummary} />}
        {onRemoveQueuedMessage &&
          onInterruptQueuedMessage &&
          !loading &&
          waitingMessages.length > 0 && (
            <QueuedMessages
              disabled={queueControlsDisabled}
              items={waitingMessages}
              onInterrupt={onInterruptQueuedMessage}
              onRemove={onRemoveQueuedMessage}
            />
          )}
      </section>
      {showJumpToLatest && (
        <button
          className="animate-[slide-up_240ms_cubic-bezier(0.2,0.8,0.2,1)_both] sticky bottom-4 left-1/2 z-10 -mt-4 mb-4 flex w-fit cursor-pointer items-center gap-1.5 rounded-full border border-blue/25 bg-surface-solid/95 px-3 py-2 text-[11px] font-extrabold text-blue-strong shadow-md backdrop-blur-xl transition-[transform,background] duration-160 hover:bg-surface-solid hover:-translate-y-px"
          onClick={() => scrollToLatest()}
          type="button"
        >
          <Icon name="arrow-down" size={14} />
          {t("chat.backToLatest")}
        </button>
      )}
    </div>
  );
}

function RunErrorNotice({ run }: { run: AgentRunEvent }) {
  const t = useT();
  const detail =
    run.error?.message ??
    run.message ??
    (run.run_error?.model_ref
      ? t("chat.runFailedModel", { model: run.run_error.model_ref })
      : t("chat.runFailedGeneric"));
  const status =
    run.error?.status_code !== undefined
      ? t("chat.runFailedStatus", { status: String(run.error.status_code) })
      : "";

  return (
    <section
      aria-label={t("chat.runFailed")}
      className="mb-7 grid max-w-[650px] grid-cols-[26px_minmax(0,1fr)] gap-2.5 rounded-xl border border-rose/30 bg-rose/8 p-3 text-rose"
      role="alert"
    >
      <span className="grid h-[26px] w-[26px] place-items-center rounded-lg bg-surface-solid">
        <Icon name="warning" size={14} />
      </span>
      <span className="grid min-w-0 gap-1">
        <strong className="text-[12px]">{t("chat.runFailed")}</strong>
        <span className="text-[12px] leading-relaxed [overflow-wrap:anywhere]">
          {status ? `${status} ${detail}` : detail}
        </span>
      </span>
    </section>
  );
}

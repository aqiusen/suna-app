import type { Dispatch, SetStateAction } from "react";
import type {
  MCPServerInfo,
  RuntimeConfig,
  RuntimeNotification,
  SessionInfo,
  ToolFlowItem,
} from "../../lib/runtimeBridge";
import { t } from "../../lib/i18n";
import { appendFlowTurn, messageId } from "./sessionState";
import type { ActiveData, Scope } from "./sessionState";

/** 单个 run 的时间线工具卡上限：超出丢弃最旧，避免超长 run 累积 DOM。 */
const MAX_TOOL_CARDS = 24;

export type NotificationDeps = {
  setActive: Dispatch<SetStateAction<ActiveData>>;
  setConfig: Dispatch<SetStateAction<RuntimeConfig | undefined>>;
  queueDelta: (
    kind: "assistant" | "reasoning",
    content: string,
    runId?: string,
  ) => void;
  flushDeltas: () => void;
  acceptsRun: (runId?: string) => boolean;
  acceptsSession: (sessionId?: string) => boolean;
  mergeSession: (session: SessionInfo) => void;
  /** 运行终态兜底：把目录中该 session 的 status 置为 idle，不依赖 session.updated 通知。 */
  markSessionIdle: (sessionId?: string) => void;
  mergeMcp: (server: MCPServerInfo) => void;
  getScope: () => Scope | undefined;
  isSyncing: () => boolean;
  getSelectedId: () => string | undefined;
  /** 供“调整方向”在当前 run 终态后继续发送新的用户消息。 */
  onRunTerminal?: (
    runId: string,
    state: "done" | "failed" | "cancelled",
  ) => void;
  /** 权威 run 进入非终态时绑定其作用域，拒绝旧 run 的迟到事件。 */
  onRunActive?: (runId: string) => void;
  /** session.updated=idle 是漏收终态通知时的权威收敛信号。 */
  onSessionIdle?: (runId?: string) => void;
};

/**
 * 构造 Runtime 通知处理器。事件与当前 attach 作用域绑定：
 * 会话无关的全局通知（session.updated 目录增量、config.state）始终处理；
 * 会话相关通知（agent.*、session.user_message）必须匹配当前作用域。
 * receivedAt 为解析层收到事件时刻（工具计时起点/终点），比在 React
 * setState 回调里取 Date.now() 更接近真实执行窗口。
 */
export function createNotificationHandler({
  setActive,
  setConfig,
  queueDelta,
  flushDeltas,
  acceptsRun,
  acceptsSession,
  mergeSession,
  markSessionIdle,
  mergeMcp,
  getScope,
  isSyncing,
  getSelectedId,
  onRunTerminal,
  onRunActive,
  onSessionIdle,
}: NotificationDeps) {
  return (event: RuntimeNotification, receivedAt = Date.now()) => {
    if (event.method === "session.updated") {
      mergeSession(event.params.session);
      if (acceptsSession(event.params.session.id)) {
        let reconciled = false;
        let reconciledRunId: string | undefined;
        setActive((value) => {
          if (value.snapshot?.session.id !== event.params.session.id)
            return value;
          const staleRun =
            event.params.session.status === "idle" &&
            (value.awaitingRun ||
              value.run?.state === "running" ||
              value.run?.state === "retrying" ||
              value.run?.state === "cancelling" ||
              value.snapshot.current_run?.status !== "idle");
          reconciled = staleRun;
          reconciledRunId = staleRun
            ? (value.run?.run_id ?? value.snapshot.current_run?.run_id)
            : undefined;
          return {
            ...value,
            snapshot: {
              ...value.snapshot,
              session: event.params.session,
              // Catalog 已权威确认 idle，不能让旧 current_run 继续锁住输入。
              current_run: staleRun ? undefined : value.snapshot.current_run,
            },
            run: staleRun
              ? value.run
                ? { ...value.run, state: "done", can_control: false }
                : undefined
              : value.run,
            ask: staleRun ? undefined : value.ask,
            guard: staleRun ? undefined : value.guard,
            awaitingRun: staleRun ? undefined : value.awaitingRun,
            flow: staleRun
              ? value.flow.map((segment) =>
                  segment.kind === "assistant" || segment.kind === "reasoning"
                    ? { ...segment, done: true }
                    : segment,
                )
              : value.flow,
          };
        });
        if (reconciled) onSessionIdle?.(reconciledRunId);
      }
      return;
    }
    if (event.method === "config.state") {
      setConfig(event.params);
      return;
    }
    // 0.4 MCP 状态增量：按 server 名覆盖本地快照，驱动设置面板状态徽章。
    if (event.method === "mcp.updated") {
      mergeMcp(event.params.server);
      return;
    }
    if (event.method === "agent.delta") {
      if (!acceptsRun(event.params.run_id)) return;
      queueDelta(event.params.kind, event.params.content, event.params.run_id);
      return;
    }
    if (event.method === "agent.run") {
      if (!acceptsRun(event.params.run_id)) return;
      const terminal =
        event.params.state === "done" ||
        event.params.state === "cancelled" ||
        event.params.state === "failed";
      if (!terminal && event.params.run_id) onRunActive?.(event.params.run_id);
      // 终态事件前先提交本帧内积压的 delta，避免最后一段内容重复出现。
      if (event.params.state === "done") flushDeltas();
      let completedRunId: string | undefined;
      setActive((value) => {
        const next: ActiveData = {
          ...value,
          run: event.params,
          // 收到权威 run 事件（含终态）即结束“等待模型”窗口。
          awaitingRun: false,
          snapshot: value.snapshot
            ? {
                ...value.snapshot,
                current_run: {
                  run_id: event.params.run_id,
                  status:
                    event.params.state === "done" ||
                    event.params.state === "cancelled" ||
                    event.params.state === "failed"
                      ? "idle"
                      : // cancelling/retrying/running 都保持 running 展示：
                        // 取消收尾阶段 UI 仍应显示任务在进行，can_control 以
                        // 事件参数为准（cancelling 时 Runtime 会置 false）。
                        "running",
                  phase: event.params.phase,
                  can_control: event.params.can_control,
                },
              }
            : value.snapshot,
        };
        // 本地 FIFO 在发起 RPC 前已创建 turn；首个非终态 run 事件到达时，
        // 将 Runtime run_id 固定绑定到该槽位。后续 delta 先经 run_id 过滤，
        // 再由这个槽位决定展示位置，不能漂到时间线末尾。
        if (!terminal && event.params.run_id) {
          const index = value.flowTurns.length - 1;
          const last = value.flowTurns[index];
          if (last && !last.runId)
            next.flowTurns = value.flowTurns.map((turn, turnIndex) =>
              turnIndex === index
                ? { ...turn, runId: event.params.run_id }
                : turn,
            );
        }
        // 运行终态兜底：sessions 目录的 status 可能因 session.updated 通知
        // 丢失（重连窗口）而卡在 running，导致 observer 误判、输入框禁用；
        // 这里直接以 run 事件为准同步置为 idle。
        if (terminal) {
          markSessionIdle(getSelectedId());
          completedRunId = event.params.run_id;
        }
        // 叙事流保留：思考/回复段全部标为已结束，工具卡与回复块作为
        // 本轮操作流继续显示在时间线中（不再清空、不再拍平成消息）。
        if (event.params.state === "done" && value.snapshot) {
          next.flow = value.flow.map((segment) =>
            segment.kind === "assistant" || segment.kind === "reasoning"
              ? { ...segment, done: true }
              : segment,
          );
        }
        return next;
      });
      // setActive 已先把 run/current_run 收敛为终态。此后才触发 FIFO，
      // 让 drain 能看到 idle，不能在 updater 内看到上一轮仍 running 的 ref。
      if (completedRunId)
        onRunTerminal?.(
          completedRunId,
          event.params.state as "done" | "failed" | "cancelled",
        );
      return;
    }
    if (event.method === "agent.usage") {
      if (!acceptsRun(event.params.run_id)) return;
      setActive((value) => ({ ...value, usage: event.params }));
      return;
    }
    if (event.method === "agent.tool_start") {
      const scope = getScope();
      if (isSyncing() || !scope || scope.sessionId !== getSelectedId()) return;
      const id = event.params.id;
      const subtaskMatch = id.match(/^spawn:([^:]+):(.+)$/);
      const isSpawn = event.params.tool === "spawn";
      setActive((value) => {
        // 工具开始 = 之前的思考/回复段落结束；工具卡按顺序插入叙事流。
        const flow = value.flow.map((segment) =>
          segment.kind === "assistant" || segment.kind === "reasoning"
            ? { ...segment, done: true }
            : segment,
        );
        // 工具已开始执行：明确结束“等待模型”窗口。
        const base = { ...value, awaitingRun: false };
        // 子任务内部工具（id 前缀 spawn:<spawnID>:）：归入对应子任务组。
        if (subtaskMatch) {
          const spawnId = subtaskMatch[1];
          const index = flow.findIndex(
            (segment) =>
              segment.kind === "subtask" && segment.item.id === spawnId,
          );
          if (index < 0) return { ...base, flow };
          const segment = flow[index];
          if (segment.kind !== "subtask") return { ...base, flow };
          const item: ToolFlowItem = {
            id,
            tool: event.params.tool,
            intent: event.params.intent,
            params: event.params.params,
            status: "running",
            startedAt: receivedAt,
          };
          const next = [...flow];
          next[index] = {
            kind: "subtask",
            item: { ...segment.item, tools: [...segment.item.tools, item] },
          };
          return {
            ...base,
            activeTool: { ...event.params, status: "running" },
            flow: next,
          };
        }
        // spawn 工具自身：创建子任务组段（替代普通工具行）。
        if (isSpawn) {
          const task =
            typeof event.params.params?.task === "string"
              ? event.params.params.task
              : event.params.intent;
          return {
            ...base,
            activeTool: { ...event.params, status: "running" },
            flow: [
              ...flow,
              {
                kind: "subtask",
                item: {
                  id,
                  task,
                  status: "running" as const,
                  tools: [],
                },
              },
            ],
          };
        }
        const item: ToolFlowItem = {
          id,
          tool: event.params.tool,
          intent: event.params.intent,
          params: event.params.params,
          status: "running",
          // 前端本地计时：以解析层收到 tool_start 的时刻为起点（receivedAt），
          // tool_end 结算耗时。相比在 setState 回调里取 Date.now()，能消除
          // React 事件循环排队造成的计时起点偏晚。
          startedAt: receivedAt,
        };
        // 单 run 工具卡硬上限：超长 run 会累积大量 DOM，丢弃最旧的
        // 工具段保持叙事顺序，历史细节由 toolSummary 统计兜底。
        const toolCount = flow.filter(
          (segment) => segment.kind === "tool",
        ).length;
        if (toolCount >= MAX_TOOL_CARDS) {
          const firstToolIndex = flow.findIndex(
            (segment) => segment.kind === "tool",
          );
          if (firstToolIndex >= 0) flow.splice(firstToolIndex, 1);
        }
        return {
          ...base,
          activeTool: { ...event.params, status: "running" },
          flow: [...flow, { kind: "tool", item }],
        };
      });
      return;
    }
    if (event.method === "agent.tool_guard") {
      const subtaskMatch =
        event.params.tool_call_id.match(/^spawn:([^:]+):(.+)$/);
      setActive((value) => {
        // 子任务内部工具的 guard：更新组内对应工具状态。
        if (subtaskMatch) {
          const spawnId = subtaskMatch[1];
          return {
            ...value,
            flow: value.flow.map((segment) =>
              segment.kind === "subtask" && segment.item.id === spawnId
                ? {
                    ...segment,
                    item: {
                      ...segment.item,
                      tools: segment.item.tools.map((tool) =>
                        tool.id === event.params.tool_call_id
                          ? { ...tool, status: "guard" as const }
                          : tool,
                      ),
                    },
                  }
                : segment,
            ),
          };
        }
        return {
          ...value,
          activeTool:
            value.activeTool?.id === event.params.tool_call_id
              ? { ...value.activeTool, status: "guard" }
              : value.activeTool,
          flow: value.flow.map((segment) =>
            segment.kind === "tool" &&
            segment.item.id === event.params.tool_call_id
              ? {
                  ...segment,
                  item: { ...segment.item, status: "guard" as const },
                }
              : segment,
          ),
        };
      });
      return;
    }
    if (event.method === "agent.tool_end") {
      const subtaskMatch = event.params.id.match(/^spawn:([^:]+):(.+)$/);
      const isSpawn = event.params.tool === "spawn";
      setActive((value) => {
        // 子任务内部工具结束：更新组内工具状态与耗时。
        if (subtaskMatch) {
          const spawnId = subtaskMatch[1];
          return {
            ...value,
            activeTool:
              value.activeTool?.id === event.params.id
                ? event.params.error
                  ? { ...value.activeTool, status: "failed" }
                  : undefined
                : value.activeTool,
            flow: value.flow.map((segment) =>
              segment.kind === "subtask" && segment.item.id === spawnId
                ? {
                    ...segment,
                    item: {
                      ...segment.item,
                      tools: segment.item.tools.map((tool) =>
                        tool.id === event.params.id
                          ? {
                              ...tool,
                              status: event.params.error
                                ? ("failed" as const)
                                : ("success" as const),
                              result: event.params.result,
                              resultTruncated: event.params.result_truncated,
                              error: event.params.error,
                              durationMs:
                                tool.startedAt != null
                                  ? receivedAt - tool.startedAt
                                  : undefined,
                            }
                          : tool,
                      ),
                    },
                  }
                : segment,
            ),
          };
        }
        // spawn 工具自身结束：结算子任务组状态（success/failed + 结果）。
        if (isSpawn) {
          return {
            ...value,
            activeTool: undefined,
            flow: value.flow.map((segment) =>
              segment.kind === "subtask" && segment.item.id === event.params.id
                ? {
                    ...segment,
                    item: {
                      ...segment.item,
                      status: event.params.error
                        ? ("failed" as const)
                        : ("success" as const),
                      result: event.params.result,
                      error: event.params.error,
                    },
                  }
                : segment,
            ),
          };
        }
        return {
          ...value,
          activeTool:
            value.activeTool?.id === event.params.id
              ? event.params.error
                ? { ...value.activeTool, status: "failed" }
                : undefined
              : value.activeTool,
          flow: value.flow.map((segment) =>
            segment.kind === "tool" && segment.item.id === event.params.id
              ? {
                  ...segment,
                  item: {
                    ...segment.item,
                    status: event.params.error
                      ? ("failed" as const)
                      : ("success" as const),
                    result: event.params.result,
                    resultTruncated: event.params.result_truncated,
                    error: event.params.error,
                    // tool_end 时结算耗时（以解析层收到事件时刻为终点）；
                    // 仅当 startedAt 缺失（如快照恢复）时不计。
                    durationMs:
                      segment.item.startedAt != null
                        ? receivedAt - segment.item.startedAt
                        : undefined,
                  },
                }
              : segment,
          ),
        };
      });
      return;
    }
    if (event.method === "agent.ask_user") {
      if (!acceptsSession(event.params.session_id)) return;
      setActive((value) => ({ ...value, ask: event.params }));
      return;
    }
    if (event.method === "agent.guard_confirm") {
      if (!acceptsSession(event.params.session_id)) return;
      setActive((value) => ({ ...value, guard: event.params }));
      return;
    }
    if (event.method === "agent.interaction_resolved") {
      if (!acceptsSession(event.params.session_id)) return;
      setActive((value) => ({
        ...value,
        ask: value.ask?.id === event.params.id ? undefined : value.ask,
        guard: value.guard?.id === event.params.id ? undefined : value.guard,
        activeTool:
          value.activeTool?.id === event.params.id
            ? { ...value.activeTool, status: undefined }
            : value.activeTool,
      }));
      return;
    }
    // Skill 加载 / 校验状态：按技能名合并到叙事流中的 skill 段。
    // 同名的 loading→loaded、reviewing→done/error 是同一段生命周期，
    // 更新已有段而不是重复插入，保持时间线紧凑。
    if (event.method === "skill.load" || event.method === "skill.review") {
      const scope = getScope();
      if (isSyncing() || !scope || scope.sessionId !== getSelectedId()) return;
      const name = event.params.name;
      const nextStatus =
        event.method === "skill.load"
          ? event.params.status === "loaded"
            ? ("loaded" as const)
            : ("loading" as const)
          : event.params.status === "done"
            ? ("done" as const)
            : event.params.status === "error"
              ? ("error" as const)
              : ("reviewing" as const);
      const detail =
        event.method === "skill.review"
          ? event.params.review || event.params.error
          : undefined;
      setActive((value) => {
        const index = value.flow.findIndex(
          (segment) => segment.kind === "skill" && segment.item.name === name,
        );
        if (index < 0) {
          return {
            ...value,
            flow: [
              ...value.flow,
              { kind: "skill", item: { name, status: nextStatus, detail } },
            ],
          };
        }
        const flow = [...value.flow];
        const segment = flow[index];
        if (segment.kind !== "skill") return value;
        flow[index] = {
          kind: "skill",
          item: {
            name,
            status: nextStatus,
            detail: detail ?? segment.item.detail,
          },
        };
        return { ...value, flow };
      });
      return;
    }
    // 压缩（compact）过程/结果：running=true 进入压缩中，running=false
    // 显示结果或错误。事件为全局通知，按当前作用域过滤。
    if (event.method === "session.compact_result") {
      const scope = getScope();
      if (isSyncing() || !scope || scope.sessionId !== getSelectedId()) return;
      setActive((value) => ({ ...value, compact: event.params }));
      return;
    }
    if (event.method === "session.user_message") {
      if (!acceptsSession(event.params.session_id)) return;
      const text = event.params.parts
        ?.filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n");
      const content =
        text ||
        (event.params.parts?.some((part) => part.type === "image")
          ? t("action.imagePlaceholder")
          : undefined);
      if (!content) return;
      setActive((value) => {
        const id = event.params.client_msg_id ?? messageId();
        // Runtime 会跳过向 initial sender 回显首条 user_message；后续 applied
        // steering 则会回显。两类本地消息都必须留在同一追加序列，不能混写
        // snapshot，否则 snapshot + pending 的拼接会倒置发送顺序。
        if (
          value.pendingUsers.some(
            (item) =>
              item.id === id ||
              (!event.params.client_msg_id && item.content === content),
          )
        )
          return value;
        return {
          ...value,
          pendingUsers: [...value.pendingUsers, { id, content }],
          flowTurns: appendFlowTurn(value, id),
        };
      });
      return;
    }
  };
}

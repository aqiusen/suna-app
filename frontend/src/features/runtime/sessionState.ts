import type {
  AgentRunEvent,
  AgentUsageEvent,
  AskUserEvent,
  CompactResultEvent,
  FlowSegment,
  GuardConfirmEvent,
  MessagePart,
  SnapshotMessage,
  SessionSnapshot,
  SessionStatus,
  ToolStartEvent,
  ToolSummary,
} from "../../lib/runtimeBridge";

/** 会话操作的作用域：attach 意图序号 + 会话 + 可选 run_id。 */
export type Scope = {
  attach: number;
  sessionId: string;
  runId?: string;
};

export type PendingUserMessage = { id: string; content: string };
/** 尚未交给 Runtime 的本地 FIFO 项。刷新页面后不恢复，避免伪造 Runtime 状态。 */
export type QueuedMessage = {
  id: string;
  content: string;
  parts: MessagePart[];
};
/** 每个运行中用户回合在叙事流中的起点，用于稳定交错渲染消息与执行过程。 */
/** 时间线中一个用户回合的稳定槽位；运行过程只能写入其所属槽位。 */
export type FlowTurn = { flowStart: number; turnId: string; runId?: string };
export type TimelineMessage = SnapshotMessage & { id: string };

/** 当前选中会话的活跃状态：快照、按序叙事流与待处理交互。 */
export type ActiveData = {
  snapshot?: SessionSnapshot;
  /** 本轮 run 的按序叙事流：思考 / 工具 / 回复按到达顺序排列。 */
  flow: FlowSegment[];
  /** 当前 run 中每个用户回合对应的 flow 起点，严格按 Runtime 应用顺序追加。 */
  flowTurns: FlowTurn[];
  usage?: AgentUsageEvent;
  run?: AgentRunEvent;
  ask?: AskUserEvent;
  guard?: GuardConfirmEvent;
  toolSummary?: ToolSummary;
  activeTool?: ToolStartEvent & { status?: "running" | "guard" | "failed" };
  /** 最近一次压缩（compact）的过程/结果：由 session.compact_result 驱动。 */
  compact?: CompactResultEvent;
  pendingUsers: PendingUserMessage[];
  /** 用户已输入但尚未到发送时机的本地 FIFO。 */
  queuedMessages: QueuedMessage[];
  /** 同一时刻只允许一个队首发往 Runtime。 */
  queueDispatching: boolean;
  /**
   * 已发送但尚未收到权威 agent.run（非终态）的等待窗口。
   * 用于在 pendingUsers 被 user_message 确认清空、而 running 尚未由
   * run_start 置位的空档期，驱动活动卡显示“等待模型”。
   */
  awaitingRun?: boolean;
};

export const blankActive = (): ActiveData => ({
  flow: [],
  flowTurns: [],
  pendingUsers: [],
  queuedMessages: [],
  queueDispatching: false,
});

/**
 * 切走会话时是否必须保留后台 attach。sendMessage 已发出、或正在 dispatch
 * 时 Runtime 上已经有/即将有 run；最后一个客户端离开会取消它。
 */
export function shouldKeepBackgroundRun(
  value: ActiveData,
  catalogStatus?: SessionStatus,
) {
  return Boolean(
    value.awaitingRun ||
    value.queueDispatching ||
    value.pendingUsers.length > 0 ||
    catalogStatus === "running" ||
    catalogStatus === "waiting" ||
    catalogStatus === "compacting" ||
    value.snapshot?.current_run?.status === "running" ||
    value.run?.state === "running" ||
    value.run?.state === "retrying" ||
    value.run?.state === "cancelling",
  );
}

export function userMessageCount(snapshot: SessionSnapshot | undefined) {
  return (snapshot?.messages ?? []).filter((message) => message.role === "user")
    .length;
}

export function flowTurnsFromSnapshot(snapshot: SessionSnapshot): FlowTurn[] {
  const messages = snapshot.messages ?? [];
  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.role === "user") {
      lastUserIndex = index;
      break;
    }
  }
  return snapshot.current_run && lastUserIndex >= 0
    ? [{ flowStart: 0, turnId: `snapshot:${lastUserIndex}` }]
    : [];
}

export function appendFlowTurn(value: ActiveData, turnId: string): FlowTurn[] {
  const last = value.flowTurns.at(-1);
  if (last?.flowStart === value.flow.length && last.turnId === turnId)
    return value.flowTurns;
  return [...value.flowTurns, { flowStart: value.flow.length, turnId }];
}

export function timelineMessages(value: ActiveData): TimelineMessage[] {
  return [
    ...(value.snapshot?.messages ?? []).map((message, index) => ({
      ...message,
      id: `snapshot:${index}`,
    })),
    ...value.pendingUsers.map((message) => ({
      role: "user",
      content: message.content,
      id: message.id,
    })),
  ];
}

/**
 * 从权威快照的进行中 buffer 恢复叙事流：reasoning 在前、assistant 在后，
 * 均为未结束段（运行中 attach / 发送后 reattach 时使用）。
 */
export function flowFromSnapshot(snapshot: SessionSnapshot): FlowSegment[] {
  const flow: FlowSegment[] = [];
  if (snapshot.current_run?.reasoning_buffer) {
    flow.push({
      kind: "reasoning",
      id: Date.now(),
      text: snapshot.current_run.reasoning_buffer,
      done: false,
    });
  }
  if (snapshot.current_run?.assistant_buffer) {
    flow.push({
      kind: "assistant",
      id: Date.now() + 1,
      text: snapshot.current_run.assistant_buffer,
      done: false,
    });
  }
  return flow;
}

export function messageId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

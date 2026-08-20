/**
 * Runtime 公开协议的类型定义（与 Suna Runtime docs/protocol 对齐）。
 * 与 runtimeBridge.ts 分离，方便各 feature 只依赖类型。
 */

export type JSONPrimitive = string | number | boolean | null;
export type JSONValue =
  JSONPrimitive | JSONValue[] | { [key: string]: JSONValue };
export type JSONRecord = Record<string, JSONValue>;

export type RuntimeHello = {
  protocol_version: string;
  runtime_version: string;
  transport: string;
  capabilities: Record<string, boolean>;
  content_sources: Record<string, boolean>;
  limits?: Record<string, number>;
  metadata?: JSONRecord;
};

export type AttachmentRef = {
  kind: "path" | "url" | "attachment";
  path?: string;
  url?: string;
  mime_type?: string;
  name?: string;
  size?: number;
};

export type MessagePart =
  { type: "text"; text: string } | { type: "image"; source: AttachmentRef };

export type SessionStatus = "idle" | "running" | "waiting" | "compacting";
export type SessionInfo = {
  id: string;
  title?: string;
  cwd: string;
  model_ref?: string;
  message_count: number;
  created_at: string;
  updated_at: string;
  last_attached_at?: string;
  status: SessionStatus;
  client_count: number;
};

export type SnapshotMessage = { role: string; content: string };
export type ToolSummaryItem = {
  tool: string;
  status: string;
  summary?: string;
};
export type ToolSummary = {
  total: number;
  success: number;
  failed: number;
  changes?: { tool: string; count: number }[];
  failures?: ToolSummaryItem[];
  recent?: ToolSummaryItem[];
  omitted?: number;
};
export type CurrentRun = {
  /** Present for an active run; used to reject notifications from a prior attach. */
  run_id?: string;
  status: SessionStatus;
  phase?: "model" | "tool" | "compact" | "guard" | "ask" | "skill";
  assistant_buffer?: string;
  reasoning_buffer?: string;
  waiting_type?: "ask" | "guard";
  can_control: boolean;
};
export type SessionSnapshot = {
  session: SessionInfo;
  messages?: SnapshotMessage[];
  compacted?: boolean;
  tool_summary?: ToolSummary;
  current_run?: CurrentRun;
};

export type ModelError = {
  kind: "unknown" | "http" | "network" | "cancelled" | "internal";
  message: string;
  status_code?: number;
  code?: string;
  type?: string;
  provider?: string;
  model?: string;
};
export type RunError = {
  kind: "no_model_configured" | "session_model_unavailable";
  model_ref?: string;
};
export type AgentRunEvent = {
  run_id?: string;
  /** cancelling 是非终态：daemon 已接受取消，run 仍在收尾，can_control=false。 */
  state:
    "running" | "retrying" | "cancelling" | "done" | "failed" | "cancelled";
  phase?: "model" | "tool" | "compact" | "guard" | "ask" | "skill";
  can_control: boolean;
  message?: string;
  attempt?: number;
  max_attempts?: number;
  delay_ms?: number;
  error?: ModelError;
  run_error?: RunError;
  resume_available?: boolean;
};
export type AgentUsageEvent = {
  run_id?: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens?: number;
  cache_creation_tokens?: number;
  context_tokens?: number;
  estimated_context_tokens?: number;
  context_window?: number;
  duration_ms?: number;
  tokens_per_sec?: number;
};
export type ToolStartEvent = {
  id: string;
  tool: string;
  params: JSONRecord;
  intent?: string;
};
export type ToolGuardEvent = {
  tool_call_id: string;
  tool: string;
  risk: string;
  decision: string;
  source: string;
  reason?: string;
  suggestion?: string;
  review_code?: string;
  review_message?: string;
};
export type ToolEndEvent = {
  id: string;
  tool: string;
  result: string;
  error?: boolean;
  result_truncated?: boolean;
  result_bytes?: number;
  metadata?: JSONRecord;
};
/**
 * 一次工具调用的完整生命周期记录，按执行顺序追加到时间线。
 * 由 tool_start / tool_guard / tool_end 三个事件渐进更新。
 */
export type ToolFlowItem = {
  id: string;
  tool: string;
  intent?: string;
  params?: JSONRecord;
  status: "running" | "guard" | "success" | "failed";
  result?: string;
  resultTruncated?: boolean;
  error?: boolean;
  /** 工具执行耗时（毫秒，前端本地计时 tool_start→tool_end）。 */
  durationMs?: number;
  /** 工具开始时间戳（仅前端计时用，不渲染）。 */
  startedAt?: number;
};
/** Skill 加载/校验状态行：由 skill.load / skill.review 通知驱动。 */
export type SkillFlowItem = {
  name: string;
  status: "loading" | "loaded" | "reviewing" | "done" | "error";
  /** review 结论或错误信息（展示时截断）。 */
  detail?: string;
};
/**
 * 时间线中的一段叙事：思考 / 回复 / 工具 / 技能，按真实到达顺序排列。
 * reasoning 与 assistant 是流式累积段（done 表示该段已结束），
 * tool 是工具调用生命周期记录，skill 是 Skill 加载/校验状态。
 */
export type FlowSegment =
  | { kind: "reasoning"; id: number; text: string; done: boolean }
  | { kind: "assistant"; id: number; text: string; done: boolean }
  | { kind: "tool"; item: ToolFlowItem }
  | { kind: "skill"; item: SkillFlowItem }
  | { kind: "subtask"; item: SubtaskFlowItem };

/**
 * 子任务（spawn）组：suna 把子任务内工具事件的 id 命名为
 * `spawn:<spawnID>:<toolID>`，前端据此把属于同一 spawn 的工具
 * 聚合为一个可折叠组，而不是拍平在主时间线（设计 §7.3）。
 * 组状态由 spawn 工具自身的 tool_end 结算。
 */
export type SubtaskFlowItem = {
  /** spawn 工具的 tool_call_id（即 spawnID）。 */
  id: string;
  /** 子任务目标（来自 spawn params.task / intent）。 */
  task?: string;
  status: "running" | "success" | "failed";
  /** 组内工具执行记录（按到达顺序）。 */
  tools: ToolFlowItem[];
  /** spawn 返回的结果摘要。 */
  result?: string;
  error?: boolean;
};

export type AskUserEvent = {
  question: string;
  options?: string[];
  id: string;
  session_id?: string;
  can_reply: boolean;
  allow_custom: boolean;
};
export type GuardConfirmEvent = {
  id: string;
  tool_call_id?: string;
  tool: string;
  params: JSONRecord;
  risk: string;
  reason: string;
  suggestion?: string;
  review_code?: string;
  review_message?: string;
  session_id?: string;
  can_reply: boolean;
};
export type CompactResultEvent = {
  /** 压缩进行中（running=true 时其余字段可省略）。 */
  before_tokens?: number;
  after_tokens?: number;
  context_window?: number;
  turns_compressed?: number;
  summary_tokens?: number;
  truncated_outputs?: number;
  noop?: boolean;
  running?: boolean;
  error?: string;
};

export type UsagePeriod = {
  input_tokens: number;
  output_tokens: number;
  requests: number;
};
export type ConfigModel = {
  provider: string;
  protocol: string;
  model: string;
  base_url?: string;
  context_window?: number;
  max_output_tokens?: number;
  strengths?: string[];
  subtask_for?: string[];
  reasoning?: JSONRecord;
  has_api_key?: boolean;
};
export type RuntimeConfig = {
  models: ConfigModel[];
  active_model: string;
  locale?: string;
  theme?: string;
  guard_mode?: string;
  workspace?: string;
};
export type ConfigSetParams = {
  action: "upsert_model" | "delete_model" | "activate_model" | "update_general";
  model?: ConfigModel;
  model_ref?: string;
  active_model?: string;
  api_key?: string;
  delete_api_key?: boolean;
  locale?: string;
  theme?: string;
  guard_mode?: string;
  workspace?: string | null;
};
export type MemoryItem = {
  id: string;
  content: string;
  kind: string;
  tags?: string[];
  priority: number;
  is_core: boolean;
};
export type SkillInfo = {
  name: string;
  description?: string;
  /** 0.5 起引入：global / project；项目 Skill 用精确 path 区分。 */
  scope?: string;
  /** 0.5 起：是否允许 UI 切换开关（项目 Skill 可能不可切换）。 */
  can_toggle?: boolean;
  enabled: boolean;
  valid: boolean;
  reasons?: string[];
  path?: string;
  error?: string;
};
export type MCPServerInfo = {
  id?: string;
  name: string;
  transport?: string;
  command?: string;
  /** 0.4 起由 Runtime 报告的状态机：disabled / starting / active / error。 */
  state?: "disabled" | "starting" | "active" | "error";
  active: boolean;
  configured: boolean;
  tool_count: number;
  error?: string;
};

export type RuntimeBridgeMethods = {
  "session.list": {
    params: { cwd?: string; active_only?: boolean };
    result: { sessions: SessionInfo[] };
  };
  "session.create": {
    params: { cwd: string; title?: string };
    result: SessionSnapshot;
  };
  "session.attach": {
    params: { session_id: string; require_active?: boolean };
    result: SessionSnapshot;
  };
  "session.detach": {
    params: Record<string, never>;
    result: { status: "detached" };
  };
  "session.update": {
    params: {
      session_id: string;
      title?: string | null;
      model_ref?: string | null;
    };
    result: SessionSnapshot;
  };
  "session.delete": {
    params: { session_id: string };
    result: { deleted: boolean };
  };
  "session.compact": {
    params: Record<string, never>;
    result: { status: "ok" };
  };
  "session.usage": {
    params: Record<string, never>;
    result: { today: UsagePeriod; week: UsagePeriod; month: UsagePeriod };
  };
  "agent.sendMessage": {
    params: { client_msg_id?: string; parts: MessagePart[] };
    result: { status: "processing" };
  };
  "agent.resumeRun": {
    params: Record<string, never>;
    result: { status: "processing" };
  };
  "agent.cancel": {
    params: Record<string, never>;
    result: { status: "cancelled" };
  };
  "agent.askReply": {
    params: { id: string; answer: string };
    result: { status: "ok" };
  };
  "agent.guardReply": {
    params: { id: string; decision: "approve" | "reject" | "modify" };
    result: { status: "ok" };
  };
  "config.get": { params: Record<string, never>; result: RuntimeConfig };
  "config.set": { params: ConfigSetParams; result: RuntimeConfig };
  "memory.list": {
    params: Record<string, never>;
    result: { memories: MemoryItem[] };
  };
  "memory.delete": { params: { id: string }; result: { deleted: boolean } };
  "memory.clear": {
    params: Record<string, never>;
    result: { deleted_count: number };
  };
  "skill.list": {
    params: Record<string, never>;
    result: { skills: SkillInfo[] };
  };
  "skill.set": {
    params: { name: string; scope?: string; enabled: boolean };
    result: { status: string };
  };
  "mcp.list": {
    params: Record<string, never>;
    result: { servers: MCPServerInfo[] };
  };
  "mcp.toggle": {
    params: { name: string; active: boolean };
    result: { status: string };
  };
  "mcp.reload": { params: { name: string }; result: { status: string } };
  "daemon.status": {
    params: Record<string, never>;
    result: {
      state: string;
      pid?: number;
      uptime?: string;
      connections?: number;
      agent_status?: string;
      provider?: string;
      model?: string;
      context_tokens?: number;
      context_window?: number;
      usage_today?: UsagePeriod;
    };
  };
};
export type RuntimeBridgeMethod = keyof RuntimeBridgeMethods;
export type RuntimeBridgeParams<M extends RuntimeBridgeMethod> =
  RuntimeBridgeMethods[M]["params"];
export type RuntimeBridgeResult<M extends RuntimeBridgeMethod> =
  RuntimeBridgeMethods[M]["result"];

export type RuntimeNotifications = {
  "agent.delta": {
    run_id?: string;
    kind: "assistant" | "reasoning";
    content: string;
  };
  "agent.run": AgentRunEvent;
  "agent.usage": AgentUsageEvent;
  "agent.tool_start": ToolStartEvent;
  "agent.tool_guard": ToolGuardEvent;
  "agent.tool_end": ToolEndEvent;
  "agent.ask_user": AskUserEvent;
  "agent.guard_confirm": GuardConfirmEvent;
  "agent.interaction_resolved": { id: string; session_id?: string };
  "session.user_message": { session_id?: string; parts?: MessagePart[] };
  "session.updated": { session: SessionInfo };
  "session.compact_result": CompactResultEvent;
  "config.state": RuntimeConfig;
  "memory.state": { memories: MemoryItem[] };
  "mcp.updated": { server: MCPServerInfo };
  "skill.load": { name: string; status?: string };
  "skill.review": {
    name: string;
    status?: string;
    review?: string;
    error?: string;
  };
};
export type RuntimeNotificationMethod = keyof RuntimeNotifications;
export type RuntimeNotification = {
  [M in RuntimeNotificationMethod]: {
    method: M;
    params: RuntimeNotifications[M];
  };
}[RuntimeNotificationMethod];

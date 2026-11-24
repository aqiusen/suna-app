import type {
  CompactStateEvent,
  JSONRecord,
  SessionStatus,
  SnapshotMessage,
  ToolFlowItem,
} from "../../lib/runtimeBridge";

export type TimelineMessage = SnapshotMessage & {
  id: string;
  historicalTools?: ToolFlowItem[];
};

/**
 * 将 Runtime 的有效历史投影为普通消息与静态工具行。压缩后的 observed_tools
 * 不含调用 ID，因此只生成 UI key，不把它伪装成可与实时事件关联的调用。
 */
export function restoreSnapshotMessages(
  input: unknown,
  sessionStatus?: SessionStatus,
): TimelineMessage[] {
  if (!Array.isArray(input)) return [];
  const messages = input
    .map(parseSnapshotMessage)
    .filter((message): message is SnapshotMessage => message !== undefined);
  const timeline: TimelineMessage[] = [];
  const calls = new Map<string, ToolFlowItem>();
  const activeSession =
    sessionStatus === "running" ||
    sessionStatus === "waiting" ||
    sessionStatus === "compacting";

  messages.forEach((message, messageIndex) => {
    if (message.role === "tool") {
      const item = message.tool_call_id
        ? calls.get(message.tool_call_id)
        : undefined;
      if (item) {
        const result = clipToolResult(message.content);
        item.result = result.content;
        item.resultTruncated = Boolean(message.truncated || result.truncated);
        item.status = snapshotToolStatus(message.tool_status);
        item.error = item.status === "failed";
      }
      return;
    }

    const restored: TimelineMessage = {
      ...message,
      id: `snapshot:${messageIndex}`,
    };
    const historicalTools: ToolFlowItem[] = [];
    for (const call of message.tool_calls ?? []) {
      const item: ToolFlowItem = {
        id: call.id,
        tool: call.name,
        intent: call.intent,
        params: parseToolArguments(call.arguments),
        status: activeSession ? "running" : "unknown",
      };
      calls.set(call.id, item);
      historicalTools.push(item);
    }
    for (const [toolIndex, tool] of (message.observed_tools ?? []).entries()) {
      historicalTools.push({
        id: `snapshot-observed:${messageIndex}:${toolIndex}`,
        tool: tool.name,
        intent: tool.intent,
        status: snapshotToolStatus(tool.status),
        compacted: true,
      });
    }
    if (historicalTools.length > 0) restored.historicalTools = historicalTools;
    timeline.push(restored);
  });
  return timeline;
}

function parseSnapshotMessage(value: unknown): SnapshotMessage | undefined {
  if (
    !isRecord(value) ||
    typeof value.role !== "string" ||
    typeof value.content !== "string"
  )
    return undefined;
  const toolCalls = Array.isArray(value.tool_calls)
    ? value.tool_calls.filter(isSnapshotToolCall)
    : undefined;
  const observedTools = Array.isArray(value.observed_tools)
    ? value.observed_tools.filter(isSnapshotToolLabel)
    : undefined;
  return {
    role: value.role,
    content: value.content,
    ...(value.kind === "text" || value.kind === "media"
      ? { kind: value.kind }
      : {}),
    ...(toolCalls?.length ? { tool_calls: toolCalls } : {}),
    ...(typeof value.tool_call_id === "string"
      ? { tool_call_id: value.tool_call_id }
      : {}),
    ...(typeof value.tool_status === "string"
      ? { tool_status: value.tool_status }
      : {}),
    ...(observedTools?.length ? { observed_tools: observedTools } : {}),
    ...(typeof value.truncated === "boolean"
      ? { truncated: value.truncated }
      : {}),
  };
}

function isSnapshotToolCall(
  value: unknown,
): value is NonNullable<SnapshotMessage["tool_calls"]>[number] {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.arguments === "string" &&
    (value.intent === undefined || typeof value.intent === "string")
  );
}

function isSnapshotToolLabel(
  value: unknown,
): value is NonNullable<SnapshotMessage["observed_tools"]>[number] {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    (value.intent === undefined || typeof value.intent === "string") &&
    (value.status === undefined || typeof value.status === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseToolArguments(raw: string): JSONRecord {
  try {
    const value: unknown = JSON.parse(raw);
    return isRecord(value) ? (value as JSONRecord) : { raw };
  } catch {
    return { raw };
  }
}

function snapshotToolStatus(status?: string): ToolFlowItem["status"] {
  if (status === "completed") return "success";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  return "unknown";
}

function clipToolResult(value: string, limit = 16 * 1024) {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length <= limit) return { content: value, truncated: false };
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (let end = limit; end > limit - 4; end--) {
    try {
      return {
        content: decoder.decode(bytes.subarray(0, end)),
        truncated: true,
      };
    } catch {
      // 往回退到完整 UTF-8 字符边界，避免在多字节字符中间截断。
    }
  }
  return { content: "", truncated: true };
}

export function mergeCompactState(
  current: CompactStateEvent | undefined,
  next: CompactStateEvent,
): CompactStateEvent {
  if (current?.compact_id !== next.compact_id) return next;
  if (["applied", "skipped", "failed", "cancelled"].includes(current.state))
    return current;
  if (current.state === "ready" && next.state === "preparing") return current;
  return next;
}

export function parseCompactState(
  value: unknown,
): CompactStateEvent | undefined {
  if (!isRecord(value)) return undefined;
  const states = [
    "preparing",
    "ready",
    "applied",
    "skipped",
    "failed",
    "cancelled",
  ];
  if (
    typeof value.session_id !== "string" ||
    typeof value.compact_id !== "string" ||
    typeof value.state !== "string" ||
    !states.includes(value.state)
  )
    return undefined;
  if (
    value.kind !== undefined &&
    value.kind !== "tools" &&
    value.kind !== "history" &&
    value.kind !== "mixed"
  )
    return undefined;
  if (
    value.wait !== undefined &&
    value.wait !== "manual" &&
    value.wait !== "hard_limit"
  )
    return undefined;
  if (
    ["error", "reason"].some(
      (key) => value[key] !== undefined && typeof value[key] !== "string",
    )
  )
    return undefined;
  if (
    ["prepare_elapsed_ms", "wait_elapsed_ms"].some(
      (key) => value[key] !== undefined && typeof value[key] !== "number",
    )
  )
    return undefined;
  if (value.result !== undefined) {
    if (
      !isRecord(value.result) ||
      typeof value.result.before_tokens !== "number" ||
      typeof value.result.after_tokens !== "number" ||
      typeof value.result.context_window !== "number"
    )
      return undefined;
  }
  return value as unknown as CompactStateEvent;
}

export function restorableCompactState(
  value: unknown,
): CompactStateEvent | undefined {
  const compact = parseCompactState(value);
  return compact?.state === "preparing" || compact?.state === "ready"
    ? compact
    : undefined;
}

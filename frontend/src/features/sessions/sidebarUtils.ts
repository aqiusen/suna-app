import type { SessionInfo } from "../../lib/runtimeBridge";

export const statusLabels: Record<SessionInfo["status"], string> = {
  idle: "session.status.idle",
  running: "session.status.running",
  waiting: "session.status.waiting",
  compacting: "session.status.compacting",
};

/** 会话置顶记忆：localStorage 记录手动置顶的会话 id。 */
export const PINNED_KEY = "suna-app:pinned-sessions";

export function loadPinned(): Set<string> {
  try {
    const raw = localStorage.getItem(PINNED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed) : new Set();
  } catch {
    return new Set();
  }
}

/** 工作目录名称：路径 basename；根路径等无 basename 时回退为原路径。 */
export function workdirName(cwd: string) {
  const trimmed = cwd.replace(/\/+$/, "");
  const base = trimmed.split("/").pop() || trimmed;
  return base || cwd;
}

/** 统一路径分隔符和尾斜杠，避免 Runtime 与目录选择器格式不同导致匹配失败。 */
export function workdirPathKey(path: string) {
  const normalized = path.trim().replaceAll("\\", "/");
  if (normalized.length <= 1) return normalized;
  return normalized.replace(/\/+$/, "");
}

export const waitingRank: Record<SessionInfo["status"], number> = {
  waiting: 0,
  running: 1,
  compacting: 2,
  idle: 3,
};

export type SessionSidebarProps = {
  terminalStates?: Record<string, "success" | "failed">;
  sessions: SessionInfo[];
  selectedId?: string;
  open?: boolean;
  connected: boolean;
  /** Runtime 版本号（连接后展示在底部状态行）。 */
  runtimeVersion?: string;
  /** Session currently being attached by the application shell. */
  pendingId?: string;
  /** Prevent session-changing controls while the application shell is busy. */
  disabled?: boolean;
  onSelect: (id: string) => void;
  onCreate: (cwd: string, title?: string) => Promise<void>;
  /** 打开新建会话对话框。 */
  onRequestCreate: (cwd?: string) => void;
  /** 未连接时点击重新连接；已连接时该按钮仅为状态展示。 */
  onReconnect: () => void;
  onDelete?: (id: string) => void;
  /** 打开重命名对话框；协议要求先 attach 目标会话。 */
  onRename?: (id: string) => void;
  /** 删除该工作目录下所有 Runtime 会话，但不删除用户文件。 */
  onDeleteWorkdir?: (cwd: string) => Promise<boolean>;
  onClose?: () => void;
};

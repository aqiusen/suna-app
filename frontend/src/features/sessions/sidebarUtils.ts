import type { SessionInfo } from "../../lib/runtimeBridge";

export const statusLabels: Record<SessionInfo["status"], string> = {
  idle: "session.status.idle",
  running: "session.status.running",
  waiting: "session.status.waiting",
  compacting: "session.status.compacting",
};

/** 组折叠记忆：localStorage 按项目路径记录折叠状态。 */
export const COLLAPSED_KEY = "suna-app:collapsed-projects";
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

export function loadCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed) : new Set();
  } catch {
    return new Set();
  }
}

/** 项目名：路径 basename；根路径等无 basename 时回退为原路径。 */
export function projectName(cwd: string) {
  const trimmed = cwd.replace(/\/+$/, "");
  const base = trimmed.split("/").pop() || trimmed;
  return base || cwd;
}

export const waitingRank: Record<SessionInfo["status"], number> = {
  waiting: 0,
  running: 1,
  compacting: 2,
  idle: 3,
};

export type SessionSidebarProps = {
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
  /** 打开新建任务对话框（项目选择器在 Dialog 中）。 */
  onRequestCreate: () => void;
  /** 未连接时点击重新连接；已连接时该按钮仅为状态展示。 */
  onReconnect: () => void;
  onJoinActive: (id: string) => void;
  onDelete?: (id: string) => void;
  onClose?: () => void;
};

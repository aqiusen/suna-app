import { useEffect, useMemo, useReducer, useState } from "react";
import { Icon, IconButton } from "../../components/Icon";
import { useT } from "../../lib/i18n";
import { useMediaQuery } from "../../lib/useMediaQuery";
import type { SessionInfo } from "../../lib/runtimeBridge";
import { SessionRow } from "./SessionRow";
import {
  COLLAPSED_KEY,
  loadCollapsed,
  loadPinned,
  PINNED_KEY,
  projectName,
  type SessionSidebarProps,
  waitingRank,
} from "./sidebarUtils";

/** 侧栏：搜索 + 按项目分组 + waiting 置顶。
 * 分组状态存 localStorage；搜索时临时平铺（设计 §6.2）。 */
export function SessionSidebar({
  sessions,
  selectedId,
  open = false,
  connected,
  runtimeVersion,
  pendingId,
  disabled = false,
  onSelect,
  // onCreate 由 Dialog 承担（onRequestCreate）；prop 保留仅为类型兼容，
  // 不在此处解构使用（避免 no-unused-vars）。
  onRequestCreate,
  onReconnect,
  onJoinActive,
  onDetach,
  onDelete,
  onRename,
  onClose,
}: SessionSidebarProps) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed);
  const [pinned, setPinned] = useState<Set<string>>(loadPinned);
  // 每分钟刷新相对时间（"刚刚/5m 前"不会一直停留在旧值）。
  const [, tick] = useReducer((value: number) => value + 1, 0);
  useEffect(() => {
    const timer = window.setInterval(tick, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // 移动端（≤720px）侧栏是抽屉：未打开时对屏幕阅读器和 Tab 聚焦隐藏，
  // 避免读屏读到屏幕外的会话列表、键盘焦点落到不可见元素上。
  const isMobile = useMediaQuery("(max-width: 720px)");
  const hidden = isMobile && !open;

  function toggleCollapsed(cwd: string) {
    setCollapsed((value) => {
      const next = new Set(value);
      if (next.has(cwd)) next.delete(cwd);
      else next.add(cwd);
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
      } catch {
        // localStorage 不可用时仅内存生效。
      }
      return next;
    });
  }

  function togglePin(id: string) {
    setPinned((value) => {
      const next = new Set(value);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(PINNED_KEY, JSON.stringify([...next]));
      } catch {
        // localStorage 不可用时仅内存生效。
      }
      return next;
    });
  }

  /** 删除会话时同步清理置顶记忆，避免残留失效 id。 */
  function handleDelete(id: string) {
    setPinned((value) => {
      const next = new Set(value);
      next.delete(id);
      try {
        localStorage.setItem(PINNED_KEY, JSON.stringify([...next]));
      } catch {
        // localStorage 不可用时仅内存生效。
      }
      return next;
    });
    onDelete?.(id);
  }

  // 排序：手动置顶 > waiting 置顶（设计 §6.2）> 其余按更新时间倒序。
  const sorted = useMemo(
    () =>
      sessions
        .map((session) => ({
          session,
          updatedAt: new Date(session.updated_at).getTime(),
        }))
        .sort((a, b) => {
          const pa = pinned.has(a.session.id) ? 0 : 1;
          const pb = pinned.has(b.session.id) ? 0 : 1;
          if (pa !== pb) return pa - pb;
          const rank =
            waitingRank[a.session.status] - waitingRank[b.session.status];
          if (rank !== 0) return rank;
          return b.updatedAt - a.updatedAt;
        })
        .map((item) => item.session),
    [pinned, sessions],
  );

  // 搜索：过滤标题 + 路径，搜索时平铺（临时取消分组）。
  const filtered = useMemo(() => {
    if (!query.trim()) return sorted;
    const q = query.trim().toLowerCase();
    return sorted.filter(
      (session) =>
        (session.title ?? "").toLowerCase().includes(q) ||
        session.cwd.toLowerCase().includes(q) ||
        projectName(session.cwd).toLowerCase().includes(q),
    );
  }, [sorted, query]);

  // 分组：按 cwd 聚合，组内保持 waiting 优先 + 时间倒序。
  const groups = useMemo(() => {
    const map = new Map<string, SessionInfo[]>();
    for (const session of filtered) {
      const list = map.get(session.cwd) ?? [];
      list.push(session);
      map.set(session.cwd, list);
    }
    return [...map.entries()].map(([cwd, list]) => ({
      cwd,
      name: projectName(cwd),
      list,
      hasWaiting: list.some((session) => session.status === "waiting"),
    }));
  }, [filtered]);
  const searching = Boolean(query.trim());
  const groupsWithWaiting = groups.filter((group) => group.hasWaiting);
  const groupsRest = groups.filter((group) => !group.hasWaiting);

  return (
    <aside
      aria-hidden={hidden || undefined}
      aria-label={t("sidebar.sessionLabel")}
      className={`session-sidebar ${open ? "is-open" : ""}`}
      inert={hidden || undefined}
    >
      <div className="mb-1 flex min-h-[42px] items-center justify-between px-1 pl-2">
        <button
          className="flex cursor-pointer items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-[17px] font-extrabold tracking-tight text-ink transition-colors duration-150 hover:bg-surface-subtle"
          type="button"
        >
          <span className="grid h-[27px] w-[27px] place-items-center rounded-[9px] bg-[linear-gradient(135deg,#5b67f1,#6d5df0_68%,#7c54e8)] text-white shadow-[0_4px_11px_rgba(91,103,241,0.26)]">
            <Icon name="sparkle" size={17} />
          </span>
          <span>Suna</span>
        </button>
        <div className="flex items-center gap-1">
          <IconButton
            disabled={disabled}
            label={t("sidebar.newTask")}
            onClick={onRequestCreate}
          >
            <Icon name="plus" />
          </IconButton>
          {/* 移动端抽屉内的关闭按钮。 */}
          {onClose && (
            <IconButton
              className="hidden max-[720px]:inline-grid"
              label={t("sidebar.closeList")}
              onClick={onClose}
            >
              <Icon name="close" />
            </IconButton>
          )}
        </div>
      </div>
      <div className="px-2 pb-2">
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-2.5 grid place-items-center text-ink-muted">
            <Icon name="search" size={13} />
          </span>
          <input
            aria-label={t("sidebar.search")}
            className="w-full rounded-lg border border-line bg-surface-raised py-1.5 pr-2.5 pl-8 text-[12px] text-ink placeholder:text-ink-muted focus:border-blue/50 focus:ring-2 focus:ring-blue/25 focus:outline-none"
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("sidebar.search")}
            value={query}
          />
        </div>
      </div>
      <nav aria-label={t("sidebar.recent")} className="session-list">
        {filtered.length === 0 && (
          <p className="p-4 text-center text-[13px] text-ink-muted">
            {searching ? t("sidebar.noMatch") : t("sidebar.empty")}
          </p>
        )}
        {/* 搜索时平铺：不分组，保持 waiting 优先顺序 */}
        {searching
          ? filtered.map((session) => (
              <SessionRow
                disabled={disabled}
                joining={session.id === pendingId}
                key={session.id}
                onDelete={handleDelete}
                onDetach={onDetach}
                onJoinActive={onJoinActive}
                onRename={onRename}
                onSelect={onSelect}
                onTogglePin={() => togglePin(session.id)}
                pinned={pinned.has(session.id)}
                selected={session.id === selectedId}
                session={session}
              />
            ))
          : [...groupsWithWaiting, ...groupsRest].map((group) => {
              const isCollapsed = collapsed.has(group.cwd);
              return (
                <div className="mb-1" key={group.cwd}>
                  <button
                    aria-expanded={!isCollapsed}
                    className="flex w-full cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-left transition-colors duration-150 hover:bg-surface-subtle"
                    onClick={() => toggleCollapsed(group.cwd)}
                    type="button"
                  >
                    <Icon
                      className={`shrink-0 text-ink-muted transition-transform duration-150 ${isCollapsed ? "" : "rotate-90"}`}
                      name="chevron-right"
                      size={12}
                    />
                    <Icon
                      className="shrink-0 text-ink-muted"
                      name="folder"
                      size={13}
                    />
                    <span className="min-w-0 flex-1 truncate text-[11.5px] font-extrabold text-ink">
                      {group.name}
                    </span>
                    {group.hasWaiting && (
                      <span
                        aria-label={t("sidebar.groupPending")}
                        className="h-[7px] w-[7px] shrink-0 rounded-full bg-amber"
                      />
                    )}
                    <span className="shrink-0 text-[10px] font-bold text-ink-muted">
                      {group.list.length}
                    </span>
                  </button>
                  {!isCollapsed && (
                    <div className="pl-1">
                      {group.list.map((session) => (
                        <SessionRow
                          disabled={disabled}
                          joining={session.id === pendingId}
                          key={session.id}
                          onDelete={handleDelete}
                          onDetach={onDetach}
                          onJoinActive={onJoinActive}
                          onRename={onRename}
                          onSelect={onSelect}
                          onTogglePin={() => togglePin(session.id)}
                          pinned={pinned.has(session.id)}
                          selected={session.id === selectedId}
                          session={session}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
      </nav>
      <div className="mt-auto border-t border-line pt-3">
        <button
          aria-label={
            connected ? t("sidebar.connected") : t("sidebar.disconnected")
          }
          className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-[12px] font-bold transition-colors duration-150 hover:bg-surface-subtle disabled:cursor-default disabled:opacity-100 disabled:hover:bg-transparent"
          disabled={connected || disabled}
          onClick={onReconnect}
          type="button"
        >
          <span
            className={`h-[7px] w-[7px] rounded-full ${connected ? "bg-green" : "bg-[#8a8f9d]"}`}
          />
          {connected ? t("sidebar.connected") : t("sidebar.disconnected")}
          {connected && runtimeVersion && (
            <span className="ml-auto text-[10px] font-semibold text-ink-muted">
              v{runtimeVersion.replace(/^v/, "")}
            </span>
          )}
        </button>
        <div className="flex items-center gap-2.5 px-2 py-2">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-[linear-gradient(135deg,#5b67f1,#6d5df0_68%,#7c54e8)] text-[11px] font-extrabold text-white">
            SU
          </span>
          <span className="text-[12px] font-semibold text-ink-soft">
            {t("sidebar.workspace")}
          </span>
        </div>
      </div>
    </aside>
  );
}

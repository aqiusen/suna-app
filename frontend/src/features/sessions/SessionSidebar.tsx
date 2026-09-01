import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, IconButton } from "../../components/Icon";
import { Tooltip } from "../../components/ui/Tooltip";
import { SessionDeleteConfirm } from "./SessionDeleteConfirm";
import { useT } from "../../lib/i18n";
import { useMediaQuery } from "../../lib/useMediaQuery";
import type { SessionInfo } from "../../lib/runtimeBridge";
import { SessionRow } from "./SessionRow";
import {
  workdirName,
  workdirPathKey,
  type SessionSidebarProps,
  waitingRank,
} from "./sidebarUtils";

/** 侧栏：Runtime session 列表按工作目录分组，搜索时临时平铺。 */
export function SessionSidebar({
  sessions,
  terminalStates,
  selectedId,
  open = false,
  connected,
  runtimeVersion,
  pendingId,
  disabled = false,
  onSelect,
  onCreate,
  onRequestCreate,
  onReconnect,
  onDelete,
  onRename,
  onDeleteWorkdir,
  onClose,
  onOpenSettings,
  settingsOpen = false,
}: SessionSidebarProps) {
  const t = useT();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [workdirMenuCwd, setWorkdirMenuCwd] = useState<string>();
  const [confirmingWorkdirCwd, setConfirmingWorkdirCwd] = useState<string>();
  const [confirmingSessionId, setConfirmingSessionId] = useState<string>();
  const workdirMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!workdirMenuCwd) return;
    const onPointerDown = (event: PointerEvent) => {
      if (
        workdirMenuRef.current &&
        !workdirMenuRef.current.contains(event.target as Node)
      )
        setWorkdirMenuCwd(undefined);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [workdirMenuCwd]);

  // 移动端（≤720px）侧栏是抽屉：未打开时对屏幕阅读器和 Tab 聚焦隐藏，
  // 避免读屏读到屏幕外的会话列表、键盘焦点落到不可见元素上。
  const isMobile = useMediaQuery("(max-width: 720px)");
  const hidden = isMobile && !open;

  function toggleCollapsed(cwd: string) {
    setCollapsed((value) => {
      const next = new Set(value);
      if (next.has(cwd)) next.delete(cwd);
      else next.add(cwd);
      return next;
    });
  }

  function requestDelete(id: string) {
    setConfirmingSessionId(id);
  }

  function requestDeleteWorkdir(cwd: string) {
    setWorkdirMenuCwd(undefined);
    setConfirmingWorkdirCwd(cwd);
  }

  async function confirmDeleteWorkdir() {
    const cwd = confirmingWorkdirCwd;
    if (!cwd || !onDeleteWorkdir) return;
    setConfirmingWorkdirCwd(undefined);
    await onDeleteWorkdir(cwd);
  }

  // 排序：等待中的会话优先，其余按更新时间倒序。
  const sorted = useMemo(
    () =>
      sessions
        .map((session) => ({
          session,
          updatedAt: new Date(session.updated_at).getTime(),
        }))
        .sort((a, b) => {
          const rank =
            waitingRank[a.session.status] - waitingRank[b.session.status];
          if (rank !== 0) return rank;
          return b.updatedAt - a.updatedAt;
        })
        .map((item) => item.session),
    [sessions],
  );

  // 分组：按 cwd 聚合，组内保持 waiting 优先 + 时间倒序。
  const groups = useMemo(() => {
    const map = new Map<string, { cwd: string; list: SessionInfo[] }>();
    for (const session of sorted) {
      const key = workdirPathKey(session.cwd);
      const group = map.get(key) ?? { cwd: session.cwd, list: [] };
      group.list.push(session);
      map.set(key, group);
    }
    return [...map.values()].map(({ cwd, list }) => ({
      cwd,
      name: workdirName(cwd),
      list,
      hasWaiting: list.some((session) => session.status === "waiting"),
    }));
  }, [sorted]);
  const groupsWithWaiting = groups.filter((group) => group.hasWaiting);
  const groupsRest = groups.filter((group) => !group.hasWaiting);
  const recentSessions = sorted
    .filter((session) => session.id !== selectedId)
    .slice(0, 5);
  const collapsedInitialized = useRef(false);

  // 首次加载保持紧凑，但当前 session 的项目组必须展开，确保用户能看见
  // 当前对话属于哪个项目；其余项目仍保持折叠。
  useEffect(() => {
    if (collapsedInitialized.current || groups.length === 0) return;
    collapsedInitialized.current = true;
    const next = new Set(groups.map((group) => group.cwd));
    const selected = sessions.find((session) => session.id === selectedId);
    if (selected) next.delete(workdirPathKey(selected.cwd));
    setCollapsed(next);
  }, [groups, selectedId, sessions]);

  // 切换 session 时始终展开它所在项目组，不让选中项藏在折叠目录里。
  useEffect(() => {
    const selected = sessions.find((session) => session.id === selectedId);
    if (!selected) return;
    const cwd = workdirPathKey(selected.cwd);
    setCollapsed((value) => {
      if (!value.has(cwd)) return value;
      const next = new Set(value);
      next.delete(cwd);
      return next;
    });
  }, [selectedId, sessions]);

  return (
    <aside
      aria-hidden={hidden || undefined}
      aria-label={t("sidebar.sessionLabel")}
      className={`session-sidebar ${open ? "is-open" : ""}`}
      inert={hidden || undefined}
    >
      <div className="mb-7 flex min-h-[42px] items-center px-1 pl-2">
        <button
          className="flex cursor-pointer items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-[17px] font-extrabold tracking-tight text-ink transition-colors duration-150 hover:bg-surface-subtle"
          type="button"
        >
          <span className="grid h-[27px] w-[27px] place-items-center rounded-lg bg-ink text-white">
            <Icon name="sparkle" size={17} />
          </span>
          <span>Suna</span>
        </button>
      </div>
      <div className="px-2 pb-7">
        <button
          className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-left text-[15px] font-semibold text-ink transition-colors duration-150 hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled}
          onClick={() => onRequestCreate()}
          type="button"
        >
          <span className="grid h-5 w-5 place-items-center rounded-full bg-ink text-white">
            <Icon name="plus" size={13} />
          </span>
          {t("sidebar.newConversation")}
        </button>
      </div>
      {onClose && (
        <IconButton
          className="absolute top-4 right-3 hidden max-[720px]:inline-grid"
          label={t("sidebar.closeList")}
          onClick={onClose}
        >
          <Icon name="close" />
        </IconButton>
      )}
      <nav aria-label={t("sidebar.projects")} className="session-list">
        <section>
          <div className="mb-2 flex items-center justify-between px-2">
            <h2 className="m-0 text-[12px] font-semibold text-ink-muted">
              {t("sidebar.projects")}
            </h2>
            <Icon className="text-ink-muted" name="ellipsis" size={16} />
          </div>
          {sorted.length === 0 && (
            <p className="p-4 text-center text-[13px] text-ink-muted">
              {t("sidebar.empty")}
            </p>
          )}
          {[...groupsWithWaiting, ...groupsRest].map((group) => {
            const isCollapsed = collapsed.has(group.cwd);
            return (
              <div className="group/workdir mb-1" key={group.cwd}>
                <div className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 transition-colors duration-150 hover:bg-surface-subtle">
                  <button
                    aria-expanded={!isCollapsed}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left"
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
                  </button>
                  <div
                    className="relative flex shrink-0 items-center gap-0.5"
                    ref={
                      workdirMenuCwd === group.cwd ? workdirMenuRef : undefined
                    }
                  >
                    <Tooltip label={t("group.more")}>
                      <button
                        aria-expanded={workdirMenuCwd === group.cwd}
                        aria-label={t("group.more")}
                        className="grid h-7 w-7 cursor-pointer place-items-center rounded-md text-ink-muted opacity-0 transition-[opacity,background,color] duration-150 hover:bg-surface-solid hover:text-ink focus:opacity-100 group-hover/workdir:opacity-100"
                        onClick={() =>
                          setWorkdirMenuCwd((current) =>
                            current === group.cwd ? undefined : group.cwd,
                          )
                        }
                        type="button"
                      >
                        <Icon name="ellipsis" size={14} />
                      </button>
                    </Tooltip>
                    {workdirMenuCwd === group.cwd && (
                      <div className="absolute top-8 right-0 z-10 w-36 overflow-hidden rounded-lg border border-line bg-surface-solid py-1 shadow-lg">
                        <button
                          className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-[12px] font-semibold text-ink-soft transition-colors hover:bg-surface-subtle hover:text-ink"
                          disabled={disabled}
                          onClick={() => {
                            setWorkdirMenuCwd(undefined);
                            void onCreate(group.cwd);
                          }}
                          type="button"
                        >
                          <Icon name="plus" size={14} />
                          {t("group.newSession")}
                        </button>
                        {onDeleteWorkdir && (
                          <button
                            className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-[12px] font-semibold text-rose transition-colors hover:bg-rose/10"
                            onClick={() => requestDeleteWorkdir(group.cwd)}
                            type="button"
                          >
                            <Icon name="trash" size={14} />
                            {t("group.delete")}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                {!isCollapsed && (
                  <div className="ml-[30px] border-l border-line pl-2">
                    {group.list.map((session) => (
                      <SessionRow
                        terminalState={terminalStates?.[session.id]}
                        disabled={disabled}
                        joining={session.id === pendingId}
                        key={session.id}
                        nested
                        onDelete={onDelete ? requestDelete : undefined}
                        onRename={onRename}
                        onSelect={onSelect}
                        selected={session.id === selectedId}
                        session={session}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </section>
        {recentSessions.length > 0 && (
          <section className="mt-7">
            <div className="mb-2 flex items-center justify-between px-2">
              <h2 className="m-0 text-[12px] font-semibold text-ink-muted">
                {t("sidebar.recent")}
              </h2>
              <Icon className="text-ink-muted" name="ellipsis" size={16} />
            </div>
            <div className="px-1">
              {recentSessions.map((session) => (
                <SessionRow
                  terminalState={terminalStates?.[session.id]}
                  disabled={disabled}
                  joining={session.id === pendingId}
                  key={session.id}
                  onSelect={onSelect}
                  selected={session.id === selectedId}
                  session={session}
                />
              ))}
            </div>
          </section>
        )}
      </nav>
      {(confirmingSessionId || confirmingWorkdirCwd) && (
        <SessionDeleteConfirm
          kind={confirmingSessionId ? "session" : "workdir"}
          onCancel={() => {
            setConfirmingSessionId(undefined);
            setConfirmingWorkdirCwd(undefined);
          }}
          onConfirm={() => {
            if (confirmingSessionId) {
              const id = confirmingSessionId;
              if (!onDelete) return;
              setConfirmingSessionId(undefined);
              onDelete(id);
              return;
            }
            void confirmDeleteWorkdir();
          }}
        />
      )}
      <div className="mt-auto border-t border-line pt-2">
        <button
          aria-label={
            connected ? t("sidebar.connected") : t("sidebar.disconnected")
          }
          className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] font-semibold text-ink-soft transition-colors duration-150 hover:bg-surface-subtle hover:text-ink disabled:cursor-default disabled:opacity-100 disabled:hover:bg-transparent disabled:hover:text-ink-soft"
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
        {onOpenSettings && (
          <button
            aria-expanded={settingsOpen}
            aria-haspopup="dialog"
            className={`mt-0.5 flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-[13px] font-semibold transition-colors duration-150 ${
              settingsOpen
                ? "bg-surface-subtle text-ink"
                : "text-ink-soft hover:bg-surface-subtle hover:text-ink"
            }`}
            onClick={onOpenSettings}
            type="button"
          >
            <Icon name="settings" size={16} />
            {t("nav.settings")}
          </button>
        )}
      </div>
    </aside>
  );
}

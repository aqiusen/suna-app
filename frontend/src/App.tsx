import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatTimeline } from "./features/chat/ChatTimeline";
import { Composer, type ComposerHandle } from "./features/chat/Composer";
import { SLASH_COMMANDS } from "./features/chat/slashCommands";
import { useRuntimeSession } from "./features/runtime/useRuntimeSession";
import { SessionSidebar } from "./features/sessions/SessionSidebar";
import { SessionHeader } from "./features/sessions/SessionHeader";
import { SessionStatusBars } from "./features/sessions/SessionStatusBars";
import { SessionDialogs } from "./features/sessions/SessionDialogs";
import { TaskOverview } from "./features/overview/TaskOverview";
import {
  useGlobalShortcuts,
  useHashRouting,
  useTheme,
} from "./features/app/appHooks";
import {
  DisconnectedScreen,
  MobileTabBar,
  WaitingNotice,
} from "./features/app/AppChrome";
import {
  CommandPaletteOverlay,
  RuntimeSettingsOverlay,
} from "./features/app/AppOverlays";
import { LocaleProvider, useT } from "./lib/i18n";
import type { SkillInfo } from "./lib/runtimeBridge";
import { useMediaQuery } from "./lib/useMediaQuery";
import "./styles/tailwind.css";

/** 应用壳：语言由 LocaleProvider 提供，主题与 UI 状态留在 AppShell。 */
export function App() {
  return (
    <LocaleProvider>
      <AppShell />
    </LocaleProvider>
  );
}

function AppShell() {
  const t = useT();
  const isMobile = useMediaQuery("(max-width: 720px)");
  const { theme, setTheme, toggleTheme } = useTheme();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  /** 移动端底部导航：总览 / 任务（工作台）/ 设置。 */
  const [mobileTab, setMobileTab] = useState<
    "overview" | "session" | "settings"
  >(() =>
    isMobile
      ? window.location.hash.includes("/session/")
        ? "session"
        : "overview"
      : "session",
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [createInitialCwd, setCreateInitialCwd] = useState<string>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsClosing, setSettingsClosing] = useState(false);
  const closeSettings = () => {
    if (!settingsOpen) return;
    setSettingsClosing(true);
    window.setTimeout(() => {
      setSettingsOpen(false);
      setSettingsClosing(false);
    }, 190);
  };
  const [settingsInitialTab, setSettingsInitialTab] = useState<
    "connection" | "models" | "memory" | "mcp" | "skills" | "security"
  >("connection");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [renamingSessionId, setRenamingSessionId] = useState<string>();
  const [commandOpen, setCommandOpen] = useState(false);
  useGlobalShortcuts({ setCommandOpen, setCreateOpen, setSettingsOpen });

  const composerRef = useRef<ComposerHandle>(null);
  const session = useRuntimeSession();
  const {
    sessions,
    terminalStates,
    selectedId,
    selected,
    active,
    messages,
    config,
    setConfig,
    syncing,
    error,
    setError,
    running,
    canControl,
    canConfig,
    rpc,
    connected,
    hello,
    status,
    bridgeError,
    cap,
    queueSessionOperation,
    attach,
    initialize,
    create,
    send,
    interruptQueued,
    removeQueued,
    updateModel,
    rename,
    remove,
    deleteWorkdirSessions,
    mcpServers,
    refreshMcp,
  } = session;
  const sessionActionsFrozen = syncing || !selectedId;
  const current = active.snapshot?.current_run;
  const canRename = cap("session.update");
  const otherClients = (selected?.client_count ?? 0) > 1;
  // 只有真的还有别的窗口在控制这次 run 时才锁输入。单窗口
  // can_control=false 是 owner 连接更替，不能说成被别人占用。
  const inputBlockedByInteraction = Boolean(
    running &&
    ((otherClients && !canControl) ||
      active.ask ||
      active.guard ||
      active.run?.state === "cancelling" ||
      current?.waiting_type),
  );
  function openRename(target: { id: string; title?: string }) {
    setRenamingSessionId(target.id);
    setTitleDraft(target.title ?? "");
    setEditingTitle(true);
  }

  useHashRouting({ attach, connected, selectedId });
  const loadSkills = useCallback(
    () => rpc("skill.list", {}).then((result) => result.skills),
    [rpc],
  );
  const toggleSkill = useCallback(
    async (skill: SkillInfo, enabled: boolean) => {
      await rpc("skill.set", {
        name: skill.name,
        scope: skill.scope,
        enabled,
      });
      return (await rpc("skill.list", {})).skills;
    },
    [rpc],
  );
  const slashCommands = useMemo(
    () =>
      SLASH_COMMANDS.filter((item) => {
        if (item.cmd === "/skills") return cap("skill");
        if (item.cmd === "/mcp") return cap("mcp");
        if (item.cmd === "/memory") return cap("memory");
        if (item.cmd === "/compact") return cap("session");
        if (item.cmd === "/model") return canConfig;
        return true;
      }),
    [canConfig, cap],
  );

  const otherWaiting = sessions.filter(
    (session) => session.status === "waiting" && session.id !== selectedId,
  );
  const [dismissedWaiting, setDismissedWaiting] = useState<Set<string>>(
    () => new Set(),
  );
  const visibleWaiting = otherWaiting.filter(
    (session) => !dismissedWaiting.has(session.id),
  );
  useEffect(() => {
    document.title = visibleWaiting.length
      ? `(${visibleWaiting.length}) Suna App`
      : "Suna App";
    return () => {
      document.title = "Suna App";
    };
  }, [visibleWaiting.length]);

  if (!connected)
    return (
      <DisconnectedScreen
        message={error || bridgeError?.message || t("connect.desc")}
        onInitialize={() => void initialize()}
        status={status}
      />
    );

  return (
    <main className="animate-[message-in_420ms_cubic-bezier(0.2,0.8,0.2,1)_both] app-shell details-closed">
      <SessionSidebar
        connected={connected}
        onCreate={create}
        onRequestCreate={(cwd) => {
          setCreateInitialCwd(cwd);
          setCreateOpen(true);
        }}
        onReconnect={() => void initialize()}
        runtimeVersion={hello?.runtime_version}
        onSelect={(id) => void attach(id).then(() => setMobileMenuOpen(false))}
        open={mobileMenuOpen}
        pendingId={syncing ? selectedId : undefined}
        disabled={syncing}
        selectedId={selectedId}
        sessions={sessions}
        terminalStates={terminalStates}
        onDelete={cap("session.delete") ? (id) => void remove(id) : undefined}
        onRename={
          canRename
            ? (id) => {
                const target = sessions.find((item) => item.id === id);
                if (target) openRename(target);
              }
            : undefined
        }
        onDeleteWorkdir={
          cap("session.delete")
            ? (cwd) => deleteWorkdirSessions(cwd)
            : undefined
        }
        onClose={() => setMobileMenuOpen(false)}
        onOpenSettings={() =>
          settingsOpen ? closeSettings() : setSettingsOpen(true)
        }
        settingsOpen={settingsOpen}
      />
      {/* 移动端抽屉遮罩：常驻 DOM，is-visible 控制淡入淡出（CSS 过渡）。 */}
      <button
        aria-label={t("common.closeSidebar")}
        className={`mobile-scrim ${mobileMenuOpen ? "is-visible" : ""}`}
        onClick={() => setMobileMenuOpen(false)}
        tabIndex={mobileMenuOpen ? 0 : -1}
        type="button"
      />{" "}
      <section className="workspace">
        <SessionHeader
          canControl={canControl}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          onStop={() =>
            void queueSessionOperation(() => rpc("agent.cancel", {}))
          }
          running={running}
          selected={selected}
          syncing={syncing}
          onRename={
            selected && canRename ? () => openRename(selected) : undefined
          }
        />
        <SessionDialogs
          createOpen={createOpen}
          createInitialCwd={createInitialCwd}
          editingTitle={editingTitle}
          onCreate={(cwd, title) =>
            create(cwd, title).then(() => setCreateOpen(false))
          }
          onCreateOpenChange={(open) => {
            setCreateOpen(open);
            if (!open) setCreateInitialCwd(undefined);
          }}
          onEditingTitleChange={(open) => {
            setEditingTitle(open);
            if (!open) setRenamingSessionId(undefined);
          }}
          onRename={async () => {
            try {
              if (renamingSessionId && renamingSessionId !== selectedId)
                await attach(renamingSessionId);
              const ok = await rename(titleDraft);
              if (ok) {
                setEditingTitle(false);
                setRenamingSessionId(undefined);
              }
            } catch {
              // attach 失败已由 session hook 写入错误条。
            }
          }}
          onTitleDraftChange={setTitleDraft}
          titleDraft={titleDraft}
        />
        <SessionStatusBars
          error={error}
          onCloseError={() => setError(undefined)}
        />
        <WaitingNotice
          disabled={syncing}
          onDismiss={() =>
            setDismissedWaiting((value) => {
              const next = new Set(value);
              for (const session of visibleWaiting) next.add(session.id);
              return next;
            })
          }
          onGo={() => {
            const first = visibleWaiting[0];
            if (first) void attach(first.id);
          }}
          sessions={visibleWaiting}
        />
        <RuntimeSettingsOverlay
          cap={cap}
          closing={settingsClosing}
          config={config}
          connected={connected}
          hello={hello}
          initialTab={settingsInitialTab}
          mcpServers={mcpServers}
          onClose={closeSettings}
          onConfig={setConfig}
          onReconnect={() => void initialize()}
          onThemeChange={setTheme}
          onApplySessionModel={
            selectedId && !sessionActionsFrozen
              ? (modelRef) => {
                  const current =
                    selected?.model_ref ?? active.snapshot?.session.model_ref;
                  if (current === modelRef) return Promise.resolve();
                  return updateModel(modelRef);
                }
              : undefined
          }
          open={settingsOpen}
          refreshMcp={() => void refreshMcp()}
          rpc={rpc}
          theme={theme}
        />
        {!selected || mobileTab === "overview" ? (
          <TaskOverview
            connected={connected}
            hasModels={Boolean(config && config.models.length > 0)}
            onCreate={() => setCreateOpen(true)}
            onOpenSettings={() => {
              setSettingsInitialTab("models");
              setSettingsOpen(true);
            }}
            onReconnect={() => void initialize()}
            onSelect={(id) => {
              setMobileTab("session");
              void attach(id);
            }}
            pendingId={syncing ? selectedId : undefined}
            selectedId={selectedId}
            sessions={sessions}
          />
        ) : (
          <>
            <ChatTimeline
              activeTool={active.activeTool}
              ask={active.ask}
              controlsDisabled={
                syncing || (running && otherClients && !canControl)
              }
              guard={active.guard}
              loading={syncing}
              messages={messages}
              onAskReply={(id, answer) =>
                queueSessionOperation(() =>
                  rpc("agent.askReply", { id, answer }),
                ).then(() => undefined)
              }
              onGuardReply={(id, decision) =>
                queueSessionOperation(() =>
                  rpc("agent.guardReply", { id, decision }),
                ).then(() => undefined)
              }
              onRemoveQueuedMessage={removeQueued}
              onInterruptQueuedMessage={(item) => void interruptQueued(item)}
              onSuggestion={(text) => composerRef.current?.fillDraft(text)}
              onQuoteSelection={(text) =>
                composerRef.current?.addSelectedContext(text)
              }
              pending={active.queueDispatching || Boolean(active.awaitingRun)}
              phase={active.run?.phase ?? current?.phase}
              flow={active.flow}
              flowTurns={active.flowTurns}
              run={active.run}
              running={running}
              queuedMessages={active.queuedMessages}
              queueControlsDisabled={syncing}
              sessionId={active.snapshot?.session.id}
              toolSummary={active.toolSummary}
            />
            <Composer
              activeModel={
                selected?.model_ref ??
                active.snapshot?.session.model_ref ??
                config?.active_model
              }
              approvalMode={config?.guard_mode}
              canAttachImageUrl={Boolean(hello?.content_sources.image_url)}
              disabled={sessionActionsFrozen || inputBlockedByInteraction}
              models={config?.models}
              onApprovalModeChange={
                canConfig && !sessionActionsFrozen
                  ? (mode) =>
                      rpc("config.set", {
                        action: "update_general",
                        guard_mode: mode,
                      }).then(() =>
                        // 保存成功后刷新本地 config 快照。
                        rpc("config.get", {}).then(setConfig),
                      )
                  : undefined
              }
              onModelChange={
                canConfig && !sessionActionsFrozen
                  ? (modelRef) => void updateModel(modelRef)
                  : undefined
              }
              onReasoningChange={
                canConfig && !sessionActionsFrozen
                  ? (model) =>
                      rpc("config.set", {
                        action: "upsert_model",
                        model,
                      }).then((next) => {
                        setConfig(next);
                      })
                  : undefined
              }
              loadSkills={cap("skill") ? loadSkills : undefined}
              onSlashCommand={(cmd) => {
                if (cmd === "/new") {
                  setCreateOpen(true);
                  return;
                }
                if (cmd === "/compact") {
                  void queueSessionOperation(() => rpc("session.compact", {}));
                  return;
                }
                if (cmd === "/config") {
                  setSettingsOpen(true);
                  return;
                }
                if (cmd === "/memory") {
                  setSettingsInitialTab("memory");
                  setSettingsOpen(true);
                  return;
                }
                if (cmd === "/mcp") {
                  setSettingsInitialTab("mcp");
                  setSettingsOpen(true);
                  return;
                }
                if (cmd === "/model") {
                  setSettingsInitialTab("models");
                  setSettingsOpen(true);
                }
              }}
              onSubmit={send}
              onToggleSkill={cap("skill") ? toggleSkill : undefined}
              ref={composerRef}
              slashCommands={slashCommands}
              waiting={selected?.status === "waiting"}
            />
          </>
        )}
      </section>
      <MobileTabBar
        mobileTab={mobileTab}
        onOpenSettings={() => {
          setMobileTab("settings");
          setSettingsOpen(true);
        }}
        onSelectOverview={() => setMobileTab("overview")}
        onSelectSession={() => setMobileTab("session")}
        selected={selected}
      />
      <CommandPaletteOverlay
        canCompact={
          Boolean(selected) &&
          !sessionActionsFrozen &&
          !running &&
          selected?.status !== "compacting"
        }
        onClose={() => setCommandOpen(false)}
        onCompact={() =>
          queueSessionOperation(() => rpc("session.compact", {})).then(
            () => undefined,
          )
        }
        onCreateTask={() => {
          setCreateOpen(true);
        }}
        onOpenSettings={() => setSettingsOpen(true)}
        onSelectSession={(id) => {
          setMobileTab("session");
          void attach(id);
        }}
        onStopTask={() =>
          queueSessionOperation(() => rpc("agent.cancel", {})).then(
            () => undefined,
          )
        }
        onToggleTheme={toggleTheme}
        open={commandOpen}
        running={running}
        selectedId={selectedId}
        sessions={sessions}
      />
    </main>
  );
}

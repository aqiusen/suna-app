import { useEffect, useRef, useState } from "react";
import { ChatTimeline } from "./features/chat/ChatTimeline";
import { Composer, type ComposerHandle } from "./features/chat/Composer";
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
  const { theme, setTheme, resolvedTheme, toggleTheme } = useTheme();

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
    "connection" | "models"
  >("connection");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [commandOpen, setCommandOpen] = useState(false);
  useGlobalShortcuts({ setCommandOpen, setCreateOpen, setSettingsOpen });

  const composerRef = useRef<ComposerHandle>(null);
  const session = useRuntimeSession();
  const {
    sessions,
    selectedId,
    selected,
    active,
    messages,
    config,
    setConfig,
    syncing,
    error,
    setError,
    observer,
    running,
    canControl,
    canConfig,
    handoffRole,
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
    updateModel,
    rename,
    remove,
    mcpServers,
    refreshMcp,
  } = session;
  const sessionActionsFrozen = syncing || !selectedId;
  const current = active.snapshot?.current_run;

  useHashRouting({ attach, connected, selectedId });

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
        onRequestCreate={() => setCreateOpen(true)}
        onReconnect={() => void initialize()}
        runtimeVersion={hello?.runtime_version}
        onSelect={(id) => void attach(id).then(() => setMobileMenuOpen(false))}
        onJoinActive={(id) =>
          void attach(id, true).then(() => setMobileMenuOpen(false))
        }
        open={mobileMenuOpen}
        pendingId={syncing ? selectedId : undefined}
        disabled={syncing}
        selectedId={selectedId}
        sessions={sessions}
        onDelete={cap("session") ? (id) => void remove(id) : undefined}
        onClose={() => setMobileMenuOpen(false)}
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
          handoffRole={handoffRole}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          onOpenSettings={() => setSettingsOpen((value) => !value)}
          onStop={() =>
            void queueSessionOperation(() => rpc("agent.cancel", {}))
          }
          onToggleTheme={toggleTheme}
          resolvedTheme={resolvedTheme}
          running={running}
          selected={selected}
          syncing={syncing}
        />
        <SessionDialogs
          createOpen={createOpen}
          editingTitle={editingTitle}
          onCreate={(cwd, title) =>
            create(cwd, title).then(() => setCreateOpen(false))
          }
          onCreateOpenChange={setCreateOpen}
          onEditingTitleChange={setEditingTitle}
          onRename={() => void rename(titleDraft)}
          onTitleDraftChange={setTitleDraft}
          titleDraft={titleDraft}
        />
        <SessionStatusBars
          error={error}
          handoffRole={handoffRole}
          observer={observer}
          onCloseError={() => setError(undefined)}
          selected={selected}
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
              controlsDisabled={syncing || (running && !canControl)}
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
              onSuggestion={
                // 只读模式（observer）下不引导输入：建议卡隐藏，避免填入后无法发送。
                observer
                  ? undefined
                  : (text) => composerRef.current?.fillDraft(text)
              }
              pending={
                active.pendingUsers.length > 0 || Boolean(active.awaitingRun)
              }
              phase={active.run?.phase ?? current?.phase}
              flow={active.flow}
              running={running}
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
              disabled={sessionActionsFrozen || observer}
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
                canConfig && !sessionActionsFrozen && !observer
                  ? (modelRef) => void updateModel(modelRef)
                  : undefined
              }
              onReasoningChange={
                canConfig && !sessionActionsFrozen && !observer
                  ? (model) =>
                      rpc("config.set", {
                        action: "upsert_model",
                        model,
                      }).then((next) => {
                        setConfig(next);
                      })
                  : undefined
              }
              onSubmit={send}
              observer={observer}
              ref={composerRef}
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

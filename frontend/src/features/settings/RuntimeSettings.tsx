import { useCallback, useEffect, useState } from "react";
import { Icon, IconButton } from "../../components/Icon";
import { useT } from "../../lib/i18n";
import type { Theme } from "../../lib/models";
import type {
  MCPServerInfo,
  MemoryItem,
  RuntimeCatalog,
  RuntimeConfig,
  SkillInfo,
} from "../../lib/runtimeBridge";
import type { useRuntimeBridge } from "../runtime/useRuntimeBridge";
import { ConnectionTab } from "./ConnectionTab";
import { MemoryTab } from "./MemoryTab";
import { ModelsTab } from "./ModelsTab";
import { McpTab } from "./McpTab";
import { SecurityTab } from "./SecurityTab";
import { SkillsTab } from "./SkillsTab";

type SettingsProps = {
  cap: (name: string) => boolean;
  config?: RuntimeConfig;
  hello?: { runtime_version: string; catalog: RuntimeCatalog };
  mcpServers: MCPServerInfo[];
  onConfig: (config: RuntimeConfig) => void;
  onClose: () => void;
  refreshMcp: () => void;
  rpc: ReturnType<typeof useRuntimeBridge>["rpc"];
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  connected: boolean;
  onReconnect: () => void;
  /** 初始选中的 Tab（Onboarding 引导直接打开模型配置）。 */
  initialTab?: TabId;
  /** 关闭动画进行中：外层容器播放 panel-out 退出动画。 */
  closing?: boolean;
};

export type SettingsTabProps = {
  cap: (name: string) => boolean;
  config?: RuntimeConfig;
  hello?: { runtime_version: string; catalog: RuntimeCatalog };
  mcpServers: MCPServerInfo[];
  onConfig: (config: RuntimeConfig) => void;
  refreshMcp: () => void;
  rpc: ReturnType<typeof useRuntimeBridge>["rpc"];
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  connected: boolean;
  onReconnect: () => void;
};
/** 设置中心 Tab 定义：名称面向用户（设计 §10 去术语化），双语。 */
const TABS = [
  { id: "connection", labelKey: "settings.tab.connection", icon: "link" },
  { id: "models", labelKey: "settings.tab.models", icon: "sparkle" },
  { id: "security", labelKey: "settings.tab.security", icon: "shield" },
  { id: "memory", labelKey: "settings.tab.memory", icon: "database" },
  { id: "skills", labelKey: "settings.tab.skills", icon: "book" },
  { id: "mcp", labelKey: "settings.tab.mcp", icon: "plug" },
] as const;

type TabId = (typeof TABS)[number]["id"];

/** Runtime 能力设置中心：六 Tab（连接/模型/安全/记忆/技能/外部工具）。 */
export function RuntimeSettings({
  cap,
  config,
  hello,
  mcpServers,
  onConfig,
  onClose,
  refreshMcp,
  rpc,
  theme,
  onThemeChange,
  connected,
  onReconnect,
  initialTab = "connection",
  closing = false,
}: SettingsProps) {
  const t = useT();
  const [tab, setTab] = useState<TabId>(initialTab);
  const [memory, setMemory] = useState<MemoryItem[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string>();
  const load = useCallback(async () => {
    try {
      if (cap("memory")) setMemory((await rpc("memory.list", {})).memories);
      if (cap("skill")) setSkills((await rpc("skill.list", {})).skills);
      setLoaded(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("settings.error"));
    }
  }, [cap, rpc, t]);
  useEffect(() => {
    void load();
    if (cap("mcp")) refreshMcp();
  }, [cap, load, refreshMcp]);

  const shared: SettingsTabProps = {
    cap,
    config,
    hello,
    mcpServers,
    onConfig,
    refreshMcp,
    rpc,
    theme,
    onThemeChange,
    connected,
    onReconnect,
  };

  return (
    <section
      aria-label={t("settings.title")}
      className={`runtime-settings overflow-hidden rounded-2xl border border-line bg-surface-solid shadow-lg ${
        closing
          ? "pointer-events-none animate-[panel-out_180ms_cubic-bezier(0.2,0.8,0.2,1)_both]"
          : "animate-[panel-pop_220ms_cubic-bezier(0.2,0.8,0.2,1)_both]"
      }`}
    >
      <div className="flex items-center justify-between border-b border-line px-4 py-3.5">
        <div>
          <p className="text-[10px] font-extrabold tracking-[0.095em] text-ink-muted uppercase">
            {t("settings.title")}
          </p>
          <h2 className="mt-0.5 text-[16px] font-extrabold text-ink">
            {t("settings.title")}
          </h2>
        </div>
        <IconButton label={t("settings.close")} onClick={onClose}>
          <Icon name="close" />
        </IconButton>
      </div>
      {/* Tab 栏：横向滚动，移动端可滑 */}
      <div
        aria-label={t("settings.tabs")}
        className="flex gap-1 overflow-x-auto border-b border-line px-3 py-2"
        role="tablist"
      >
        {TABS.map((item) => {
          const label = t(item.labelKey);
          return (
            <button
              aria-selected={tab === item.id}
              className={`flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-bold transition-colors duration-150 ${
                tab === item.id
                  ? "bg-blue-soft text-blue-strong"
                  : "text-ink-soft hover:bg-surface-subtle hover:text-ink"
              }`}
              key={item.id}
              onClick={() => setTab(item.id)}
              role="tab"
              type="button"
            >
              <Icon name={item.icon} size={13} />
              {label}
            </button>
          );
        })}
      </div>
      <div className="max-h-[calc(100vh-230px)] overflow-auto p-4">
        {error && (
          <p className="mb-3 text-[12px] font-semibold text-rose">{error}</p>
        )}
        {tab === "connection" && <ConnectionTab {...shared} />}
        {tab === "models" && <ModelsTab {...shared} />}
        {tab === "security" && <SecurityTab {...shared} />}
        {tab === "memory" && (
          <MemoryTab {...shared} items={memory} onChanged={() => void load()} />
        )}
        {tab === "skills" && (
          <SkillsTab {...shared} items={skills} onChanged={() => void load()} />
        )}
        {tab === "mcp" && <McpTab {...shared} />}
        {!loaded && (
          <p className="text-[13px] text-ink-muted">{t("settings.loading")}</p>
        )}
      </div>
    </section>
  );
}

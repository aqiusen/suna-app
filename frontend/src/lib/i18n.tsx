import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * 轻量 i18n：中英文双语，无第三方依赖。
 * - 语言检测：localStorage 偏好 > 浏览器语言（navigator.language）
 * - 切换后持久化，界面即时生效（React state 驱动重渲染）
 */

export type Locale = "zh" | "en";

const STORAGE_KEY = "suna-locale";

/** 检测系统语言：浏览器语言前缀匹配 zh → 中文，否则英文。 */
export function detectLocale(): Locale {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "zh" || saved === "en") return saved;
  } catch {
    // localStorage 不可用时回落到浏览器语言。
  }
  return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function saveLocale(locale: Locale) {
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // 持久化失败不影响本次会话。
  }
}

type Dict = Record<string, { zh: string; en: string }>;

/** 翻译字典：UI 高频文案。key 稳定，新增文案在此登记。 */
const DICT: Dict = {
  // 应用壳
  "app.name": { zh: "Suna", en: "Suna" },
  "nav.overview": { zh: "总览", en: "Overview" },
  "nav.task": { zh: "任务", en: "Task" },
  "nav.settings": { zh: "设置", en: "Settings" },
  "overview.title": { zh: "任务总览", en: "Tasks" },
  "overview.subtitle.connected": {
    zh: "Suna Runtime 已连接，随时可接管任务",
    en: "Runtime connected — take over any task",
  },
  "overview.subtitle.disconnected": {
    zh: "Suna Runtime 未连接",
    en: "Runtime disconnected",
  },
  "overview.new": { zh: "新建任务", en: "New task" },
  "overview.needsYou": { zh: "需要你处理", en: "Needs you" },
  "overview.running": { zh: "运行中", en: "Running" },
  "overview.recent": { zh: "最近任务", en: "Recent" },
  "overview.empty.needsYou": {
    zh: "没有待处理的事项",
    en: "Nothing needs you",
  },
  "overview.empty": { zh: "暂无", en: "None" },
  "overview.onboarding.title": {
    zh: "配置一个模型开始使用",
    en: "Configure a model to get started",
  },
  "overview.onboarding.desc": {
    zh: "Suna 还没有可用的模型。添加模型（如 DeepSeek）后即可新建任务。",
    en: "No model configured yet. Add one (e.g. DeepSeek) to start new tasks.",
  },
  "overview.onboarding.cta": { zh: "去配置模型", en: "Configure model" },
  "overview.reconnect": { zh: "重新连接 Runtime", en: "Reconnect Runtime" },
  // 侧栏
  "sidebar.search": { zh: "搜索任务…", en: "Search tasks…" },
  "sidebar.empty": {
    zh: "还没有任务。创建一个任务开始吧。",
    en: "No tasks yet. Create one to start.",
  },
  "sidebar.noMatch": { zh: "没有匹配的任务。", en: "No matching tasks." },
  "sidebar.connected": { zh: "Runtime 已连接", en: "Runtime connected" },
  "sidebar.disconnected": {
    zh: "Runtime 未连接，点击重连",
    en: "Runtime disconnected — click to reconnect",
  },
  "sidebar.workspace": { zh: "Runtime workspace", en: "Runtime workspace" },
  "sidebar.newTask": { zh: "新建任务", en: "New task" },
  "sidebar.closeList": { zh: "关闭会话列表", en: "Close session list" },
  "sidebar.sessionLabel": { zh: "会话", en: "Sessions" },
  "sidebar.recent": { zh: "最近会话", en: "Recent sessions" },
  "sidebar.groupPending": { zh: "有待处理任务", en: "Has pending tasks" },
  "sidebar.pin": { zh: "置顶会话", en: "Pin session" },
  "sidebar.unpin": { zh: "取消置顶", en: "Unpin session" },
  "sidebar.rename": { zh: "重命名会话", en: "Rename session" },
  "sidebar.detach": { zh: "分离会话", en: "Detach session" },
  "sidebar.delete": { zh: "删除会话", en: "Delete session" },
  "sidebar.sessionActions": { zh: "会话操作", en: "Session actions" },
  "sidebar.untitled": { zh: "未命名会话", en: "Untitled session" },
  "sidebar.opening": { zh: "正在打开…", en: "Opening…" },
  "sidebar.join": { zh: "加入", en: "Join" },
  "sidebar.joinRunning": {
    zh: "加入正在运行的会话",
    en: "Join running session",
  },
  "session.status.idle": { zh: "空闲", en: "Idle" },
  "session.status.running": { zh: "正在运行", en: "Running" },
  "session.status.waiting": { zh: "等待你的回答", en: "Waiting for you" },
  "session.status.compacting": { zh: "正在压缩上下文", en: "Compacting" },
  "time.justNow": { zh: "刚刚", en: "just now" },
  "time.minutesAgo": { zh: "{m} 分钟前", en: "{m} minutes ago" },
  "time.hoursAgo": { zh: "{h} 小时前", en: "{h} hours ago" },
  // 连接页
  "connect.title": { zh: "连接 Runtime", en: "Connect Runtime" },
  "connect.connecting": {
    zh: "正在连接你的工作空间",
    en: "Connecting to your workspace",
  },
  "connect.desc": {
    zh: "通过本地 Gateway 连接 Suna Runtime。",
    en: "Connect to Suna Runtime via the local gateway.",
  },
  "connect.button": { zh: "连接 Runtime", en: "Connect" },
  "connect.connectingBtn": { zh: "正在连接…", en: "Connecting…" },
  // 设置中心
  "settings.title": { zh: "Suna 设置", en: "Suna Settings" },
  "settings.tab.connection": { zh: "连接", en: "Connection" },
  "settings.tab.models": { zh: "模型", en: "Models" },
  "settings.tab.security": { zh: "安全", en: "Security" },
  "settings.tab.memory": { zh: "记忆", en: "Memory" },
  "settings.tab.skills": { zh: "技能", en: "Skills" },
  "settings.tab.mcp": { zh: "外部工具", en: "External tools" },
  "settings.loading": { zh: "正在加载可用设置…", en: "Loading settings…" },
  // 工作台
  "chat.sendPlaceholder": { zh: "给 Suna 发送消息…", en: "Message Suna…" },
  "chat.send": { zh: "发送消息", en: "Send message" },
  "chat.timelineLabel": { zh: "会话消息", en: "Session messages" },
  "chat.processLabel": { zh: "执行过程", en: "Activity" },
  "chat.empty.title": { zh: "开始一个任务", en: "Start a task" },
  "chat.empty.desc": {
    zh: "告诉 Suna 你想在这个工作目录中完成什么，它会负责执行与推进。",
    en: "Tell Suna what to do in this workspace — it will execute and drive it forward.",
  },
  "chat.user": { zh: "你", en: "You" },
  "chat.composerHint": {
    zh: "Enter 发送 · Shift+Enter 换行",
    en: "Enter to send · Shift+Enter for newline",
  },
  "chat.suggestion.analyze": {
    zh: "分析当前项目的代码结构，找出潜在问题并解释整体架构",
    en: "Analyze the codebase, surface issues and explain the architecture",
  },
  "chat.suggestion.analyzeLabel": {
    zh: "让 Suna 分析代码、查找问题并解释架构",
    en: "Have Suna analyze code, find issues and explain the architecture",
  },
  "chat.suggestion.fix": {
    zh: "修改项目中的问题文件、运行测试，并汇报最终结果",
    en: "Fix problem files, run tests and report the final result",
  },
  "chat.suggestion.fixLabel": {
    zh: "让它修改文件、运行测试并汇报结果",
    en: "Have it fix files, run tests and report",
  },
  "chat.copyMessage": { zh: "复制消息", en: "Copy message" },
  "chat.copyCode": { zh: "复制代码", en: "Copy code" },
  "chat.copied": { zh: "已复制", en: "Copied" },
  "chat.copyResult": { zh: "复制工具结果", en: "Copy result" },
  "chat.resultCopied": { zh: "已复制工具结果", en: "Result copied" },
  "chat.moreHistory": {
    zh: "显示更早的 {count} 条消息",
    en: "Show {count} earlier messages",
  },
  "chat.backToLatest": { zh: "回到最新消息", en: "Back to latest" },
  "chat.replying": { zh: "正在回复", en: "Replying" },
  "chat.result": { zh: "结果", en: "Result" },
  "chat.resultTruncated": { zh: "（结果已截断）", en: "(result truncated)" },
  "chat.params": { zh: "参数", en: "Params" },
  "chat.error": { zh: "错误", en: "Error" },
  "chat.thinking": { zh: "思考中", en: "Thinking" },
  "chat.viewThinking": { zh: "查看思考过程", en: "View thinking" },
  "chat.collapseThinking": { zh: "收起思考", en: "Collapse thinking" },
  "chat.skill": { zh: "技能 {name}", en: "Skill {name}" },
  "chat.subtask": { zh: "子任务", en: "Subtask" },
  "chat.subtaskTools": { zh: "{count} 个工具", en: "{count} tools" },
  "chat.subtaskWaiting": {
    zh: "等待子任务执行工具…",
    en: "Waiting for subtask tools…",
  },
  "chat.subtaskNoTools": {
    zh: "子任务未执行工具",
    en: "No tools ran in subtask",
  },
  "chat.expandFull": {
    zh: "展开完整内容（{kb}KB）",
    en: "Expand full content ({kb}KB)",
  },
  "chat.sendError": { zh: "消息发送失败。", en: "Failed to send message." },
  "chat.invalidImageUrl": {
    zh: "请输入以 http:// 或 https:// 开头的图片地址。",
    en: "Enter an image URL starting with http:// or https://",
  },
  "chat.imageUrl": { zh: "图片 URL", en: "Image URL" },
  "chat.addImage": { zh: "添加图片", en: "Add image" },
  "chat.removeImage": { zh: "移除图片 {url}", en: "Remove image {url}" },
  "chat.imagePlaceholder": {
    zh: "https://example.com/image.png",
    en: "https://example.com/image.png",
  },
  "chat.waitingReply": { zh: "等待你的回答", en: "Waiting for you" },
  "chat.observerNotice": {
    zh: "其他客户端正在运行此会话，任务结束后可在此输入",
    en: "Another client is running this session; type here once it finishes",
  },
  "chat.observerPlaceholder": {
    zh: "其他客户端正在运行此会话，当前仅可查看…",
    en: "Another client is running this session — view only…",
  },
  "chat.selectSessionFirst": {
    zh: "请先选择一个会话…",
    en: "Select a session first…",
  },
  "chat.inputLabel": { zh: "给 Suna 发送消息", en: "Message Suna" },
  // 决策卡
  "guard.approve": { zh: "批准", en: "Approve" },
  "guard.reject": { zh: "拒绝", en: "Reject" },
  "guard.modify": { zh: "按建议执行", en: "Apply suggestion" },
  "guard.approveOriginal": { zh: "批准原操作", en: "Approve original" },
  "guard.suggest": { zh: "建议改为：", en: "Suggested:" },
  "guard.title": { zh: "需要你的授权", en: "Approval needed" },
  "ask.title": { zh: "Suna 有一个问题", en: "Suna has a question" },
  "ask.replyToContinue": { zh: "请回复后继续", en: "Reply to continue" },
  "ask.inputPlaceholder": { zh: "输入你的回答", en: "Type your answer" },
  "ask.answer": { zh: "回答", en: "Answer" },
  "ask.send": { zh: "发送", en: "Send" },
  "decision.otherClient": {
    zh: "此请求由其他客户端处理；当前窗口仅可查看。",
    en: "Handled by another client; this window is view-only.",
  },
  // 活动卡（agent 状态）
  "activity.ask": { zh: "等待你的回答", en: "Waiting for you" },
  "activity.askDetail": {
    zh: "收到回复后会继续处理任务",
    en: "Will continue once you reply",
  },
  "activity.toolFailed": {
    zh: "工具执行未完成",
    en: "Tool execution incomplete",
  },
  "activity.guard": { zh: "等待你确认操作", en: "Waiting for your approval" },
  "activity.guardDetail": {
    zh: "此操作需要授权后继续",
    en: "This action needs your approval to continue",
  },
  "activity.compact": { zh: "正在整理上下文", en: "Compacting context" },
  "activity.compactDetail": {
    zh: "整理完成后将继续任务",
    en: "Will continue once compacted",
  },
  "activity.skill": { zh: "正在准备技能", en: "Preparing skills" },
  "activity.skillDetail": {
    zh: "正在加载完成任务所需的能力",
    en: "Loading capabilities for this task",
  },
  "activity.toolRunning": { zh: "正在执行工具", en: "Running tool" },
  "activity.toolPreparing": { zh: "正在准备工具操作", en: "Preparing tool" },
  "activity.toolDetail": {
    zh: "正在处理任务中的下一步",
    en: "Working on the next step",
  },
  "activity.model": { zh: "正在分析任务", en: "Analyzing task" },
  "activity.modelDetail": {
    zh: "Suna 正在组织下一步操作",
    en: "Suna is planning the next step",
  },
  "activity.pending": { zh: "已收到你的消息", en: "Message received" },
  "activity.pendingDetail": {
    zh: "Suna 正在开始处理这个任务",
    en: "Suna is starting on this task",
  },
  "activity.processing": { zh: "正在处理任务", en: "Processing task" },
  "activity.nextStep": {
    zh: "Suna 正在准备下一步",
    en: "Suna is preparing the next step",
  },
  // 工具行
  "tool.running": { zh: "执行中", en: "Running" },
  "tool.guard": { zh: "等待授权", en: "Awaiting approval" },
  "tool.success": { zh: "完成", en: "Done" },
  "tool.failed": { zh: "失败", en: "Failed" },
  "skill.loading": { zh: "加载中", en: "Loading" },
  "skill.reviewing": { zh: "校验中", en: "Reviewing" },
  "skill.loaded": { zh: "已加载", en: "Loaded" },
  "skill.done": { zh: "校验通过", en: "Verified" },
  "skill.error": { zh: "校验失败", en: "Verification failed" },
  "subtask.running": { zh: "运行中", en: "Running" },
  "subtask.success": { zh: "完成", en: "Done" },
  "subtask.failed": { zh: "失败", en: "Failed" },
  "toolSummary.title": { zh: "工具执行", en: "Tool activity" },
  "toolSummary.total": {
    zh: "共 {total} 次 · {success} 成功",
    en: "{total} runs · {success} succeeded",
  },
  "toolSummary.failed": { zh: "· {failed} 失败", en: "· {failed} failed" },
  // 状态条 / 运行详情
  "run.title": { zh: "状态与用量", en: "Status & usage" },
  "run.currentSession": { zh: "当前会话", en: "Current session" },
  "run.running": { zh: "正在执行任务", en: "Task running" },
  "run.waiting": { zh: "等待你的输入", en: "Waiting for your input" },
  "run.compacting": { zh: "正在压缩上下文", en: "Compacting context" },
  "run.idle": { zh: "会话空闲", en: "Session idle" },
  "run.phase": { zh: "阶段：{phase}", en: "Phase: {phase}" },
  "run.processing": { zh: "Suna 正在处理任务", en: "Suna is processing" },
  "run.replyToContinue": { zh: "回复后将继续处理", en: "Reply to continue" },
  "run.idleHint": {
    zh: "可开始新任务或加入运行中的会话",
    en: "Start a new task or join a running session",
  },
  "run.resume": { zh: "恢复执行", en: "Resume" },
  "run.retrying": {
    zh: "正在重试（{attempt}/{max}），{seconds} 秒后继续",
    en: "Retrying ({attempt}/{max}) in {seconds}s",
  },
  "run.liveStatus": {
    zh: "实时状态和工具活动来自当前 Runtime 会话。",
    en: "Live status and tool activity from the current Runtime session.",
  },
  "run.modelUnavailable": {
    zh: "会话模型不可用：{model}",
    en: "Session model unavailable: {model}",
  },
  "run.noModel": { zh: "尚未配置模型。", en: "No model configured." },
  "run.approveInChat": {
    zh: "请在对话中处理此请求",
    en: "Handle this request in the chat",
  },
  "run.usage": { zh: "本次用量", en: "This run" },
  "run.compact": { zh: "压缩", en: "Compact" },
  "run.compactingNow": { zh: "正在压缩上下文…", en: "Compacting…" },
  "run.compactFailed": {
    zh: "压缩失败：{error}",
    en: "Compact failed: {error}",
  },
  "run.compactNoop": {
    zh: "上下文足够短，无需压缩。",
    en: "Context is short enough; no need to compact.",
  },
  "run.compacted": {
    zh: "✓ 已压缩 {before} → {after} tokens",
    en: "✓ Compacted {before} → {after} tokens",
  },
  "run.turnsCompressed": {
    zh: "压缩 {count} 轮",
    en: "{count} turns compressed",
  },
  "run.inputOutput": { zh: "输入 / 输出", en: "Input / Output" },
  "run.cacheHit": { zh: "缓存命中", en: "Cache hit" },
  "run.todayRequests": { zh: "今日请求", en: "Requests today" },
  "run.context": {
    zh: "上下文 {used} / {total}",
    en: "Context {used} / {total}",
  },
  "run.sessionModel": { zh: "会话模型", en: "Session model" },
  "run.close": { zh: "关闭任务详情", en: "Close details" },
  "run.detailsLabel": { zh: "任务详情", en: "Run details" },
  // Header
  "header.overview": { zh: "任务总览", en: "Tasks" },
  "header.running": { zh: "运行中", en: "Running" },
  "header.waiting": { zh: "等待回答", en: "Waiting" },
  "header.idle": { zh: "空闲", en: "Idle" },
  "header.stop": { zh: "停止", en: "Stop" },
  "header.confirmStop": { zh: "确认停止？", en: "Confirm stop?" },
  "header.workspace": {
    zh: "你的本地 Runtime 工作空间",
    en: "Your local Runtime workspace",
  },
  "header.openSidebar": { zh: "打开会话列表", en: "Open session list" },
  "header.toggleTheme": { zh: "切换主题", en: "Toggle theme" },
  "header.lightMode": { zh: "切换为浅色主题", en: "Switch to light theme" },
  "header.darkMode": { zh: "切换为深色主题", en: "Switch to dark theme" },
  "header.openSettings": { zh: "Runtime 设置", en: "Runtime settings" },
  "header.toggleDetails": { zh: "打开任务详情", en: "Open details" },
  "header.closeDetails": { zh: "关闭任务详情", en: "Close details" },
  "header.shared": { zh: "共享中", en: "Shared" },
  "header.joined": { zh: "已加入", en: "Joined" },
  "header.clients": { zh: "个客户端", en: "clients" },
  // 命令面板
  "cmd.searchPlaceholder": {
    zh: "搜索任务或输入命令…",
    en: "Search tasks or commands…",
  },
  "cmd.noResults": { zh: "没有匹配的结果", en: "No matching results" },
  "cmd.close": { zh: "关闭命令面板", en: "Close command palette" },
  "cmd.groupTasks": { zh: "任务", en: "Tasks" },
  "cmd.groupActions": { zh: "动作", en: "Actions" },
  "cmd.newTask": { zh: "新建任务…", en: "New task…" },
  "cmd.stopTask": { zh: "停止当前任务", en: "Stop current task" },
  "cmd.compact": { zh: "压缩上下文", en: "Compact context" },
  "cmd.settings": { zh: "打开设置", en: "Open settings" },
  "cmd.theme": { zh: "切换主题", en: "Toggle theme" },
  "cmd.details": { zh: "切换状态面板", en: "Toggle details panel" },
  "cmd.localeZh": {
    zh: "切换语言（English）",
    en: "Switch language (English)",
  },
  "cmd.localeEn": { zh: "切换语言（中文）", en: "Switch language (中文)" },
  "cmd.current": { zh: "当前", en: "Current" },
  "cmd.untitled": { zh: "未命名任务", en: "Untitled task" },
  // 多任务通知条
  "waiting.notice": {
    zh: "{count} 个任务在等待你的回答",
    en: "{count} tasks waiting for you",
  },
  "waiting.go": { zh: "去看看", en: "Go" },
  "waiting.dismiss": { zh: "忽略等待通知", en: "Dismiss waiting notice" },
  // 新建任务对话框
  "create.title": { zh: "新建任务", en: "New task" },
  "create.searchProjects": { zh: "搜索项目…", en: "Search projects…" },
  "create.noProjects": {
    zh: "没有找到匹配的项目。",
    en: "No matching projects.",
  },
  "create.projectLabel": { zh: "选择工作目录", en: "Choose working directory" },
  "create.cwdPlaceholder": {
    zh: "输入工作目录路径…",
    en: "Enter a directory path…",
  },
  "create.titleLabel": { zh: "任务标题（可选）", en: "Task title (optional)" },
  "create.create": { zh: "创建", en: "Create" },
  "create.cancel": { zh: "取消", en: "Cancel" },
  // 设置各 Tab 高频
  "settings.save": { zh: "保存", en: "Save" },
  "settings.cancel": { zh: "取消", en: "Cancel" },
  "settings.delete": { zh: "删除", en: "Delete" },
  "settings.add": { zh: "添加", en: "Add" },
  "settings.remove": { zh: "移除", en: "Remove" },
  "settings.enable": { zh: "启用", en: "Enable" },
  "settings.disable": { zh: "禁用", en: "Disable" },
  "settings.connected": { zh: "已连接", en: "Connected" },
  "settings.disconnected": { zh: "未连接", en: "Disconnected" },
  "settings.connecting": { zh: "连接中…", en: "Connecting…" },
  "settings.error": { zh: "错误", en: "Error" },
  "settings.close": { zh: "关闭设置", en: "Close settings" },
  "settings.tabs": { zh: "设置分类", en: "Settings sections" },
  // 连接 Tab
  "conn.status.ready": { zh: "已就绪", en: "Ready" },
  "conn.status.starting": { zh: "启动中", en: "Starting" },
  "conn.status.stopping": { zh: "停止中", en: "Stopping" },
  "conn.status.unavailable": { zh: "不可用", en: "Unavailable" },
  "conn.runtimeState": { zh: "运行状态", en: "Runtime state" },
  "conn.currentModel": { zh: "当前模型", en: "Current model" },
  "conn.connections": { zh: "连接数", en: "Connections" },
  "conn.uptime": { zh: "运行时长", en: "Uptime" },
  "conn.reconnect": { zh: "重新连接", en: "Reconnect" },
  "conn.todayUsage": { zh: "今日用量", en: "Usage today" },
  "conn.requests": { zh: "请求", en: "Requests" },
  "conn.inputTokens": { zh: "输入 tokens", en: "Input tokens" },
  "conn.outputTokens": { zh: "输出 tokens", en: "Output tokens" },
  "conn.versionAdvanced": {
    zh: "版本信息（高级）",
    en: "Version info (advanced)",
  },
  "conn.protocol": { zh: "协议", en: "Protocol" },
  "conn.context": { zh: "上下文", en: "Context" },
  "conn.theme": { zh: "主题", en: "Theme" },
  "conn.theme.system": { zh: "跟随系统", en: "System" },
  "conn.theme.light": { zh: "浅色", en: "Light" },
  "conn.theme.dark": { zh: "深色", en: "Dark" },
  "conn.language": { zh: "语言", en: "Language" },
  "conn.language.zh": { zh: "中文", en: "Chinese" },
  "conn.language.en": { zh: "英文", en: "English" },
  "conn.quit": { zh: "退出应用", en: "Quit app" },
  "conn.quitHint": {
    zh: "关闭本机 Gateway。关掉浏览器标签不会停止后台进程。",
    en: "Stops the local gateway. Closing the browser tab does not quit the app.",
  },
  "conn.quitConfirm": {
    zh: "确定退出 Suna App？正在运行的任务将无法从界面继续查看。",
    en: "Quit Suna App? Running tasks will no longer be visible from this UI.",
  },
  "conn.quitFailed": { zh: "退出失败，请从任务管理器结束进程。", en: "Quit failed. Stop the process from Task Manager." },
  // MCP Tab
  "mcp.title": { zh: "外部工具", en: "External tools" },
  "mcp.loading": { zh: "加载中", en: "Loading" },
  "mcp.enabled": { zh: "已启用", en: "Enabled" },
  "mcp.failed": { zh: "失败", en: "Failed" },
  "mcp.disabled": { zh: "已禁用", en: "Disabled" },
  "mcp.toolCount": { zh: "{count} 个工具", en: "{count} tools" },
  "mcp.reload": { zh: "重载", en: "Reload" },
  "mcp.toggle": {
    zh: "启用外部工具 {name}",
    en: "Toggle external tool {name}",
  },
  // 记忆 Tab
  "memory.title": { zh: "记忆", en: "Memory" },
  "memory.clearAll": { zh: "清空全部", en: "Clear all" },
  "memory.delete": { zh: "删除", en: "Delete" },
  "memory.empty": { zh: "没有可用记忆。", en: "No memories yet." },
  "memory.clearConfirm": {
    zh: "清除所有记忆？此操作无法撤销。",
    en: "Clear all memories? This cannot be undone.",
  },
  "memory.deleteConfirm": { zh: "删除这条记忆？", en: "Delete this memory?" },
  "memory.item": {
    zh: "{kind} · 优先级 {priority}",
    en: "{kind} · priority {priority}",
  },
  // 模型 Tab
  "models.title": { zh: "模型列表", en: "Models" },
  "models.add": { zh: "添加模型", en: "Add model" },
  "models.protocol": { zh: "协议", en: "Protocol" },
  "models.modelName": { zh: "模型名", en: "Model name" },
  "models.endpointOptional": { zh: "（可选）", en: "(optional)" },
  "models.endpointKeep": {
    zh: "已设置，留空则不修改",
    en: "Set; leave empty to keep",
  },
  "models.strengths": {
    zh: "Strengths（逗号分隔，可选）",
    en: "Strengths (comma separated, optional)",
  },
  "models.subtaskFor": {
    zh: "Subtask For（逗号分隔，可选）",
    en: "Subtask For (comma separated, optional)",
  },
  "models.cancel": { zh: "取消", en: "Cancel" },
  "models.save": { zh: "保存", en: "Save" },
  "models.inUse": { zh: "使用中", en: "In use" },
  "models.setDefault": { zh: "设为默认", en: "Set default" },
  "models.edit": { zh: "编辑", en: "Edit" },
  "models.delete": { zh: "删除", en: "Delete" },
  "models.empty": {
    zh: "还没有模型。点击“添加模型”配置第一个。",
    en: 'No models yet. Click "Add model" to configure the first one.',
  },
  "models.error.required": {
    zh: "Provider 与模型名必填。",
    en: "Provider and model name are required.",
  },
  "models.error.endpoint": {
    zh: "Endpoint 必填。",
    en: "Endpoint is required.",
  },
  "models.error.save": { zh: "无法保存模型。", en: "Failed to save model." },
  "models.error.delete": {
    zh: "无法删除模型。",
    en: "Failed to delete model.",
  },
  "models.error.activate": {
    zh: "无法激活模型。",
    en: "Failed to activate model.",
  },
  "models.deleteConfirm": {
    zh: "删除模型 {name}？\n同时删除已保存的 API key。",
    en: "Delete model {name}?\nThis also deletes the saved API key.",
  },
  "models.deleteConfirmSimple": {
    zh: "删除模型 {name}？",
    en: "Delete model {name}?",
  },
  // 安全 Tab
  "security.title": { zh: "操作确认", en: "Approval mode" },
  "security.desc": {
    zh: "Suna 在执行修改操作前如何征得你的同意。",
    en: "How Suna asks for your consent before making changes.",
  },
  "security.current": { zh: "当前", en: "Current" },
  "security.workspace": { zh: "工作目录", en: "Workspace" },
  "security.workspaceDesc": {
    zh: "Suna 只能在此目录内执行操作，目录之外的操作会被拒绝。",
    en: "Suna only operates inside this directory; actions outside are rejected.",
  },
  "security.workspaceEmpty": { zh: "（未设置）", en: "(not set)" },
  "security.mode.readonly": { zh: "只读（仅查看）", en: "Read-only" },
  "security.mode.readonlyDesc": {
    zh: "禁止一切修改操作",
    en: "No modifications allowed",
  },
  "security.mode.ask": { zh: "每次确认", en: "Ask every time" },
  "security.mode.askDesc": {
    zh: "每次修改前都询问你",
    en: "Ask before every change",
  },
  "security.mode.auto": { zh: "自动放行", en: "Auto allow" },
  "security.mode.autoDesc": {
    zh: "不询问，直接执行",
    en: "Run without asking",
  },
  "security.mode.smart": { zh: "智能确认", en: "Smart approval" },
  "security.mode.smartDesc": {
    zh: "低风险自动执行，高风险询问（推荐）",
    en: "Auto-run low risk, ask for high risk (recommended)",
  },
  "security.error.save": {
    zh: "无法保存确认模式。",
    en: "Failed to save approval mode.",
  },
  // 技能 Tab
  "skills.title": { zh: "技能", en: "Skills" },
  "skills.project": { zh: "项目", en: "Project" },
  "skills.toggle": { zh: "启用技能 {name}", en: "Toggle skill {name}" },
  "run.requestFailed": { zh: "请求失败。", en: "Request failed." },
  "run.unavailableBadge": {
    zh: "{model}（不可用）",
    en: "{model} (unavailable)",
  },
  // 新建任务对话框
  "create.renameTitle": { zh: "重命名会话", en: "Rename session" },
  "create.renameDesc": {
    zh: "留空可恢复为未命名会话。",
    en: "Leave empty to revert to untitled.",
  },
  "create.sessionTitle": { zh: "会话标题", en: "Session title" },
  "create.createTask": { zh: "新建任务", en: "New task" },
  "create.desc": {
    zh: "选择项目目录，Suna 将在此目录内执行任务。",
    en: "Choose a project directory; Suna will work inside it.",
  },
  "create.error.required": {
    zh: "请选择或输入一个项目目录。",
    en: "Choose or enter a project directory.",
  },
  "create.error.failed": {
    zh: "无法创建会话。",
    en: "Failed to create session.",
  },
  "create.project": { zh: "项目", en: "Project" },
  "create.searchPlaceholder": {
    zh: "搜索或输入路径…",
    en: "Search or enter a path…",
  },
  "create.manualPath": { zh: "手动输入新路径…", en: "Enter a new path…" },
  "create.newPath": { zh: "新路径", en: "New path" },
  "create.titleOptional": { zh: "标题（可选）", en: "Title (optional)" },
  "create.titlePlaceholder": { zh: "新任务", en: "New task" },
  "create.creating": { zh: "正在创建…", en: "Creating…" },
  // 状态条
  "statusbar.observing": {
    zh: "正在观察运行中的会话",
    en: "Observing a running session",
  },
  "statusbar.otherClient": {
    zh: "会话正在其他客户端运行",
    en: "Session running in another client",
  },
  "statusbar.canTakeOver": {
    zh: "任务结束后可接管输入",
    en: "You can take over when it finishes",
  },
  "statusbar.viewOnly": {
    zh: "当前窗口仅可查看，任务由另一个客户端控制",
    en: "View-only; another client controls the task",
  },
  "statusbar.clients": { zh: "{count} 个客户端", en: "{count} clients" },
  "statusbar.close": { zh: "关闭", en: "Close" },
  // 连接失败面板
  "status.noRuntime.title": {
    zh: "未检测到 Suna Runtime",
    en: "Suna Runtime not detected",
  },
  "status.noRuntime.desc": {
    zh: "请确认已在本机安装并启动 Suna Runtime，然后重试连接。",
    en: "Install and start Suna Runtime on this machine, then retry.",
  },
  "status.noRuntime.hint": {
    zh: "在终端运行 suna serve --json 后，保持本地 Gateway 运行。",
    en: "Run suna serve --json in a terminal and keep the local Gateway running.",
  },
  "status.incompatible.title": {
    zh: "Runtime 响应不兼容",
    en: "Incompatible Runtime response",
  },
  "status.incompatible.desc": {
    zh: "本机 Runtime 返回了当前 Gateway 无法识别的响应。",
    en: "The Runtime returned a response this Gateway cannot understand.",
  },
  "status.incompatible.hint": {
    zh: "请检查 Suna App 和 Suna Runtime 是否使用兼容版本，然后重试。",
    en: "Check that Suna App and Runtime versions are compatible, then retry.",
  },
  "status.version.title": {
    zh: "Runtime 版本不兼容",
    en: "Incompatible Runtime version",
  },
  "status.version.desc": {
    zh: "已检测到 Suna Runtime，但它不支持所需的公开协议。",
    en: "Suna Runtime is present but does not support the required protocol.",
  },
  "status.version.hint": {
    zh: "请更新 Suna Runtime 后重试。",
    en: "Update Suna Runtime and retry.",
  },
  "status.code": { zh: "状态代码", en: "Status code" },
  "status.retry": { zh: "重新检测", en: "Retry" },
  "status.next": { zh: "下一步", en: "Next step" },
  "status.connecting": {
    zh: "正在连接你的工作空间",
    en: "Connecting to your workspace",
  },
  "status.detecting": {
    zh: "正在检测本机 Suna Runtime…",
    en: "Detecting local Suna Runtime…",
  },
  "status.needsAttention": {
    zh: "连接需要你的注意",
    en: "Connection needs your attention",
  },
  // 通用
  "common.close": { zh: "关闭", en: "Close" },
  "common.closeNotice": { zh: "关闭通知", en: "Dismiss notification" },
  "common.closeSidebar": { zh: "关闭会话列表", en: "Close session list" },
  "common.closeSettings": { zh: "关闭设置", en: "Close settings" },
  "common.mainNav": { zh: "主导航", en: "Main navigation" },
  // 操作反馈（sessionActions / runtimeEvents）
  "action.sessionCreated": { zh: "会话已创建", en: "Session created" },
  "action.createFailed": {
    zh: "无法创建会话。",
    en: "Failed to create session.",
  },
  "action.imagePlaceholder": { zh: "[图片]", en: "[image]" },
  "action.sessionSwitched": { zh: "会话已切换。", en: "Session switched." },
  "action.modelSwitched": {
    zh: "已切换模型：{model}",
    en: "Switched to model: {model}",
  },
  "action.titleUpdated": { zh: "会话标题已更新", en: "Session title updated" },
  "action.titleUpdateFailed": {
    zh: "无法更新会话标题。",
    en: "Failed to update session title.",
  },
  "action.detached": { zh: "已离开当前会话", en: "Left the current session" },
  "action.detachFailed": {
    zh: "无法分离会话。",
    en: "Failed to detach session.",
  },
  "action.deleteConfirm": {
    zh: "删除此会话？此操作无法撤销。",
    en: "Delete this session? This cannot be undone.",
  },
  "action.deleted": { zh: "会话已删除", en: "Session deleted" },
  "action.deleteFailed": {
    zh: "无法删除会话。",
    en: "Failed to delete session.",
  },
  "action.attachFailed": {
    zh: "无法附加会话。",
    en: "Failed to attach session.",
  },
  "action.connectFailed": {
    zh: "无法连接 Runtime。",
    en: "Failed to connect to Runtime.",
  },
};

export type Translate = (
  key: string,
  params?: Record<string, string | number>,
) => string;

/** 翻译实现：取当前 locale 文案，替换 {param} 占位符；缺失时回退中文。 */
function translate(
  locale: Locale,
  key: string,
  params?: Record<string, string | number>,
) {
  let text = DICT[key]?.[locale] ?? DICT[key]?.zh ?? key;
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}

const LocaleContext = createContext<{
  locale: Locale;
  t: Translate;
  changeLocale: (locale: Locale) => void;
}>({
  locale: "zh",
  t: (key) => key,
  changeLocale: () => undefined,
});

// 模块级当前语言：供非组件模块（sessionActions/runtimeEvents 等）做 toast/
// 错误文案翻译。由 LocaleProvider 同步维护，避免这些模块依赖 React context。
let currentLocale: Locale = "zh";

/** 非组件模块取当前语言（只读）。 */
export function getCurrentLocale(): Locale {
  return currentLocale;
}

/** 非组件模块用模块级语言翻译（与 useT 同一字典）。 */
export function t(
  key: string,
  params?: Record<string, string | number>,
): string {
  return translate(currentLocale, key, params);
}

/** 全局语言 Provider：应用壳包裹后，任意组件用 useT() 取翻译函数。 */
export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(detectLocale);
  useEffect(() => {
    document.documentElement.lang = locale;
    currentLocale = locale;
  }, [locale]);
  const changeLocale = useCallback((next: Locale) => {
    setLocale(next);
    saveLocale(next);
  }, []);
  const t = useMemo<Translate>(
    () => (key, params) => translate(locale, key, params),
    [locale],
  );
  return (
    <LocaleContext.Provider value={{ locale, t, changeLocale }}>
      {children}
    </LocaleContext.Provider>
  );
}

/** 组件内取翻译函数。 */
export function useT(): Translate {
  return useContext(LocaleContext).t;
}

/** 组件内取当前语言。 */
export function useLocale(): Locale {
  return useContext(LocaleContext).locale;
}

/** 组件内取语言切换函数。 */
export function useChangeLocale() {
  return useContext(LocaleContext).changeLocale;
}

/** 兼容旧调用：createTranslator(locale) 仍可用（含插值参数）。 */
export function createTranslator(locale: Locale): Translate {
  return (key, params) => translate(locale, key, params);
}

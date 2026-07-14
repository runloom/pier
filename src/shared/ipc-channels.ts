/**
 * Pier IPC channel 常量 — main ↔ renderer 跨进程通信的单 source of truth.
 *
 * 命名规范: `pier://<domain>:<action>`
 */
export const PIER = {
  // command router facade
  COMMAND_EXECUTE: "pier://command:execute",
  APP_QUIT_DECISION: "pier://app-quit:decision",
  // git watch (订阅/退订;事件本身经 PIER_BROADCAST.GIT_CHANGED 广播)
  GIT_WATCH_START: "pier://git:watch-start",
  GIT_WATCH_STOP: "pier://git:watch-stop",
  // file watch (订阅/退订;事件本身经 PIER_BROADCAST.FILE_CHANGED 广播)
  FILE_WATCH_START: "pier://file:watch-start",
  FILE_WATCH_STOP: "pier://file:watch-stop",
  FILE_PICK_SAVE_TARGET: "pier://file:pick-save-target",
  // window
  WINDOW_CLOSE_CURRENT: "pier://window:close-current",
  WINDOW_CONTEXT: "pier://window:context",
  WINDOW_RENDERER_BOOT_CHALLENGE: "pier://window:renderer-boot-challenge",
  WINDOW_RENDERER_BOOT_REQUEST: "pier://window:renderer-boot-request",
  WINDOW_RENDERER_READY: "pier://window:renderer-ready",
  // renderer → main plugin RPC invoke channel. Separate from PIER.COMMAND_EXECUTE
  // so plugin RPC is NEVER reachable from CLI local-control or capability-only
  // command authorization (design §7.0 / §7.3).
  PLUGIN_RPC_INVOKE: "pier://plugin-rpc:invoke",
  PLUGIN_RENDERER_ACTIVATION_REPORT: "pier://plugin:renderer-activation-report",
  ENVIRONMENT_PICK_PROJECT_DIRECTORY:
    "pier://environment:pick-project-directory",
  // 系统资源快照（renderer 拉取式轮询;指挥中心 system-resources 物料）
  SYSTEM_STATS_SNAPSHOT: "pier://system-stats:snapshot",
  // 跨插件 API 等价成本聚合快照的初值拉取（增量走 PIER_BROADCAST.USAGE_DATA_CHANGED）。
  USAGE_DATA_SNAPSHOT: "pier://usage-data:snapshot",
  // 触发所有注册源的 rescan + 广播；成本物料手动刷新入口。
  USAGE_DATA_REFRESH_ALL: "pier://usage-data:refresh-all",
} as const;

export const PIER_BROADCAST = {
  // main 端应用菜单请求 renderer 打开/关闭命令面板.
  COMMAND_PALETTE_TOGGLE_REQUEST: "pier://command-palette:toggle-request",
  // main 端应用菜单请求当前 workspace 新建 terminal panel.
  NEW_TERMINAL_REQUEST: "pier://panel:new-terminal-request",
  // main 端应用菜单 / 原生快捷键请求 renderer 打开设置.
  SETTINGS_OPEN_REQUEST: "pier://settings:open-request",
  // main 端应用菜单请求 renderer 打开当前终端搜索栏.
  TERMINAL_SEARCH_OPEN_REQUEST: "pier://terminal:search-open-request",
  // 偏好更新后广播完整快照给每个 renderer.
  PREFERENCES_CHANGED: "pier:preferences:changed",
  // 原生窗口几何变化后触发 renderer 补发 overlay / native view layout.
  WINDOW_LAYOUT_PULSE: "pier:window:layout-pulse",
  // 终端工作目录变更广播 (main → renderer).
  TERMINAL_CWD_CHANGED: "pier://terminal:cwd-changed",
  // 终端标题变更广播 (main → renderer).
  TERMINAL_TITLE_CHANGED: "pier://terminal:title-changed",
  // Ghostty 在已退出进程的 surface 上收到用户关闭确认。
  TERMINAL_SURFACE_CLOSE_REQUEST: "pier://terminal:surface-close-request",
  // 命令面板 MRU 变更广播 (main → renderer, payload MruState).
  COMMAND_PALETTE_MRU_CHANGED: "pier://command-palette-mru:changed",
  // git 变更广播 (main → renderer, payload GitChangeEvent).
  GIT_CHANGED: "pier://git:changed",
  // 文件系统变更广播 (main → renderer, payload FileWatchEvent).
  FILE_CHANGED: "pier://file:changed",
  // 插件 registry 变更广播 (main → renderer, payload PluginRegistryListResult).
  // main 在插件 setEnabled / registry refresh 后发送最新快照给所有窗口.
  PLUGINS_CHANGED: "pier://plugins:changed",
  // renderer 下发的 presentation 已被 native 同步应用 (main → renderer,
  // payload { rendererSequence })，用于 resize 撤占位的精确握手。
  TERMINAL_PRESENTATION_APPLIED: "pier:terminal:presentation-applied",
  // 终端状态栏用户覆盖变更后广播完整快照 (main → renderer, payload TerminalStatusBarPrefs).
  TERMINAL_STATUS_BAR_PREFS_CHANGED: "pier://terminal-status-bar:prefs-changed",
  // 全部 task run 的窗口级控制快照（运行控制浮层唯一数据源）。
  TASKS_RUNS_CHANGED: "pier://tasks:runs-changed",
  // 插件设置变更广播 (main → renderer, payload PluginSettingsChangedPayload).
  PLUGIN_SETTINGS_CHANGED: "pier://plugin-settings:changed",
  // 应用退出确认请求 (main → renderer, payload AppQuitConfirmationRequest).
  APP_QUIT_REQUESTED: "pier://app-quit:requested",
  // 主体更新状态变更广播 (main → renderer, payload AppUpdateSnapshot).
  APP_UPDATE_CHANGED: "pier://app-update:changed",
  // 前台面板活动统一广播 (main → 所有 renderer, payload ForegroundActivityBroadcast).
  // Unified aggregator: agent/task/shell/idle 四态归一, per-panel 唯一 activity。
  FOREGROUND_ACTIVITY_CHANGED: "pier://foreground-activity:changed",
  // main → renderer plugin event broadcast. Sent to all Pier windows;
  // renderer runtime filters by pluginId before dispatching to plugin
  // subscribers. Payload MUST NOT include secret material (design §7.3).
  PLUGIN_RPC_EVENT: "pier://plugin-rpc:event",
  // local environment 域变更广播 (main → 所有 renderer, payload LocalEnvironmentState).
  ENVIRONMENTS_CHANGED: "pier://environments:changed",
  // 工作树创建的真实后台阶段。payload 只含随机操作标识与阶段，
  // 不广播项目路径、分支名或脚本输出。
  WORKTREE_CREATE_PROGRESS: "pier://worktree-create:progress",
  // 跨插件成本聚合快照增量 (main → 所有 renderer, payload UsageAggregateSnapshot).
  USAGE_DATA_CHANGED: "pier://usage-data:changed",
} as const;

export type PierCommand = (typeof PIER)[keyof typeof PIER];

/** preload on() 订阅白名单 — 不在此列的通道不转发. */
export const ALLOWED_RENDERER_CHANNELS: readonly string[] = [
  ...Object.values(PIER_BROADCAST),
  // 非 broadcast 但 renderer 需订阅的通道
  "pier:terminal:request-context-menu",
  "pier:terminal:focus-request",
  "pier:terminal:search-state",
  "pier:keybinding:forward",
  "pier:keybinding:modifier-state",
  "pier:renderer-command",
  "pier:terminal-debug:collect-renderer-snapshot",
];

/**
 * Pier IPC channel 常量 — main ↔ renderer 跨进程通信的单 source of truth.
 *
 * 命名规范: `pier://<domain>:<action>`
 */
export const PIER = {
  // command router facade
  COMMAND_EXECUTE: "pier://command:execute",
  // git watch (订阅/退订;事件本身经 PIER_BROADCAST.GIT_CHANGED 广播)
  GIT_WATCH_START: "pier://git:watch-start",
  GIT_WATCH_STOP: "pier://git:watch-stop",
  // window
  WINDOW_CLOSE_CURRENT: "pier://window:close-current",
  WINDOW_CLOSE: "pier://window:close",
  WINDOW_CONTEXT: "pier://window:context",
  WINDOW_CREATE: "pier://window:create",
  WINDOW_FOCUS: "pier://window:focus",
  WINDOW_FULLSCREEN_STATE: "pier://window:fullscreen-state",
  WINDOW_LIST: "pier://window:list",
  WINDOW_RENDERER_READY: "pier://window:renderer-ready",
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
  // macOS 原生全屏进出 (main → renderer, payload { isFullscreen }).
  WINDOW_FULLSCREEN_CHANGED: "pier://window:fullscreen-changed",
  // git 变更广播 (main → renderer, payload GitChangeEvent).
  GIT_CHANGED: "pier://git:changed",
  // renderer 下发的 presentation 已被 native 同步应用 (main → renderer,
  // payload { rendererSequence })，用于 resize 撤占位的精确握手。
  TERMINAL_PRESENTATION_APPLIED: "pier:terminal:presentation-applied",
  // agent 会话状态全量快照广播 (main → 所有 renderer, payload AgentSessionsBroadcast).
  AGENT_SESSIONS_CHANGED: "pier://agent-session:changed",
} as const;

export type PierCommand = (typeof PIER)[keyof typeof PIER];

/** preload on() 订阅白名单 — 不在此列的通道不转发. */
export const ALLOWED_RENDERER_CHANNELS: readonly string[] =
  Object.values(PIER_BROADCAST);

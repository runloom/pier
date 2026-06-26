/**
 * Pier IPC channel 常量 — main ↔ renderer 跨进程通信的单 source of truth.
 *
 * 命名规范: `pier://<domain>:<action>`
 */
export const PIER = {
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
  // 偏好更新后广播完整快照给每个 renderer.
  PREFERENCES_CHANGED: "pier:preferences:changed",
  // 原生窗口几何变化后触发 renderer 补发 overlay / native view layout.
  WINDOW_LAYOUT_PULSE: "pier:window:layout-pulse",
  // macOS 原生全屏进出 (main → renderer, payload { isFullscreen }).
  WINDOW_FULLSCREEN_CHANGED: "pier://window:fullscreen-changed",
} as const;

export type PierCommand = (typeof PIER)[keyof typeof PIER];

/** preload on() 订阅白名单 — 不在此列的通道不转发. */
export const ALLOWED_RENDERER_CHANNELS: readonly string[] =
  Object.values(PIER_BROADCAST);

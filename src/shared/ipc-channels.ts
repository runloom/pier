/**
 * Pier IPC channel 常量 — main ↔ renderer 跨进程通信的单 source of truth.
 *
 * 命名规范: `pier://<domain>:<action>`
 */
export const PIER = {
  WINDOW_FULLSCREEN_STATE: "pier://window:fullscreen-state",
} as const;

export const PIER_BROADCAST = {
  // macOS 原生全屏进出 (main → renderer, payload { isFullscreen }).
  WINDOW_FULLSCREEN_CHANGED: "pier://window:fullscreen-changed",
} as const;

export type PierCommand = (typeof PIER)[keyof typeof PIER];

/** preload on() 订阅白名单 — 不在此列的通道不转发. */
export const ALLOWED_RENDERER_CHANNELS: readonly string[] =
  Object.values(PIER_BROADCAST);

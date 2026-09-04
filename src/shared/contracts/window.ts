import { z } from "zod";

export type WindowOpenMode = "fresh" | "restore";

export interface WindowCreateOptions {
  mode?: "fresh";
}

export interface WindowCreateResult {
  recordId: string;
  windowId: string;
}

export interface WindowContext {
  /**
   * Electron BrowserWindow.id 字符串。
   * 与 ForegroundActivity / Agent Runtime Index 的 windowId 词汇对齐；
   * 可选仅为兼容旧测试 mock，生产创建窗口时必填。
   */
  electronWindowId?: string;
  /**
   * OS-level key-window focus for this BrowserWindow / BaseWindow.
   * Enriched at WINDOW_CONTEXT IPC time via `win.isFocused()` — not stored on
   * the identity record. Distinct from DOM `document.hasFocus()` (false while
   * native terminal is firstResponder).
   */
  focused?: boolean;
  mode: WindowOpenMode;
  recordId: string;
  /**
   * Main-written, renderer-read startup intent.
   * Used when a window is created to host an in-flight panel transfer target.
   * Not exposed via WindowCreateOptions / command / CLI.
   */
  startup?: { kind: "panel-transfer"; transferId: string };
  windowId: string;
}

/** Main → owning renderer: BrowserWindow/BaseWindow key-window focus changed. */
export interface WindowFocusChangedPayload {
  focused: boolean;
}

export const windowCommandSchemas = [
  z.object({ type: z.literal("window.list") }),
  z.object({ type: z.literal("window.create") }),
  z.object({
    type: z.literal("window.focus"),
    windowId: z.string().min(1),
  }),
  z.object({
    type: z.literal("window.close"),
    windowId: z.string().min(1),
  }),
  z.object({
    type: z.literal("window.reportDisplayDraft"),
    baseLabel: z.string().min(1).optional(),
    branch: z.string().min(1).optional(),
    projectPath: z.string().min(1).optional(),
    stableTabQualifier: z.string().min(1).optional(),
  }),
] as const;

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

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
  windowId: string;
}

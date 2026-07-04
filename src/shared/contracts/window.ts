export type WindowOpenMode = "fresh" | "restore";

export interface WindowCreateOptions {
  mode?: "fresh";
}

export interface WindowCreateResult {
  recordId: string;
  windowId: string;
}

export interface WindowContext {
  mode: WindowOpenMode;
  recordId: string;
  windowId: string;
}

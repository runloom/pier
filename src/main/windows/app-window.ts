import type { BaseWindow, WebContents, WebContentsView } from "electron";

export interface AppWindow {
  readonly appView: WebContentsView | null;
  close(): void;
  destroy(): void;
  focus(): void;
  getNativeWindowHandle(): Buffer;
  readonly host: BaseWindow;
  readonly id: number;
  isDestroyed(): boolean;
  isFocused(): boolean;
  isMinimized(): boolean;
  moveTop(): void;
  restore(): void;
  setBackgroundColor(color: string): void;
  readonly webContents: WebContents;
}

export function createAppWindow(
  host: BaseWindow,
  webContents: WebContents,
  appView: WebContentsView | null
): AppWindow {
  return {
    appView,
    close: () => host.close(),
    destroy: () => host.destroy(),
    focus: () => host.focus(),
    get host() {
      return host;
    },
    get id() {
      return host.id;
    },
    getNativeWindowHandle: () => host.getNativeWindowHandle(),
    isDestroyed: () => host.isDestroyed(),
    isFocused: () => host.isFocused(),
    isMinimized: () => host.isMinimized(),
    moveTop: () => host.moveTop(),
    restore: () => host.restore(),
    setBackgroundColor: (color) => host.setBackgroundColor(color),
    webContents,
  };
}

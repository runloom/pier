import type { WindowInfo } from "@shared/contracts/events.ts";
import { windowManager } from "../windows/window-manager.ts";

export interface WindowService {
  close(windowId: string): void;
  create(): { windowId: string };
  focus(windowId: string): void;
  list(): WindowInfo[];
}

export function createWindowService(): WindowService {
  return {
    close: (windowId) => windowManager.close(windowId),
    create: () => ({ windowId: windowManager.create() }),
    focus: (windowId) => windowManager.focus(windowId),
    list: () => windowManager.list(),
  };
}

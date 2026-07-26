import type { PanelSnapshot } from "@shared/contracts/panel.ts";
import { invokePierCommand } from "./ipc-envelope.ts";

export interface PierPanelsListSnapshot {
  errors: Array<{
    code?: string;
    message: string;
    recordId?: string;
    windowId?: string;
  }>;
  panels: PanelSnapshot[];
}

export interface PierPanelsAPI {
  /**
   * Focus a panel. With windowId, focuses that window first (main default for
   * panel.focus). Without windowId, main resolves a unique panel id globally.
   */
  focus: (
    panelId: string,
    options?: { focus?: boolean; windowId?: string }
  ) => Promise<void>;
  /**
   * List panels. Omit windowId for all windows (`{ errors, panels }`).
   * With windowId, returns that window's panel array only.
   */
  list: (
    windowId?: string
  ) => Promise<PierPanelsListSnapshot | PanelSnapshot[]>;
}

export const panelsApi: PierPanelsAPI = {
  focus: (panelId, options) =>
    invokePierCommand<void>({
      panelId,
      type: "panel.focus",
      ...(options?.focus === undefined ? {} : { focus: options.focus }),
      ...(options?.windowId ? { windowId: options.windowId } : {}),
    }),
  list: (windowId) =>
    invokePierCommand<PierPanelsListSnapshot | PanelSnapshot[]>({
      type: "panel.list",
      ...(windowId ? { windowId } : {}),
    }),
};

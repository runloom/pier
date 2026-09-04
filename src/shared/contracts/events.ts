import type { PanelContext, PanelSnapshot } from "./panel.ts";
import type { PierClientKind } from "./permissions.ts";
import type { ProjectPreferences } from "./preferences.ts";
import type { ProjectSkillsInvalidatedEvent } from "./project-skills.ts";

export type { PanelSnapshot } from "./panel.ts";

export interface WindowInfo {
  /**
   * Electron `BrowserWindow.id` 字符串（与 `PIER_WINDOW_ID` / hook 同词汇）。
   * 命令路由同时认 `id`、本字段和 `recordId`。
   */
  electronWindowId?: string | undefined;
  focused: boolean;
  id: string;
  lastFocusedAt?: number | undefined;
  recordId: string;
  /** OS / menu single-line name. Omitted until first compute. */
  title?: string | undefined;
}

export type PreferenceChangedKey = keyof ProjectPreferences;

export type PierEvent =
  | {
      changedKeys: readonly PreferenceChangedKey[];
      snapshot: ProjectPreferences;
      type: "preferences.changed";
    }
  | { type: "window.changed"; windows: WindowInfo[] }
  | { panels: PanelSnapshot[]; type: "panel.changed" }
  | { context: PanelContext; panelId: string; type: "terminal.cwd.changed" }
  | { panelId: string; title: string; type: "terminal.title.changed" }
  | { clientId: string; kind: PierClientKind; type: "client.connected" }
  | { clientId: string; type: "client.disconnected" }
  | ProjectSkillsInvalidatedEvent;

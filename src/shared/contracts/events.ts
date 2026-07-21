import type { PanelContext, PanelSnapshot } from "./panel.ts";
import type { PierClientKind } from "./permissions.ts";
import type { ProjectPreferences } from "./preferences.ts";
import type { ProjectSkillsInvalidatedEvent } from "./project-skills.ts";

export type { PanelSnapshot } from "./panel.ts";

export interface WindowInfo {
  focused: boolean;
  id: string;
  lastFocusedAt?: number | undefined;
  recordId: string;
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

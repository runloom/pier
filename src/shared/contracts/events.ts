import type { PierClientKind } from "./permissions.ts";
import type { ProjectPreferences } from "./preferences.ts";

export interface WindowInfo {
  focused: boolean;
  id: string;
  recordId: string;
}

export interface PanelSnapshot {
  active?: boolean;
  id: string;
  kind: "terminal" | "web";
  title?: string;
  windowId?: string;
}

export type PierEvent =
  | { snapshot: ProjectPreferences; type: "preferences.changed" }
  | { type: "window.changed"; windows: WindowInfo[] }
  | { panels: PanelSnapshot[]; type: "panel.changed" }
  | { cwd: string; panelId: string; type: "terminal.cwd.changed" }
  | { panelId: string; title: string; type: "terminal.title.changed" }
  | { clientId: string; kind: PierClientKind; type: "client.connected" }
  | { clientId: string; type: "client.disconnected" };

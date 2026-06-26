import type { PierClientKind } from "./permissions.ts";
import type { ProjectPreferences } from "./preferences.ts";

export interface WindowInfo {
  focused: boolean;
  id: string;
  lastFocusedAt?: number | undefined;
  recordId: string;
}

export interface PanelSnapshot {
  active?: boolean;
  cwd?: string;
  groupIndex?: number;
  id: string;
  kind: "terminal" | "web";
  tabCount?: number;
  tabIndex?: number;
  terminalTitle?: string;
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

/**
 * Agent-readable public contract for `pier/host`.
 *
 * Runtime lives on `globalThis.__PIER_LIVE_HOST__` via the compile stub.
 * Do not import this module from `pier/canvas` — `host` is an object
 * (`host.invoke`), not a function stub.
 *
 * This file is the canvas-allowed surface (same as the canvas-kit
 * API tab and `host.inspect()`). Writes, window close, and chrome
 * broadcasts are not listed. Sibling writes stay `useCanvasFile` from
 * `pier/canvas`. Never use `window.pier`.
 *
 * The kit API tab is a capability catalog (`useCanvasFile` plus host
 * domains). Command payload fields and `optional` come from renderer
 * `host.inspect().domains` (`pier/host`). Shared/preload inspect leaves
 * `fields` empty. `domain.exemplar` is the docs command for that domain.
 */
export type CanvasHostCommandType =
  | "app.snapshot"
  | "app.status"
  | "environment.snapshot"
  | "environment.worktreeBinding"
  | "file.drafts.get"
  | "file.drafts.listDiagnostics"
  | "file.drafts.listKeys"
  | "file.exists"
  | "file.inspectPathImpact"
  | "file.list"
  | "file.readDocument"
  | "file.readText"
  | "file.stat"
  | "git.getDiffPatch"
  | "git.getStatus"
  | "git.listBranches"
  | "git.listIgnored"
  | "git.searchBranches"
  | "git.searchCommits"
  | "git.stashList"
  | "notifications.get"
  | "notifications.list"
  | "panel.list"
  | "plugin.inspect"
  | "plugin.list"
  | "pluginSettings.getAll"
  | "preferences.read"
  | "run.backgroundSnapshot"
  | "run.list"
  | "run.output"
  | "run.recent"
  | "run.runsSnapshot"
  | "run.status"
  | "shellEnvironment.status"
  | "terminal.get"
  | "terminal.list"
  | "terminal.profile.list"
  | "terminal.profile.read"
  | "terminalStatusBar.prefs.getAll"
  | "window.list"
  | "workspace.layout.read"
  | "worktree.check"
  | "worktree.creationDefaults"
  | "worktree.get"
  | "worktree.list";

export interface CanvasHostCommand {
  type: CanvasHostCommandType;
  [field: string]: unknown;
}

export type CanvasHostSnapshotId =
  | "foreground-activity"
  | "resources"
  | "usage-data";

export type CanvasHostChannel =
  | "pier://environments:changed"
  | "pier://file:changed"
  | "pier://foreground-activity:changed"
  | "pier://git:changed"
  | "pier://notification-center:changed"
  | "pier://plugin-settings:changed"
  | "pier://plugins:changed"
  | "pier:preferences:changed"
  | "pier://tasks:runs-changed"
  | "pier://terminal-status-bar:prefs-changed"
  | "pier://usage-data:changed";

export type CanvasHostWatchTarget = CanvasHostChannel | CanvasHostSnapshotId;

export interface CanvasHostInspectField {
  name: string;
  optional: boolean;
  type: string;
}

export interface CanvasHostInspectCommand {
  fields: readonly CanvasHostInspectField[];
  type: CanvasHostCommandType;
}

export interface CanvasHostInspectDomain {
  channels: readonly CanvasHostChannel[];
  commands: readonly CanvasHostInspectCommand[];
  exemplar: CanvasHostCommandType | null;
  id: string;
  snapshots: readonly CanvasHostSnapshotId[];
}

export interface CanvasHostInspect {
  channels: readonly CanvasHostChannel[];
  commands: readonly CanvasHostCommandType[];
  domains: readonly CanvasHostInspectDomain[];
  snapshots: readonly CanvasHostSnapshotId[];
}

export interface CanvasHost {
  inspect(): CanvasHostInspect;
  invoke(command: CanvasHostCommand): Promise<unknown>;
  snapshot(id: CanvasHostSnapshotId): Promise<unknown>;
  subscribe(
    channel: CanvasHostChannel,
    listener: (payload: unknown) => void
  ): () => void;
}

export interface HostSnapshotState {
  data: unknown;
  error: string | null;
  status: "error" | "loading" | "ready";
}

export declare const host: CanvasHost;
export declare function useHostSnapshot(
  target: CanvasHostWatchTarget
): HostSnapshotState;

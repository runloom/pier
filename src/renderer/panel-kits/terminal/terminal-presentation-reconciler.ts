import type {
  TerminalFrame,
  TerminalPresentationReason,
  TerminalPresentationSnapshot,
} from "@shared/contracts/terminal.ts";
import { readRegisteredTerminalAnchorFrame } from "./terminal-layout-coordinator.ts";

export interface TerminalPresentationPanelState {
  component: string;
  dockviewActive: boolean;
  dockviewVisible: boolean;
  id: string;
}

export interface TerminalPresentationWorkspaceState {
  activePanelId: string | null;
  activeTerminalPanelId: string | null;
  hasMaximizedGroup: boolean;
  panels: TerminalPresentationPanelState[];
}

export interface BuildTerminalPresentationSnapshotArgs {
  readFrame(panelId: string): TerminalFrame | null;
  reason: TerminalPresentationReason;
  rendererSequence: number;
  workspace: TerminalPresentationWorkspaceState;
}

let workspaceState: TerminalPresentationWorkspaceState | null = null;
let rendererSequence = 0;
let pendingFrameRequest: number | null = null;
let pendingReason: TerminalPresentationReason = "dockview-layout";
let lastDesiredSnapshot: TerminalPresentationSnapshot | null = null;

function requestFrame(cb: FrameRequestCallback): number {
  if (typeof requestAnimationFrame === "function") {
    return requestAnimationFrame(cb);
  }
  return window.setTimeout(() => cb(performance.now()), 0);
}

function cancelFrame(id: number): void {
  if (typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(id);
    return;
  }
  window.clearTimeout(id);
}

function isTerminalPanel(panel: TerminalPresentationPanelState): boolean {
  return panel.component === "terminal";
}

export function buildTerminalPresentationSnapshot({
  readFrame,
  reason,
  rendererSequence: nextRendererSequence,
  workspace,
}: BuildTerminalPresentationSnapshotArgs): TerminalPresentationSnapshot {
  const terminals = workspace.panels.filter(isTerminalPanel).map((panel) => {
    const frame = readFrame(panel.id);
    const isActivePanel =
      workspace.activePanelId === panel.id || panel.dockviewActive;
    const visible =
      frame !== null &&
      (workspace.hasMaximizedGroup
        ? workspace.activeTerminalPanelId === panel.id && isActivePanel
        : panel.dockviewVisible || frame !== null);
    return {
      focused: false,
      frame,
      panelId: panel.id,
      visible,
    };
  });

  return {
    activePanelId: workspace.activePanelId,
    activeTerminalPanelId: workspace.activeTerminalPanelId,
    hasMaximizedGroup: workspace.hasMaximizedGroup,
    reason,
    rendererSequence: nextRendererSequence,
    terminals,
  };
}

export function getLastTerminalPresentationSnapshot(): TerminalPresentationSnapshot | null {
  return lastDesiredSnapshot;
}

export function updateTerminalPresentationWorkspace(
  nextWorkspaceState: TerminalPresentationWorkspaceState,
  reason: TerminalPresentationReason
): void {
  workspaceState = nextWorkspaceState;
  requestTerminalPresentation(reason);
}

export function requestTerminalPresentation(
  reason: TerminalPresentationReason
): void {
  pendingReason = reason;
  if (!workspaceState) {
    return;
  }
  if (pendingFrameRequest !== null) {
    return;
  }
  let didRunSynchronously = false;
  let nextFrameRequest = 0;
  nextFrameRequest = requestFrame(() => {
    didRunSynchronously = true;
    pendingFrameRequest = null;
    applyTerminalPresentationNow(pendingReason);
  });
  if (!didRunSynchronously) {
    pendingFrameRequest = nextFrameRequest;
  }
}

export function applyTerminalPresentationNow(
  reason: TerminalPresentationReason
): TerminalPresentationSnapshot | null {
  if (!workspaceState) {
    return null;
  }
  rendererSequence += 1;
  const snapshot = buildTerminalPresentationSnapshot({
    readFrame: readRegisteredTerminalAnchorFrame,
    reason,
    rendererSequence,
    workspace: workspaceState,
  });
  lastDesiredSnapshot = snapshot;
  window.pier?.terminal?.applyPresentation?.(snapshot);
  return snapshot;
}

export function resetTerminalPresentationReconcilerForTests(): void {
  if (pendingFrameRequest !== null) {
    cancelFrame(pendingFrameRequest);
  }
  workspaceState = null;
  rendererSequence = 0;
  pendingFrameRequest = null;
  pendingReason = "dockview-layout";
  lastDesiredSnapshot = null;
}

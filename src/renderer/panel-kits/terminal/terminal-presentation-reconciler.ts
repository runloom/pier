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
  activePanelKind: "terminal" | "web";
  hasMaximizedGroup: boolean;
  panels: TerminalPresentationPanelState[];
}

export interface BuildTerminalPresentationSnapshotArgs {
  overlayActive: boolean;
  readFrame(panelId: string): TerminalFrame | null;
  reason: TerminalPresentationReason;
  rendererSequence: number;
  workspace: TerminalPresentationWorkspaceState;
}

let workspaceState: TerminalPresentationWorkspaceState | null = null;
let overlayActive = false;
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
  overlayActive: snapshotOverlayActive,
  readFrame,
  reason,
  rendererSequence: nextRendererSequence,
  workspace,
}: BuildTerminalPresentationSnapshotArgs): TerminalPresentationSnapshot {
  let focusedPanelId: string | null = null;
  const terminals = workspace.panels.filter(isTerminalPanel).map((panel) => {
    const frame = readFrame(panel.id);
    const isActivePanel =
      workspace.activePanelId === panel.id || panel.dockviewActive;
    const visible =
      frame !== null &&
      (workspace.hasMaximizedGroup
        ? workspace.activePanelKind === "terminal" && isActivePanel
        : panel.dockviewVisible || frame !== null);
    const focused =
      visible &&
      focusedPanelId === null &&
      !snapshotOverlayActive &&
      workspace.activePanelKind === "terminal" &&
      workspace.activePanelId === panel.id;
    if (focused) {
      focusedPanelId = panel.id;
    }
    return {
      focused,
      frame,
      panelId: panel.id,
      visible,
    };
  });

  return {
    activePanelId: workspace.activePanelId,
    activePanelKind: workspace.activePanelKind,
    hasMaximizedGroup: workspace.hasMaximizedGroup,
    overlayActive: snapshotOverlayActive,
    reason,
    rendererSequence: nextRendererSequence,
    terminals,
  };
}

export function getLastTerminalPresentationSnapshot(): TerminalPresentationSnapshot | null {
  return lastDesiredSnapshot;
}

export function setTerminalPresentationOverlayActive(active: boolean): void {
  if (overlayActive === active) {
    return;
  }
  overlayActive = active;
  requestTerminalPresentation("overlay");
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
    overlayActive,
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
  overlayActive = false;
  rendererSequence = 0;
  pendingFrameRequest = null;
  pendingReason = "dockview-layout";
  lastDesiredSnapshot = null;
}

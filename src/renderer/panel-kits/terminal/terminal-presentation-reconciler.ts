import type {
  TerminalFrame,
  TerminalHostSnapshot,
  TerminalPresentationReason,
} from "@shared/contracts/terminal.ts";
import {
  resetTerminalHostStateForTests,
  updateTerminalHostPresentationFacts,
} from "@/lib/workspace/terminal-host-state-reconciler.ts";
import { useTerminalStore } from "@/stores/terminal.store.ts";
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

export type TerminalPresentationFacts = Omit<
  TerminalHostSnapshot,
  | "basePanel"
  | "focusDisabledPanelIds"
  | "rendererSequence"
  | "webOverlayRects"
  | "webRequestCount"
>;

export interface BuildTerminalPresentationFactsArgs {
  readFrame(panelId: string): TerminalFrame | null;
  reason: TerminalPresentationReason;
  /**
   * resize 期间为 true：强制所有终端 visible=false，让 native 终端隐身，
   * 由 web 侧占位顶替，做到终端与 web UI 几何零错位。
   */
  suppressVisible?: boolean;
  workspace: TerminalPresentationWorkspaceState;
}

let workspaceState: TerminalPresentationWorkspaceState | null = null;
let pendingFrameRequest: number | null = null;
let pendingReason: TerminalPresentationReason = "dockview-layout";

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

export function buildTerminalPresentationFacts({
  readFrame,
  reason,
  suppressVisible = false,
  workspace,
}: BuildTerminalPresentationFactsArgs): TerminalPresentationFacts {
  const terminals = workspace.panels.filter(isTerminalPanel).map((panel) => {
    // resize 隐身：终端 visible=false 且不下发 frame。frame=null 让 native
    // atomic window state 跳过 applyHostFrame（否则会先摆到可见位 + 同步 Metal 重渲染
    // 再移走，每帧抖动）；visible=false 是明确意图。两者一致表达隐身，单独成支以免混淆。
    if (suppressVisible) {
      return { frame: null, panelId: panel.id, visible: false };
    }
    const frame = readFrame(panel.id);
    const isActivePanel =
      workspace.activePanelId === panel.id || panel.dockviewActive;
    const dockviewVisible = panel.dockviewVisible || isActivePanel;
    const visible =
      frame !== null &&
      (workspace.hasMaximizedGroup
        ? workspace.activeTerminalPanelId === panel.id && isActivePanel
        : dockviewVisible);
    return {
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
    terminals,
  };
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
): TerminalHostSnapshot | null {
  if (!workspaceState) {
    return null;
  }
  const snapshot = buildTerminalPresentationFacts({
    readFrame: readRegisteredTerminalAnchorFrame,
    reason,
    suppressVisible: useTerminalStore.getState().suppressTerminals,
    workspace: workspaceState,
  });
  const hostSnapshot = updateTerminalHostPresentationFacts(snapshot);
  useTerminalStore.setState({
    lastDownlinkSequence: hostSnapshot.rendererSequence,
  });
  return hostSnapshot;
}

export function resetTerminalPresentationReconcilerForTests(): void {
  if (pendingFrameRequest !== null) {
    cancelFrame(pendingFrameRequest);
  }
  workspaceState = null;
  pendingFrameRequest = null;
  pendingReason = "dockview-layout";
  resetTerminalHostStateForTests();
}

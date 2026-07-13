import type {
  TerminalHostReason,
  TerminalHostSnapshot,
  TerminalKeyboardFocusTarget,
  TerminalWebOverlayRect,
} from "@shared/contracts/terminal.ts";

export interface TerminalHostInputFacts {
  basePanel: TerminalKeyboardFocusTarget;
  webOverlayRects: TerminalWebOverlayRect[];
  webRequestCount: number;
}

type TerminalHostPresentationFacts = Omit<
  TerminalHostSnapshot,
  "basePanel" | "rendererSequence" | "webOverlayRects" | "webRequestCount"
>;

let inputFacts: TerminalHostInputFacts | null = null;
let presentationFacts: TerminalHostPresentationFacts | null = null;
let rendererSequence = 0;
let lastSnapshot: TerminalHostSnapshot | null = null;

function publish(
  nextInputFacts: TerminalHostInputFacts,
  nextPresentationFacts: TerminalHostPresentationFacts,
  reason: TerminalHostReason
): TerminalHostSnapshot {
  const basePanel = nextInputFacts.basePanel;
  let activePanelId = nextPresentationFacts.activePanelId;
  let activeTerminalPanelId = nextPresentationFacts.activeTerminalPanelId;
  let terminals = nextPresentationFacts.terminals;

  if (basePanel.kind === "terminal") {
    activePanelId = basePanel.panelId;
    activeTerminalPanelId = basePanel.panelId;
    if (!terminals.some((entry) => entry.panelId === basePanel.panelId)) {
      terminals = [
        ...terminals,
        { frame: null, panelId: basePanel.panelId, visible: false },
      ];
    }
  } else {
    activeTerminalPanelId = null;
  }

  rendererSequence += 1;
  const snapshot: TerminalHostSnapshot = {
    activePanelId,
    activeTerminalPanelId,
    basePanel,
    hasMaximizedGroup: nextPresentationFacts.hasMaximizedGroup,
    reason,
    rendererSequence,
    terminals,
    webOverlayRects: nextInputFacts.webOverlayRects,
    webRequestCount: nextInputFacts.webRequestCount,
  };
  lastSnapshot = snapshot;
  window.pier?.terminal?.applyHostSnapshot?.(snapshot);
  return snapshot;
}

export function updateTerminalHostInputFacts(
  facts: TerminalHostInputFacts,
  reason: TerminalHostReason
): TerminalHostSnapshot {
  inputFacts = facts;
  const fallbackPresentation: TerminalHostPresentationFacts = {
    activePanelId:
      facts.basePanel.kind === "terminal" ? facts.basePanel.panelId : null,
    activeTerminalPanelId:
      facts.basePanel.kind === "terminal" ? facts.basePanel.panelId : null,
    hasMaximizedGroup: false,
    reason,
    terminals:
      facts.basePanel.kind === "terminal"
        ? [{ frame: null, panelId: facts.basePanel.panelId, visible: false }]
        : [],
  };
  return publish(facts, presentationFacts ?? fallbackPresentation, reason);
}

export function updateTerminalHostPresentationFacts(
  facts: TerminalHostPresentationFacts
): TerminalHostSnapshot {
  presentationFacts = facts;
  const fallbackInput: TerminalHostInputFacts = {
    basePanel: facts.activeTerminalPanelId
      ? { kind: "terminal", panelId: facts.activeTerminalPanelId }
      : { kind: "web" },
    webOverlayRects: [],
    webRequestCount: 0,
  };
  return publish(inputFacts ?? fallbackInput, facts, facts.reason);
}

export function getLastTerminalHostSnapshot(): TerminalHostSnapshot | null {
  return lastSnapshot;
}

export function resetTerminalHostStateForTests(): void {
  inputFacts = null;
  presentationFacts = null;
  rendererSequence = 0;
  lastSnapshot = null;
}

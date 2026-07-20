import type {
  TerminalFrame,
  TerminalHostReason,
  TerminalHostSnapshot,
  TerminalKeyboardFocusTarget,
  TerminalWebOverlayRect,
} from "@shared/contracts/terminal.ts";

const MAX_COORDINATE = 100_000;
const MAX_ID_LENGTH = 256;
const MAX_OVERLAY_RECTS = 64;
const MAX_TERMINALS = 256;

const HOST_REASONS: Record<TerminalHostReason, true> = {
  "anchor-resize": true,
  "dockview-active-panel": true,
  "dockview-dimensions": true,
  "dockview-layout": true,
  "dockview-maximize": true,
  "input-routing": true,
  restore: true,
  "surface-closing": true,
  "surface-created": true,
  visibility: true,
  "window-blur": true,
  "window-focus": true,
  "window-resize": true,
  "window-view-zoom": true,
  "window-zoom": true,
};

function isPanelId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH
  );
}

function isNullablePanelId(value: unknown): value is string | null {
  return value === null || isPanelId(value);
}

function isFiniteFrame(value: unknown): value is TerminalFrame {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const frame = value as Record<string, unknown>;
  return (
    typeof frame.x === "number" &&
    Number.isFinite(frame.x) &&
    Math.abs(frame.x) <= MAX_COORDINATE &&
    typeof frame.y === "number" &&
    Number.isFinite(frame.y) &&
    Math.abs(frame.y) <= MAX_COORDINATE &&
    typeof frame.width === "number" &&
    Number.isFinite(frame.width) &&
    frame.width >= 0 &&
    frame.width <= MAX_COORDINATE &&
    typeof frame.height === "number" &&
    Number.isFinite(frame.height) &&
    frame.height >= 0 &&
    frame.height <= MAX_COORDINATE
  );
}

function isKeyboardTarget(
  value: unknown
): value is TerminalKeyboardFocusTarget {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const target = value as Record<string, unknown>;
  return (
    target.kind === "web" ||
    (target.kind === "terminal" && isPanelId(target.panelId))
  );
}

function isOverlayRect(value: unknown): value is TerminalWebOverlayRect {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const rect = value as Record<string, unknown>;
  return isPanelId(rect.id) && isFiniteFrame(rect.frame);
}

export function isTerminalHostSnapshot(
  value: unknown
): value is TerminalHostSnapshot {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const snapshot = value as Record<string, unknown>;
  if (
    !(
      isNullablePanelId(snapshot.activePanelId) &&
      isNullablePanelId(snapshot.activeTerminalPanelId) &&
      isKeyboardTarget(snapshot.basePanel)
    ) ||
    typeof snapshot.hasMaximizedGroup !== "boolean" ||
    typeof snapshot.reason !== "string" ||
    HOST_REASONS[snapshot.reason as TerminalHostReason] !== true ||
    typeof snapshot.rendererSequence !== "number" ||
    !Number.isInteger(snapshot.rendererSequence) ||
    snapshot.rendererSequence < 0 ||
    !Array.isArray(snapshot.terminals) ||
    snapshot.terminals.length > MAX_TERMINALS ||
    !Array.isArray(snapshot.focusDisabledPanelIds) ||
    snapshot.focusDisabledPanelIds.length > MAX_TERMINALS ||
    !Array.isArray(snapshot.webOverlayRects) ||
    snapshot.webOverlayRects.length > MAX_OVERLAY_RECTS ||
    typeof snapshot.webRequestCount !== "number" ||
    !Number.isInteger(snapshot.webRequestCount) ||
    snapshot.webRequestCount < 0
  ) {
    return false;
  }

  const terminalIds = new Set<string>();
  for (const valueEntry of snapshot.terminals) {
    if (valueEntry === null || typeof valueEntry !== "object") {
      return false;
    }
    const entry = valueEntry as Record<string, unknown>;
    if (
      !isPanelId(entry.panelId) ||
      terminalIds.has(entry.panelId) ||
      typeof entry.visible !== "boolean" ||
      (entry.frame !== null && !isFiniteFrame(entry.frame))
    ) {
      return false;
    }
    terminalIds.add(entry.panelId);
  }

  const overlayIds = new Set<string>();
  for (const rect of snapshot.webOverlayRects) {
    if (!isOverlayRect(rect) || overlayIds.has(rect.id)) {
      return false;
    }
    overlayIds.add(rect.id);
  }

  const focusDisabledIds = new Set<string>();
  for (const panelId of snapshot.focusDisabledPanelIds) {
    if (!isPanelId(panelId) || focusDisabledIds.has(panelId)) {
      return false;
    }
    focusDisabledIds.add(panelId);
  }

  const activeTerminalPanelId = snapshot.activeTerminalPanelId as string | null;
  const activePanelId = snapshot.activePanelId as string | null;
  const basePanel = snapshot.basePanel as TerminalKeyboardFocusTarget;
  if (basePanel.kind === "web") {
    return activeTerminalPanelId === null;
  }
  return (
    activeTerminalPanelId !== null &&
    activeTerminalPanelId === activePanelId &&
    activeTerminalPanelId === basePanel.panelId &&
    terminalIds.has(activeTerminalPanelId)
  );
}

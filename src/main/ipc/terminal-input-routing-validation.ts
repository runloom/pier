import type {
  TerminalFrame,
  TerminalInputRoutingSnapshot,
  TerminalKeyboardFocusTarget,
  TerminalWebOverlayRect,
} from "@shared/contracts/terminal.ts";

const MAX_INPUT_ROUTING_RECTS = 64;
const MAX_INPUT_ROUTING_RECT_ID_LENGTH = 160;
const MAX_INPUT_ROUTING_COORDINATE = 100_000;

function isFiniteFrame(frame: unknown): frame is TerminalFrame {
  if (frame === null || typeof frame !== "object") {
    return false;
  }
  const candidate = frame as Record<string, unknown>;
  return (
    typeof candidate.x === "number" &&
    Number.isFinite(candidate.x) &&
    Math.abs(candidate.x) <= MAX_INPUT_ROUTING_COORDINATE &&
    typeof candidate.y === "number" &&
    Number.isFinite(candidate.y) &&
    Math.abs(candidate.y) <= MAX_INPUT_ROUTING_COORDINATE &&
    typeof candidate.width === "number" &&
    Number.isFinite(candidate.width) &&
    candidate.width >= 0 &&
    candidate.width <= MAX_INPUT_ROUTING_COORDINATE &&
    typeof candidate.height === "number" &&
    Number.isFinite(candidate.height) &&
    candidate.height >= 0 &&
    candidate.height <= MAX_INPUT_ROUTING_COORDINATE
  );
}

function isWebOverlayRect(value: unknown): value is TerminalWebOverlayRect {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    candidate.id.length <= MAX_INPUT_ROUTING_RECT_ID_LENGTH &&
    isFiniteFrame(candidate.frame)
  );
}

function isKeyboardFocusTarget(
  value: unknown
): value is TerminalKeyboardFocusTarget {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.kind === "web") {
    return true;
  }
  return (
    candidate.kind === "terminal" &&
    typeof candidate.panelId === "string" &&
    candidate.panelId.length > 0 &&
    candidate.panelId.length <= 256
  );
}

export function isTerminalInputRoutingSnapshot(
  value: unknown
): value is TerminalInputRoutingSnapshot {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.rendererSequence !== "number" ||
    !Number.isInteger(candidate.rendererSequence) ||
    candidate.rendererSequence < 0 ||
    !isKeyboardFocusTarget(candidate.basePanel) ||
    typeof candidate.webRequestCount !== "number" ||
    !Number.isInteger(candidate.webRequestCount) ||
    candidate.webRequestCount < 0 ||
    !Array.isArray(candidate.webOverlayRects) ||
    candidate.webOverlayRects.length > MAX_INPUT_ROUTING_RECTS
  ) {
    return false;
  }
  const ids = new Set<string>();
  for (const rect of candidate.webOverlayRects) {
    if (!isWebOverlayRect(rect) || ids.has(rect.id)) {
      return false;
    }
    ids.add(rect.id);
  }
  return true;
}

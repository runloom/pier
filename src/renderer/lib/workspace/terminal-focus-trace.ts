/**
 * Minimal renderer focus breadcrumbs for sticky-web dumps.
 * Always-on small ring; no console. Dump via Terminal Debug → Copy.
 */
import type {
  TerminalFocusRoutingDebugSnapshot,
  TerminalFocusTraceEvent,
} from "@shared/contracts/terminal/debug.ts";

const MAX_EVENTS = 48;

let events: TerminalFocusTraceEvent[] = [];
let nextSeq = 1;

export function recordTerminalFocusTrace(
  kind: TerminalFocusTraceEvent["kind"],
  detail?: string
): void {
  events.push({
    at: Date.now(),
    kind,
    seq: nextSeq++,
    ...(detail === undefined ? {} : { detail }),
  });
  if (events.length > MAX_EVENTS) {
    events = events.slice(-MAX_EVENTS);
  }
}

export function getTerminalFocusTraceEvents(): readonly TerminalFocusTraceEvent[] {
  return events;
}

export function resetTerminalFocusTraceForTests(): void {
  events = [];
  nextSeq = 1;
}

export function formatTerminalFocusTraceDump(
  state: TerminalFocusRoutingDebugSnapshot
): string {
  return `${JSON.stringify(state, null, 2)}\n`;
}

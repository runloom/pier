import type {
  TerminalInputRoutingTraceEvent,
  TerminalInputRoutingTraceSnapshot,
} from "@shared/contracts/terminal/debug.ts";
import type { TerminalInputRoutingDiagnosticInput } from "@shared/contracts/terminal/input-routing-diagnostics.ts";

const MAX_TRACE_EVENTS = 80;
const DUMP_HEADER_FIELDS = new Set(["action", "at", "seq", "source"]);

let events: TerminalInputRoutingTraceEvent[] = [];
let nextSequence = 1;

export function recordTerminalInputRoutingTrace(
  input: TerminalInputRoutingDiagnosticInput
): void {
  events.push({
    ...input,
    // 与 terminal-focus-trace 同用 epoch ms，调试窗口可交叉对时。
    at: Date.now(),
    seq: nextSequence,
  });
  nextSequence += 1;
  if (events.length > MAX_TRACE_EVENTS) {
    events = events.slice(-MAX_TRACE_EVENTS);
  }
  try {
    window.pier?.terminal?.recordInputRoutingDiagnostic?.(input);
  } catch {
    // 诊断管道不可反向打断终端输入路由。
  }
}

export function readTerminalInputRoutingTraceSnapshot(): TerminalInputRoutingTraceSnapshot {
  return { events: [...events] };
}

/** Payload 字段已由 schema 白名单约束；按字段通用拼接，避免漏掉新 source。 */
export function formatTerminalInputRoutingTraceFields(
  event: TerminalInputRoutingTraceEvent
): string[] {
  const fields: string[] = [];
  for (const [field, value] of Object.entries(event)) {
    if (DUMP_HEADER_FIELDS.has(field) || value === undefined) {
      continue;
    }
    fields.push(`${field}=${Array.isArray(value) ? value.join("|") : value}`);
  }
  return fields;
}

export function formatTerminalInputRoutingTraceEvent(
  event: TerminalInputRoutingTraceEvent
): string {
  return [
    `#${event.seq}`,
    event.source,
    `action=${event.action}`,
    ...formatTerminalInputRoutingTraceFields(event),
  ].join(" ");
}

export function formatTerminalInputRoutingTraceDump(
  trace: TerminalInputRoutingTraceSnapshot
): string {
  if (trace.events.length === 0) {
    return "input-routing trace: no events";
  }
  return trace.events.map(formatTerminalInputRoutingTraceEvent).join("\n");
}

export function resetTerminalInputRoutingTraceForTests(): void {
  events = [];
  nextSequence = 1;
}

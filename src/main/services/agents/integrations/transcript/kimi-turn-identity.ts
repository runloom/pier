import { open, realpath } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";
import type { AgentHookEventPayload } from "@shared/contracts/agent/session.ts";
import { hookEventTimeMs } from "../../../foreground-activity/turn-unseal.ts";

const MAX_READ_BYTES = 1024 * 1024;
const TURN_NUMBER = /^(0|[1-9]\d*)$/;

/** Kimi v2 uses numeric turn IDs, including zero; loop events stringify them. */
export function kimiNativeTurnId(value: unknown): string | undefined {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0
      ? String(value)
      : undefined;
  }
  return typeof value === "string" && TURN_NUMBER.test(value)
    ? value
    : undefined;
}

interface KimiWireEvent {
  agentId?: unknown;
  event?: { toolCallId?: unknown; turnId?: unknown; type?: unknown };
  reason?: unknown;
  time?: unknown;
  turnId?: unknown;
  type?: unknown;
}

function interruptTurnId(hook: AgentHookEventPayload): string | undefined {
  if (hook.v === 1 || hook.nativeEvent !== "Interrupt") return;
  const id = kimiNativeTurnId(hook.turnId);
  if (id !== undefined) return id;
  // Native payload uses a number (including zero); older emitters only
  // extract strings. Keep this unscoped ID private until main wire agrees.
  try {
    const payload = JSON.parse(
      Buffer.from(hook.metadataBase64 ?? "", "base64").toString("utf8")
    );
    return kimiNativeTurnId(payload?.turnId ?? payload?.turn_id);
  } catch {
    return;
  }
}

/**
 * Hook payloads omit agent/turn identity. Only a matching MAIN tool call, or
 * the main step current at Stop, can associate the owner with a native turn.
 * Interrupt additionally requires a fresh main cancellation with the same ID.
 * Reading step identity does not publish transcript processing/tool events.
 */
function mainTurnForHook(
  text: string,
  hook: AgentHookEventPayload,
  observedSince: number | undefined
): string | undefined {
  let current:
    | {
        id: string;
        startedAt: number;
        endedAt?: number;
        failed?: boolean;
        cancelled?: boolean;
      }
    | undefined;
  let promptAt: number | undefined;
  let matchedTool = false;
  const isInterrupt = hook.v !== 1 && hook.nativeEvent === "Interrupt";
  const cancelledTurnId = interruptTurnId(hook);
  const toolId = hook.toolUseId?.trim();
  const hookTime = hookEventTimeMs(hook, Date.now());
  for (const line of text.split("\n")) {
    if (!(line.includes("context.append_loop_event") || line.includes("turn.")))
      continue;
    let wire: KimiWireEvent;
    try {
      wire = JSON.parse(line) as KimiWireEvent;
    } catch {
      continue;
    }
    if (wire?.agentId !== "main") continue;
    const time = typeof wire.time === "number" ? wire.time : Number.NaN;
    if (wire.type === "turn.prompt") {
      promptAt = Number.isFinite(time) ? time : undefined;
      current = undefined;
      matchedTool = false;
      continue;
    }
    if (wire.type === "turn.ended") {
      const id = kimiNativeTurnId(wire.turnId);
      // Cancellation may happen before step.begin, so the fresh main prompt
      // and matching durable end are sufficient to establish its identity.
      if (
        !current &&
        id !== undefined &&
        id === cancelledTurnId &&
        promptAt !== undefined &&
        time >= promptAt
      ) {
        current = { id, startedAt: promptAt };
      }
      if (current && id === current.id) {
        current.endedAt = time;
        current.failed = wire.reason === "failed";
        current.cancelled = wire.reason === "cancelled";
      }
      continue;
    }
    const event = wire.event;
    if (
      wire.type !== "context.append_loop_event" ||
      !event ||
      !(
        event.type === "step.begin" ||
        event.type === "step.end" ||
        event.type === "tool.call"
      )
    )
      continue;
    const id = kimiNativeTurnId(event.turnId);
    if (id === undefined || !Number.isFinite(time)) continue;
    if (current?.id !== id) {
      current = { id, startedAt: time };
      matchedTool = false;
    }
    if (event.type === "tool.call" && toolId && event.toolCallId === toolId)
      matchedTool = true;
  }
  if (
    !current ||
    // Epoch nanoseconds lose sub-millisecond precision when decoded as a JS number.
    current.startedAt > hookTime + 1 ||
    (toolId ? !matchedTool : hook.event !== "Stop")
  )
    return;
  if (isInterrupt) {
    return cancelledTurnId === current.id &&
      current.cancelled &&
      observedSince !== undefined &&
      current.startedAt >= observedSince &&
      current.endedAt !== undefined &&
      current.endedAt >= current.startedAt
      ? current.id
      : undefined;
  }
  // Stop executes before turn.ended. An already flushed terminal may match
  // that Stop, but an older completed turn must never be adopted on resume.
  // StopFailure 在 TurnEnded(failed) 后发出；只对当前 main failed 允许该次序。
  const observesFailure =
    hook.v !== 1 &&
    hook.nativeEvent === "StopFailure" &&
    current.failed &&
    observedSince !== undefined &&
    current.endedAt !== undefined &&
    current.endedAt >= observedSince;
  if (
    current.endedAt !== undefined &&
    !(current.endedAt >= hookTime || observesFailure)
  )
    return;
  return current.id;
}

export async function readKimiMainTurnId(
  path: string,
  root: string,
  event: AgentHookEventPayload,
  observedSince?: number
): Promise<string | undefined> {
  if (
    event.event === "SessionStart" ||
    event.event === "PromptSubmit" ||
    event.event === "SubagentStart" ||
    event.event === "SubagentStop" ||
    (!event.toolUseId?.trim() && event.event !== "Stop")
  )
    return;
  try {
    const [canonicalRoot, canonicalPath] = await Promise.all([
      realpath(root),
      realpath(path),
    ]);
    const rel = relative(canonicalRoot, canonicalPath);
    if (rel.startsWith("..") || isAbsolute(rel)) return;
    const file = await open(canonicalPath, "r");
    try {
      const info = await file.stat();
      if (!info.isFile()) return;
      const length = Math.min(info.size, MAX_READ_BYTES);
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await file.read(
        buffer,
        0,
        length,
        info.size - length
      );
      const end = buffer.lastIndexOf(0x0a, bytesRead - 1);
      return end < 0
        ? undefined
        : mainTurnForHook(
            buffer.subarray(0, end + 1).toString("utf8"),
            event,
            observedSince
          );
    } finally {
      await file.close();
    }
  } catch {
    // Provider-private compatibility input: unavailable or rotated wire files
    // must not affect hook delivery.
    return;
  }
}

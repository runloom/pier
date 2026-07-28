/** Product sessionTitle writes on FA panel slots (isolated from status). */

import { decideAgentSessionTitleWrite } from "@shared/agent-session-title/index.ts";
import type { AgentSessionTitleSource } from "@shared/contracts/foreground-activity.ts";
import { panelKey } from "./aggregator-panel-key.ts";
import type { PanelSlot } from "./entry.ts";

interface SessionTitleSlotCtx {
  disposed: boolean;
  scheduleEmit: () => void;
  slotFor: (key: string, panelId: string) => PanelSlot;
}

function normalizedSessionId(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function resolveSlot(
  ctx: SessionTitleSlotCtx,
  windowId: string,
  panelId: string
): PanelSlot | null {
  if (ctx.disposed) {
    return null;
  }
  if (windowId.trim().length === 0 || panelId.trim().length === 0) {
    return null;
  }
  return ctx.slotFor(panelKey(windowId, panelId), panelId);
}

export function setPanelSlotSessionTitle(
  ctx: SessionTitleSlotCtx,
  windowId: string,
  panelId: string,
  input: {
    title: string;
    source: AgentSessionTitleSource;
    sessionId?: string | undefined;
  }
): boolean {
  const slot = resolveSlot(ctx, windowId, panelId);
  if (!slot) {
    return false;
  }
  const nextSessionId = normalizedSessionId(input.sessionId);
  const crossedKnownSessionBoundary =
    nextSessionId !== undefined &&
    slot.sessionTitleSessionId !== undefined &&
    nextSessionId !== slot.sessionTitleSessionId;
  const decision = decideAgentSessionTitleWrite({
    currentSource: crossedKnownSessionBoundary
      ? null
      : (slot.sessionTitleSource ?? null),
    currentTitle: crossedKnownSessionBoundary
      ? null
      : (slot.sessionTitle ?? null),
    nextSource: input.source,
    nextTitle: input.title,
  });
  if (!decision.apply) {
    return false;
  }
  slot.sessionTitle = decision.title;
  if (nextSessionId) {
    slot.sessionTitleSessionId = nextSessionId;
  }
  slot.sessionTitleSource = decision.source;
  ctx.scheduleEmit();
  return true;
}

/** 用持久化规范状态水合；磁盘是权威源，必须修正竞态留下的错误槽位。 */
export function hydratePanelSlotSessionTitle(
  ctx: SessionTitleSlotCtx,
  windowId: string,
  panelId: string,
  input: {
    title: string;
    source: AgentSessionTitleSource;
    sessionId?: string | undefined;
  }
): void {
  const slot = resolveSlot(ctx, windowId, panelId);
  if (!slot) {
    return;
  }
  const decision = decideAgentSessionTitleWrite({
    nextSource: input.source,
    nextTitle: input.title,
  });
  if (!decision.apply) {
    return;
  }
  const sessionId = normalizedSessionId(input.sessionId);
  const changed =
    slot.sessionTitle !== decision.title ||
    slot.sessionTitleSource !== decision.source ||
    slot.sessionTitleSessionId !== sessionId;
  slot.sessionTitle = decision.title;
  slot.sessionTitleSource = decision.source;
  if (sessionId) {
    slot.sessionTitleSessionId = sessionId;
  } else {
    Reflect.deleteProperty(slot, "sessionTitleSessionId");
  }
  if (!changed) {
    return;
  }
  ctx.scheduleEmit();
}

export function clearPanelSlotSessionTitle(
  ctx: SessionTitleSlotCtx,
  windowId: string,
  panelId: string
): void {
  const slot = resolveSlot(ctx, windowId, panelId);
  if (
    !slot ||
    (slot.sessionTitle === undefined &&
      slot.sessionTitleSource === undefined &&
      slot.sessionTitleSessionId === undefined)
  ) {
    return;
  }
  Reflect.deleteProperty(slot, "sessionTitle");
  Reflect.deleteProperty(slot, "sessionTitleSource");
  Reflect.deleteProperty(slot, "sessionTitleSessionId");
  ctx.scheduleEmit();
}

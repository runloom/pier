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
  input: { title: string; source: AgentSessionTitleSource }
): boolean {
  const slot = resolveSlot(ctx, windowId, panelId);
  if (!slot) {
    return false;
  }
  const decision = decideAgentSessionTitleWrite({
    currentSource: slot.sessionTitleSource ?? null,
    currentTitle: slot.sessionTitle ?? null,
    nextSource: input.source,
    nextTitle: input.title,
  });
  if (!decision.apply) {
    return false;
  }
  slot.sessionTitle = decision.title;
  slot.sessionTitleSource = decision.source;
  ctx.scheduleEmit();
  return true;
}

/** Seed title when slot empty (reload / launch); never overwrite. */
export function hydratePanelSlotSessionTitle(
  ctx: SessionTitleSlotCtx,
  windowId: string,
  panelId: string,
  input: { title: string; source: AgentSessionTitleSource }
): void {
  const slot = resolveSlot(ctx, windowId, panelId);
  if (!slot || slot.sessionTitle?.trim()) {
    return;
  }
  const decision = decideAgentSessionTitleWrite({
    nextSource: input.source,
    nextTitle: input.title,
  });
  if (!decision.apply) {
    return;
  }
  slot.sessionTitle = decision.title;
  slot.sessionTitleSource = decision.source;
  ctx.scheduleEmit();
}

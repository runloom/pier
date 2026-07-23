/** Product sessionTitle writes on FA panel slots (isolated from status). */

import { decideAgentSessionTitleWrite } from "@shared/agent-session-title.ts";
import { panelKey } from "./aggregator-panel-key.ts";
import type { PanelSlot } from "./entry.ts";

interface SessionTitleSlotCtx {
  disposed: boolean;
  scheduleEmit: () => void;
  slotFor: (key: string, panelId: string) => PanelSlot;
}

export function setPanelSlotSessionTitle(
  ctx: SessionTitleSlotCtx,
  windowId: string,
  panelId: string,
  input: { title: string; source: "auto" | "user"; replaceAuto?: boolean }
): boolean {
  if (ctx.disposed) {
    return false;
  }
  if (windowId.trim().length === 0 || panelId.trim().length === 0) {
    return false;
  }
  const key = panelKey(windowId, panelId);
  const slot = ctx.slotFor(key, panelId);
  const decision = decideAgentSessionTitleWrite({
    currentSource: slot.sessionTitleSource ?? null,
    currentTitle: slot.sessionTitle ?? null,
    nextSource: input.source,
    nextTitle: input.title,
    ...(input.replaceAuto === undefined
      ? {}
      : { replaceAuto: input.replaceAuto }),
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
  input: { title: string; source: "auto" | "user" }
): void {
  if (ctx.disposed) {
    return;
  }
  if (windowId.trim().length === 0 || panelId.trim().length === 0) {
    return;
  }
  const key = panelKey(windowId, panelId);
  const slot = ctx.slotFor(key, panelId);
  if (slot.sessionTitle?.trim()) {
    return;
  }
  const decision = decideAgentSessionTitleWrite({
    currentSource: slot.sessionTitleSource ?? null,
    currentTitle: slot.sessionTitle ?? null,
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

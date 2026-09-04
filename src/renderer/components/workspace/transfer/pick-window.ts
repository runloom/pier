/**
 * List other Pier windows for tab-menu relocate (move/copy).
 * Names come from WindowInfo.title (main-written, globally disambiguated).
 */

import type { WindowInfo } from "@shared/contracts/events.ts";
import { getWindowContext, listWindows } from "@/lib/ipc/window-ipc.ts";

export const OTHER_WINDOW_PANEL_LABEL_TIMEOUT_MS = 400;

export interface OtherWindowOption {
  description?: string;
  id: string;
  label: string;
  menuLabel: string;
  recordId: string;
}

export async function listOtherWindowInfos(): Promise<WindowInfo[]> {
  const [context, windows] = await Promise.all([
    getWindowContext(),
    listWindows(),
  ]);
  return windows
    .filter((candidate) => candidate.id !== context.windowId)
    .slice()
    .sort((a, b) => (b.lastFocusedAt ?? 0) - (a.lastFocusedAt ?? 0));
}

function optionFromWindow(candidate: WindowInfo): OtherWindowOption {
  const name = candidate.title ?? "";
  return {
    id: candidate.id,
    label: name,
    menuLabel: name,
    recordId: candidate.recordId,
  };
}

export async function listOtherWindows(): Promise<OtherWindowOption[]> {
  const others = await listOtherWindowInfos();
  return others.map((candidate) => optionFromWindow(candidate));
}

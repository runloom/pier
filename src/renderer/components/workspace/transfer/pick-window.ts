/**
 * List other Pier windows for tab-menu relocate (move/copy).
 * Count/id is cheap (window.list). Panel snapshots are fetched only when a
 * submenu needs names, and only for a short budget so tab menus stay snappy.
 */

import type { WindowInfo } from "@shared/contracts/events.ts";
import type { PanelSnapshot } from "@shared/contracts/panel.ts";
import i18next from "i18next";
import { getWindowContext, listWindows } from "@/lib/ipc/window-ipc.ts";
import {
  buildWindowDisplays,
  type WindowDisplay,
  windowDisplayCopyFromI18n,
} from "./window-display.ts";

/** Cap for the optional panels.list enrichment on 2+ other windows. */
export const OTHER_WINDOW_PANEL_LABEL_TIMEOUT_MS = 400;

export interface OtherWindowOption {
  description?: string;
  id: string;
  label: string;
  menuLabel: string;
  recordId: string;
}

function asGlobalPanelList(
  listed: Awaited<ReturnType<typeof window.pier.panels.list>>
): PanelSnapshot[] {
  if (Array.isArray(listed)) {
    // Single-window form — no windowId tagging; unusable for multi-window labels.
    return listed;
  }
  return listed.panels ?? [];
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("timeout"));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
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

function optionFromWindow(
  candidate: WindowInfo,
  display?: WindowDisplay
): OtherWindowOption {
  if (display) {
    return {
      id: display.id,
      label: display.label,
      menuLabel: display.menuLabel,
      recordId: display.recordId,
      ...(display.description ? { description: display.description } : {}),
    };
  }
  return {
    id: candidate.id,
    label: candidate.recordId,
    menuLabel: candidate.recordId,
    recordId: candidate.recordId,
  };
}

async function panelsForMenuLabels(): Promise<PanelSnapshot[]> {
  try {
    const listed = await withTimeout(
      window.pier.panels.list(),
      OTHER_WINDOW_PANEL_LABEL_TIMEOUT_MS
    );
    return asGlobalPanelList(listed);
  } catch {
    return [];
  }
}

function optionsFromDisplays(
  others: readonly WindowInfo[],
  panels: readonly PanelSnapshot[]
): OtherWindowOption[] {
  const copy = windowDisplayCopyFromI18n((key, options) =>
    options === undefined ? i18next.t(key) : i18next.t(key, options)
  );
  const displays: WindowDisplay[] = buildWindowDisplays(others, panels, copy);
  const byId = new Map(displays.map((display) => [display.id, display]));
  return others.map((candidate) =>
    optionFromWindow(candidate, byId.get(candidate.id))
  );
}

export async function listOtherWindows(): Promise<OtherWindowOption[]> {
  const others = await listOtherWindowInfos();
  if (others.length <= 1) {
    return others.map((candidate) => optionFromWindow(candidate));
  }
  const panels = await panelsForMenuLabels();
  return optionsFromDisplays(others, panels);
}

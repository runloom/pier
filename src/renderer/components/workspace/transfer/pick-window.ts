/**
 * Pick another Pier window for move/copy panel relocate.
 * Selection always goes through the command-palette quick pick (same shell
 * as agents / SSH host list) — no content-dialog picker.
 *
 * Labels prefer workspace basename + active tab title (VS Code-style), not
 * bare "Window 1 / Window 2".
 */

import type { WindowInfo } from "@shared/contracts/events.ts";
import type { PanelSnapshot } from "@shared/contracts/panel.ts";
import i18next from "i18next";
import { useCommandPaletteController } from "@/lib/command-palette/controller.ts";
import type { QuickPickItem } from "@/lib/command-palette/types.ts";
import { getWindowContext, listWindows } from "@/lib/ipc/window-ipc.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import {
  buildWindowDisplays,
  type WindowDisplay,
  windowDisplayCopyFromI18n,
} from "./window-display.ts";

export interface OtherWindowOption {
  description?: string;
  detail?: string;
  id: string;
  label: string;
  recordId: string;
  searchTerms?: readonly string[];
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

export async function listOtherWindows(): Promise<OtherWindowOption[]> {
  const [context, windows, listed] = await Promise.all([
    getWindowContext(),
    listWindows(),
    window.pier.panels.list(),
  ]);
  const currentId = context.windowId;
  const others: WindowInfo[] = windows
    .filter((window) => window.id !== currentId)
    .slice()
    .sort((a, b) => (b.lastFocusedAt ?? 0) - (a.lastFocusedAt ?? 0));

  const panels = asGlobalPanelList(listed);
  const copy = windowDisplayCopyFromI18n((key, options) =>
    options === undefined ? i18next.t(key) : i18next.t(key, options)
  );
  const displays: WindowDisplay[] = buildWindowDisplays(others, panels, copy);

  // Preserve recent-focus order of `others`.
  const byId = new Map(displays.map((display) => [display.id, display]));
  return others.flatMap((window) => {
    const display = byId.get(window.id);
    if (!display) {
      return [];
    }
    return [
      {
        id: display.id,
        label: display.label,
        recordId: display.recordId,
        ...(display.description ? { description: display.description } : {}),
        ...(display.detail ? { detail: display.detail } : {}),
        searchTerms: display.searchTerms,
      },
    ];
  });
}

/**
 * Resolve a target window id for relocate via the command-palette quick pick.
 * - 0 others → alert + null
 * - 1+ others → always open quick pick (unified with command-palette path)
 */
export async function pickOtherWindowId(): Promise<string | null> {
  let options: OtherWindowOption[];
  try {
    options = await listOtherWindows();
  } catch (error) {
    await showAppAlert({
      body: error instanceof Error ? error.message : String(error),
      title: i18next.t("workspace.panelTransfer.pickWindowFailed"),
    });
    return null;
  }

  if (options.length === 0) {
    await showAppAlert({
      body: i18next.t("workspace.panelTransfer.noOtherWindows"),
      title: i18next.t("workspace.panelTransfer.pickWindowTitle"),
    });
    return null;
  }

  return await new Promise<string | null>((resolve) => {
    let settled = false;
    const finish = (windowId: string | null) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(windowId);
    };

    const items: QuickPickItem[] = options.map((option) => ({
      id: option.id,
      label: option.label,
      ...(option.description ? { description: option.description } : {}),
      ...(option.detail ? { detail: option.detail } : {}),
      searchTerms: [
        option.id,
        option.recordId,
        ...(option.searchTerms ?? []),
        ...(option.description ? [option.description] : []),
        ...(option.detail ? [option.detail] : []),
      ],
    }));

    useCommandPaletteController.getState().openQuickPick({
      items,
      onAccept: async (item) => {
        finish(item.id);
      },
      onDismiss: () => {
        finish(null);
      },
      placeholder: i18next.t("workspace.panelTransfer.pickWindowPlaceholder"),
      title: i18next.t("workspace.panelTransfer.pickWindowTitle"),
    });
  });
}

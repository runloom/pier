/**
 * terminal panel 定位：list/get/send 与 screen/read/close 共用。
 */
import type { PierCommandResult } from "@shared/contracts/commands.ts";
import { toNativePanelKey } from "../../ipc/terminal/panel-id.ts";
import { findAppWindowForActivityWindowId } from "../../windows/identity.ts";
import { commandFailure } from "../command-results.ts";
import type { PierCoreServices } from "../command-router-services.ts";
import { listPanels } from "./panel.ts";

export function isTerminalComponent(component: string | undefined): boolean {
  if (!component) {
    return false;
  }
  // 仅明确 terminal 组件；避免 includes("terminal") 误匹配其它物料 id。
  return component === "terminal" || component.startsWith("terminal-");
}

export function resolveNativeKey(
  panelId: string,
  windowId: string | undefined
): string | null {
  if (!windowId) {
    return null;
  }
  const win = findAppWindowForActivityWindowId(windowId);
  if (!win || win.isDestroyed()) {
    return null;
  }
  return toNativePanelKey(win, panelId);
}

/**
 * panelId 跨窗口不唯一。未带 windowId 时必须恰好一命中，否则 fail-closed。
 */
export function pickUniquePanel<T extends { windowId: string }>(
  items: readonly T[],
  panelId: string,
  windowId: string | undefined,
  idOf: (item: T) => string
): { ok: true; item: T } | { ok: false; reason: "ambiguous" | "missing" } {
  const hits = items.filter((item) => {
    if (idOf(item) !== panelId) {
      return false;
    }
    if (windowId !== undefined && windowId.length > 0) {
      return item.windowId === windowId;
    }
    return true;
  });
  if (hits.length === 1) {
    const item = hits[0];
    if (item) {
      return { ok: true, item };
    }
  }
  if (hits.length === 0) {
    return { ok: false, reason: "missing" };
  }
  return { ok: false, reason: "ambiguous" };
}

function panelLookupFailure(
  requestId: string,
  panelId: string,
  reason: "ambiguous" | "missing"
): PierCommandResult {
  if (reason === "ambiguous") {
    return commandFailure(
      requestId,
      "not_found",
      `terminal panel is ambiguous across windows: ${panelId}`
    );
  }
  return commandFailure(
    requestId,
    "not_found",
    `terminal panel not found: ${panelId}`
  );
}

export async function findListedPanel(
  requestId: string,
  panelId: string,
  windowId: string | undefined,
  services: PierCoreServices
): Promise<
  | {
      ok: true;
      panel: {
        component?: string | undefined;
        id: string;
        windowId: string;
      };
    }
  | { ok: false; result: PierCommandResult }
> {
  const listed = await listPanels(
    windowId ? { type: "panel.list", windowId } : { type: "panel.list" },
    services as never
  );
  const picked = pickUniquePanel(
    listed.panels,
    panelId,
    windowId,
    (panel) => panel.id
  );
  if (!picked.ok) {
    return {
      ok: false,
      result: panelLookupFailure(requestId, panelId, picked.reason),
    };
  }
  return { ok: true, panel: picked.item };
}

export async function requireTerminalPanel(
  requestId: string,
  panelId: string,
  windowId: string | undefined,
  services: PierCoreServices
): Promise<
  | {
      ok: true;
      panel: {
        component?: string | undefined;
        id: string;
        windowId: string;
      };
    }
  | { ok: false; result: PierCommandResult }
> {
  const found = await findListedPanel(requestId, panelId, windowId, services);
  if (!found.ok) {
    return found;
  }
  if (!isTerminalComponent(found.panel.component)) {
    return {
      ok: false,
      result: commandFailure(
        requestId,
        "invalid_command",
        `panel is not a terminal: ${panelId}`
      ),
    };
  }
  return found;
}

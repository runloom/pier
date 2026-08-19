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
  const hit = listed.panels.find((panel) => panel.id === panelId);
  if (!hit) {
    return {
      ok: false,
      result: commandFailure(
        requestId,
        "not_found",
        `terminal panel not found: ${panelId}`
      ),
    };
  }
  return { ok: true, panel: hit };
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

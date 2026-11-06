/**
 * terminal panel 定位：list/get/send 与 screen/read/close 共用。
 */
import type { PierCommandResult } from "@shared/contracts/commands.ts";
import { toNativePanelKey } from "../../ipc/terminal/panel-id.ts";
import { findAppWindowForActivityWindowId } from "../../windows/identity.ts";
import { commandFailure } from "../command-results.ts";
import type { PierCoreServices } from "../command-router-services.ts";
import { canonicalWindowId } from "../window-routing.ts";
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
 * terminal 命令的窗口 id 归一化为内部 id。`listPanels` 快照里的 `windowId`
 * 恒为内部 id；命令可能带 `PIER_WINDOW_ID`（Electron id）或 record UUID。
 */
export function resolveTerminalWindowId(
  windowId: string | undefined,
  services: PierCoreServices
): string | undefined {
  return canonicalWindowId(windowId, services.window.list());
}

/**
 * panelId 跨窗口不唯一。未带 windowId 时必须恰好一命中，否则 fail-closed。
 */
export function pickUniquePanel<T extends { windowId: string }>(
  items: readonly T[],
  panelId: string,
  windowId: string | undefined,
  idOf: (item: T) => string
): PanelPick<T> {
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

/**
 * 未带 windowId 且 panelId 跨窗命中多块面板时，错误码必须是
 * `invalid_command`（请求缺消歧参数），不能复用 `not_found`：
 * 调用方会据此判断面板是否仍然存活。
 */
export function panelLookupError(
  reason: "ambiguous" | "missing",
  panelId: string
): { code: "invalid_command" | "not_found"; message: string } {
  if (reason === "ambiguous") {
    return {
      code: "invalid_command",
      message: `terminal panel is ambiguous across windows: ${panelId}`,
    };
  }
  return {
    code: "not_found",
    message: `terminal panel not found: ${panelId}`,
  };
}

/**
 * 找面板时的错误分类：歧义是请求缺 windowId；某个窗口 renderer 取不到
 * panel.list 时是宿主暂不可用，不能伪装成面板不存在（插件会据此清 map）。
 */
export function panelListLookupError(
  errors: ReadonlyArray<{ code?: string | undefined; message: string }>,
  reason: "ambiguous" | "missing",
  panelId: string
): {
  code: "invalid_command" | "not_found" | "platform_unavailable";
  message: string;
} {
  if (reason === "ambiguous") {
    return panelLookupError(reason, panelId);
  }
  const rendererError = errors.find((error) => error.code !== "not_found");
  if (rendererError) {
    return {
      code: "platform_unavailable",
      message: `terminal panel lookup unavailable: ${rendererError.message}`,
    };
  }
  return panelLookupError("missing", panelId);
}

/**
 * 未带 windowId 的寻址在任一窗口 panel.list 失败时不能当作唯一命中：
 * panelId 跨窗口不唯一（默认布局会在多个窗口创建 `terminal-1`），未列出的
 * 窗口里可能还有同名面板。写入 / 关闭必须 fail closed，不能猜健康窗口里的同名项。
 */
export function incompletePanelListFailure(
  requestId: string,
  windowId: string | undefined,
  errors: ReadonlyArray<{ code?: string | undefined; message: string }>
): PierCommandResult | null {
  if (windowId || errors.length === 0) {
    return null;
  }
  return commandFailure(
    requestId,
    "platform_unavailable",
    "panel list incomplete; pass windowId"
  );
}

export type PanelPick<T extends { windowId: string }> =
  | { ok: true; item: T }
  | { ok: false; reason: "ambiguous" | "missing" };

/**
 * 定位结果的统一出口：歧义 / 缺失 / 未带 windowId 的残缺清单都在这里
 * 转成命令失败，避免每个调用点各抄一份错误分类。
 */
export function resolvePanelPick<T extends { windowId: string }>(input: {
  errors: ReadonlyArray<{ code?: string | undefined; message: string }>;
  panelId: string;
  picked: PanelPick<T>;
  requestId: string;
  windowId: string | undefined;
}): { ok: true; item: T } | { ok: false; result: PierCommandResult } {
  if (!input.picked.ok) {
    const error = panelListLookupError(
      input.errors,
      input.picked.reason,
      input.panelId
    );
    return {
      ok: false,
      result: commandFailure(input.requestId, error.code, error.message),
    };
  }
  const incomplete = incompletePanelListFailure(
    input.requestId,
    input.windowId,
    input.errors
  );
  if (incomplete) {
    return { ok: false, result: incomplete };
  }
  return input.picked;
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
  const scopedWindowId = resolveTerminalWindowId(windowId, services);
  const listed = await listPanels(
    scopedWindowId
      ? { type: "panel.list", windowId: scopedWindowId }
      : { type: "panel.list" },
    services as never
  );
  const resolved = resolvePanelPick({
    errors: listed.errors,
    panelId,
    picked: pickUniquePanel(
      listed.panels,
      panelId,
      scopedWindowId,
      (panel) => panel.id
    ),
    requestId,
    windowId,
  });
  if (!resolved.ok) {
    return resolved;
  }
  return { ok: true, panel: resolved.item };
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

import type {
  TerminalFrame,
  TerminalKeyboardFocusTarget,
} from "@shared/contracts/terminal.ts";
import type {
  TerminalDebugEvent,
  TerminalDebugNativeSnapshot,
  TerminalDebugRendererSnapshot,
  TerminalDebugRendererSnapshotResult,
  TerminalDebugRoute,
  TerminalDebugRouterDecision,
  TerminalDebugRouterDecisionKind,
  TerminalDebugRouterDecisionPayload,
  TerminalDebugSnapshot,
} from "@shared/contracts/terminal-debug.ts";
import { buildTerminalDebugIssues } from "@shared/terminal-debug-diagnostics.ts";
import type { IpcMain, WebContents } from "electron";
import type { AppWindow } from "../windows/app-window.ts";
import { findAppWindowByElectronId } from "../windows/window-identity.ts";
import type { NativeAddon } from "./terminal-native-addon.ts";
import { fromNativePanelKey, toNativePanelKey } from "./terminal-panel-id.ts";
import {
  readTerminalInputRoutingDebug,
  readTerminalPresentationDebug,
} from "./terminal-presentation.ts";
import { stableWindowIdFor } from "./terminal-window-scope.ts";

const MAX_EVENTS = 120;
const RENDERER_SNAPSHOT_TIMEOUT_MS = 800;
let nextEventId = 1;
let nextRendererSnapshotRequestId = 1;
const events: TerminalDebugEvent[] = [];
const rendererSnapshotRequests = new Map<
  string,
  {
    expectedSender: WebContents;
    resolve: (snapshot: TerminalDebugRendererSnapshot | undefined) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();

interface TerminalDebugEventInput {
  action: string;
  browserWindowId: number;
  detail?: Record<string, boolean | number | string | null> | undefined;
  nativePanelId?: string | undefined;
  panelId?: string | undefined;
  route: TerminalDebugRoute;
  windowId?: string | undefined;
}

type TerminalDebugDetail = Record<string, boolean | number | string | null>;

function emptyNativeSnapshot(error?: string): TerminalDebugNativeSnapshot {
  return {
    ...(error ? { error } : {}),
    surfaces: [],
    window: {
      activeTerminalPanelId: null,
      keyboardFocusTarget: { kind: "web" },
      nativeActiveTerminalPanelId: null,
      terminalTargetCount: 0,
      webOverlayRectCount: 0,
    },
  };
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function booleanValue(value: unknown): boolean {
  return typeof value === "boolean" ? value : false;
}

function optionalBooleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function optionalNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function keyboardFocusTargetValue(value: unknown): TerminalKeyboardFocusTarget {
  const record = objectRecord(value);
  if (record?.kind === "terminal") {
    const nativePanelId = stringValue(record.panelId);
    if (nativePanelId) {
      return { kind: "terminal", panelId: fromNativePanelKey(nativePanelId) };
    }
  }
  return { kind: "web" };
}

const ROUTER_DECISION_KINDS: readonly TerminalDebugRouterDecisionKind[] = [
  "hit-test",
  "key-down",
  "right-mouse",
];

function routerDecisionKind(
  value: unknown
): TerminalDebugRouterDecisionKind | null {
  return typeof value === "string" &&
    (ROUTER_DECISION_KINDS as readonly string[]).includes(value)
    ? (value as TerminalDebugRouterDecisionKind)
    : null;
}

/**
 * Native ring buffer 把 panel id 存成 scoped key (`<browserWindowId>::<panelId>`),
 * 但 debug window 的其他字段全走 fromNativePanelKey 展示为原始 id — 同一 panel 在
 * 一个 UI 里以两种格式并排出现会让排错者误判为不同 panel. 这里把 payload 里已知
 * 会承载 native panel key 的字段单独 demangle, 保持展示一致.
 */
const NATIVE_PANEL_KEY_PAYLOAD_FIELDS = new Set([
  "matchedPanelId",
  "activeTerminalPanelId",
]);

function routerDecisionPayload(
  value: unknown
): TerminalDebugRouterDecisionPayload {
  const record = objectRecord(value);
  if (!record) {
    return {};
  }
  const payload: TerminalDebugRouterDecisionPayload = {};
  for (const [key, raw] of Object.entries(record)) {
    if (raw === null) {
      payload[key] = null;
    } else if (typeof raw === "boolean" || typeof raw === "number") {
      payload[key] = raw;
    } else if (typeof raw === "string") {
      payload[key] = NATIVE_PANEL_KEY_PAYLOAD_FIELDS.has(key)
        ? fromNativePanelKey(raw)
        : raw;
    }
  }
  return payload;
}

interface RouterDecisionsNormalizeResult {
  decisions: TerminalDebugRouterDecision[];
  droppedCount: number;
}

function routerDecisions(value: unknown): RouterDecisionsNormalizeResult {
  if (!Array.isArray(value)) {
    return { decisions: [], droppedCount: 0 };
  }
  const decisions: TerminalDebugRouterDecision[] = [];
  let droppedCount = 0;
  for (const entry of value) {
    const record = objectRecord(entry);
    if (!record) {
      droppedCount += 1;
      continue;
    }
    const kind = routerDecisionKind(record.kind);
    if (!kind) {
      droppedCount += 1;
      continue;
    }
    decisions.push({
      at: numberValue(record.at),
      kind,
      payload: routerDecisionPayload(record.payload),
      seq: numberValue(record.seq),
    });
  }
  return { decisions, droppedCount };
}

function frameValue(value: unknown): TerminalFrame {
  const record = objectRecord(value);
  return {
    height: numberValue(record?.height),
    width: numberValue(record?.width),
    x: numberValue(record?.x),
    y: numberValue(record?.y),
  };
}

function optionalFrameValue(value: unknown): TerminalFrame | null {
  if (!objectRecord(value)) {
    return null;
  }
  return frameValue(value);
}

function normalizeNativeSnapshot(rawJson: string): TerminalDebugNativeSnapshot {
  const raw = objectRecord(JSON.parse(rawJson));
  if (!raw) {
    return emptyNativeSnapshot("native debug snapshot was not an object");
  }
  // Swift jsonString 在 JSONSerialization 拒绝 payload 时会写 `{"error": "..."}`,
  // 老实现返回 "{}" 会让 objectRecord({}) 通过, 后续所有字段落到默认值 0, error
  // 保持 undefined, renderer 展示成一个 "0 targets / 0 web / no decisions" 的假
  // healthy 状态。检测 error 字段以及 window/surfaces 缺失, 把它标成 error 并让
  // banner 显式提示。
  if (typeof raw.error === "string" && raw.error.length > 0) {
    return emptyNativeSnapshot(raw.error);
  }
  if (!("window" in raw || "surfaces" in raw)) {
    return emptyNativeSnapshot(
      "native debug snapshot payload missing window/surfaces"
    );
  }

  const rawWindow = objectRecord(raw.window);
  const nativeActiveTerminalPanelId = stringValue(
    rawWindow?.activeTerminalPanelId
  );
  const rawSurfaces = Array.isArray(raw.surfaces) ? raw.surfaces : [];
  const routerDecisionsResult = routerDecisions(
    rawWindow?.recentRouterDecisions
  );
  return {
    surfaces: rawSurfaces.flatMap((entry) => {
      const surface = objectRecord(entry);
      const nativePanelId = stringValue(surface?.panelId);
      if (!(surface && nativePanelId)) {
        return [];
      }
      return [
        {
          alpha: numberValue(surface.alpha, 1),
          browserWindowId: numberValue(surface.browserWindowId),
          cursorSuppressed: booleanValue(surface.cursorSuppressed),
          drawPending: optionalBooleanValue(surface.drawPending),
          drawSequence: optionalNonNegativeNumber(surface.drawSequence),
          frame: frameValue(surface.frame),
          ghosttyRenderReadySequence: optionalNonNegativeNumber(
            surface.ghosttyRenderReadySequence
          ),
          hasRouterTarget: booleanValue(surface.hasRouterTarget),
          hostKeyboardActive: booleanValue(surface.hostKeyboardActive),
          hostRefreshRequestSequence: optionalNonNegativeNumber(
            surface.hostRefreshRequestSequence
          ),
          isFirstResponder: booleanValue(surface.isFirstResponder),
          isHidden: booleanValue(surface.isHidden),
          isOffscreen: booleanValue(surface.isOffscreen),
          isSurfaceFocused: booleanValue(surface.isSurfaceFocused),
          lastDrawUptime: optionalNonNegativeNumber(surface.lastDrawUptime),
          lastDrawnGhosttyRenderReadySequence: optionalNonNegativeNumber(
            surface.lastDrawnGhosttyRenderReadySequence
          ),
          lastRenderReadyUptime: optionalNonNegativeNumber(
            surface.lastRenderReadyUptime
          ),
          nativePanelId,
          panelId: fromNativePanelKey(nativePanelId),
          refreshPending: optionalBooleanValue(surface.refreshPending),
          surfaceVisible: booleanValue(surface.surfaceVisible),
          surfaceGeneration: optionalNonNegativeNumber(
            surface.surfaceGeneration
          ),
          targetRect: optionalFrameValue(surface.targetRect),
          viewportFrame: optionalFrameValue(surface.viewportFrame),
        },
      ];
    }),
    window: {
      activeTerminalPanelId: nativeActiveTerminalPanelId
        ? fromNativePanelKey(nativeActiveTerminalPanelId)
        : null,
      appTickCount: optionalNonNegativeNumber(rawWindow?.appTickCount),
      inputRoutingStaleDiscardCount:
        typeof rawWindow?.inputRoutingStaleDiscardCount === "number"
          ? rawWindow.inputRoutingStaleDiscardCount
          : undefined,
      keyboardFocusTarget: keyboardFocusTargetValue(
        rawWindow?.keyboardFocusTarget
      ),
      lastAppliedInputRoutingSequence:
        typeof rawWindow?.lastAppliedInputRoutingSequence === "number"
          ? rawWindow.lastAppliedInputRoutingSequence
          : undefined,
      lastAppliedNativeApplySequence:
        typeof rawWindow?.lastAppliedNativeApplySequence === "number"
          ? rawWindow.lastAppliedNativeApplySequence
          : undefined,
      lastAppliedRendererSequence:
        typeof rawWindow?.lastAppliedRendererSequence === "number"
          ? rawWindow.lastAppliedRendererSequence
          : undefined,
      lastAppTickUptime: optionalNonNegativeNumber(
        rawWindow?.lastAppTickUptime
      ),
      lastPresentationReason:
        typeof rawWindow?.lastPresentationReason === "string"
          ? rawWindow.lastPresentationReason
          : undefined,
      nativeActiveTerminalPanelId,
      recentRouterDecisions: routerDecisionsResult.decisions,
      routerDecisionsDroppedCount:
        routerDecisionsResult.droppedCount > 0
          ? routerDecisionsResult.droppedCount
          : undefined,
      staleDiscardCount:
        typeof rawWindow?.staleDiscardCount === "number"
          ? rawWindow.staleDiscardCount
          : undefined,
      terminalTargetCount: numberValue(rawWindow?.terminalTargetCount),
      webOverlayRectCount: numberValue(rawWindow?.webOverlayRectCount),
    },
  };
}

export function recordTerminalDebugEvent(input: TerminalDebugEventInput): void {
  events.push({
    ...input,
    at: new Date().toISOString(),
    id: nextEventId,
  });
  nextEventId += 1;
  if (events.length > MAX_EVENTS) {
    events.splice(0, events.length - MAX_EVENTS);
  }
}

export function recordRendererTerminalRoute(
  win: AppWindow,
  action: string,
  panelId: string | null,
  detail?: TerminalDebugDetail
): void {
  recordTerminalDebugEvent({
    action,
    browserWindowId: win.id,
    ...(detail ? { detail } : {}),
    ...(panelId
      ? { nativePanelId: toNativePanelKey(win, panelId), panelId }
      : {}),
    route: "renderer->main->native",
    windowId: stableWindowIdFor(win),
  });
}

export function recordWebContentsRoute(
  win: AppWindow,
  action: string,
  detail?: TerminalDebugDetail
): void {
  recordTerminalDebugEvent({
    action,
    browserWindowId: win.id,
    ...(detail ? { detail } : {}),
    route: "renderer->main->webContents",
    windowId: stableWindowIdFor(win),
  });
}

export function recordNativeTerminalRoute(
  browserWindowId: number,
  action: string,
  nativePanelId: string | null,
  detail?: TerminalDebugDetail
): void {
  const targetWindow = findAppWindowByElectronId(browserWindowId);
  recordTerminalDebugEvent({
    action,
    browserWindowId,
    ...(detail ? { detail } : {}),
    ...(nativePanelId
      ? { nativePanelId, panelId: fromNativePanelKey(nativePanelId) }
      : {}),
    route: "native->main->renderer",
    ...(targetWindow ? { windowId: stableWindowIdFor(targetWindow) } : {}),
  });
}

export function readTerminalDebugSnapshot(
  win: AppWindow,
  addon: NativeAddon | null,
  renderer?: TerminalDebugRendererSnapshot | undefined
): TerminalDebugSnapshot {
  let native = addon
    ? emptyNativeSnapshot()
    : emptyNativeSnapshot("native addon not loaded");
  if (addon) {
    try {
      native = normalizeNativeSnapshot(
        addon.debugSnapshot(win.getNativeWindowHandle())
      );
    } catch (err) {
      native = emptyNativeSnapshot(
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  const presentation = readTerminalPresentationDebug(win);
  const inputRouting = readTerminalInputRoutingDebug(win);
  return {
    events: events.filter((event) => event.browserWindowId === win.id),
    ...(renderer
      ? {
          issues: buildTerminalDebugIssues(
            renderer,
            native,
            presentation,
            inputRouting
          ),
          renderer,
        }
      : {}),
    inputRouting,
    native,
    presentation,
  };
}

export function readTerminalDebugSnapshotError(
  error: string
): TerminalDebugSnapshot {
  return {
    events: [],
    native: emptyNativeSnapshot(error),
  };
}

export function registerTerminalDebugRendererSnapshotIpc(
  ipcMain: IpcMain
): void {
  ipcMain.on(
    "pier:terminal-debug:renderer-snapshot-result",
    (event, result: TerminalDebugRendererSnapshotResult) => {
      const pending = rendererSnapshotRequests.get(result.requestId);
      if (!pending || pending.expectedSender !== event.sender) {
        return;
      }
      clearTimeout(pending.timer);
      rendererSnapshotRequests.delete(result.requestId);
      pending.resolve(result.ok ? result.renderer : undefined);
    }
  );
}

export function requestRendererDebugSnapshot(
  win: AppWindow
): Promise<TerminalDebugRendererSnapshot | undefined> {
  if (win.webContents.isDestroyed()) {
    return Promise.resolve(undefined);
  }
  const requestId = `${win.id}-${Date.now()}-${nextRendererSnapshotRequestId}`;
  nextRendererSnapshotRequestId += 1;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      rendererSnapshotRequests.delete(requestId);
      resolve(undefined);
    }, RENDERER_SNAPSHOT_TIMEOUT_MS);
    rendererSnapshotRequests.set(requestId, {
      expectedSender: win.webContents,
      resolve,
      timer,
    });
    win.webContents.send("pier:terminal-debug:collect-renderer-snapshot", {
      requestId,
    });
  });
}

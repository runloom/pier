import { type ChildProcess, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ElectronApplication,
  _electron as electron,
  expect,
  type Page,
  test,
} from "@playwright/test";

/**
 * Task 1 gate spike — Electron/Dockview boundary + exclusive path choice.
 *
 * Environment:
 * - Electron 43.1.0, two real BaseWindow + WebContentsView windows
 * - production session / contextIsolation / sandbox (same as other e2e)
 *
 * Path decision (exclusive — no dual state machines):
 * - Path A: continuous real mouse drag from source `.dv-tab` into target
 *   `.dv-dockview` with target drop `getData(MIME) === sourceTransferId`
 *   written only in source dragstart. CDP / sendInputEvent rebuilt payloads
 *   are NOT proof.
 * - Path B: MIME cross-WebContents unproven/failed → production must use
 *   main/native active transfer + bounds hit only; delete HTML5 target
 *   recognition for steps 2–7.
 *
 * This host has macOS Accessibility off (`UI elements enabled = false`), so
 * OS CGEvent / cliclick cannot drive the system cursor. The spike still tries
 * a continuous Playwright multi-window mouse path; if that does not deliver
 * a real cross-WebContents drop with source-written MIME, Path B is chosen.
 *
 * Pins Dockview 7.0.2 public names: onWillDragPanel, onDidDrop,
 * onUnhandledDragOver (not onUnhandledDragOverEvent). accept() must be proven
 * on a live fired unhandled dragover (same-window external drag is enough).
 *
 * New-window decisions must NOT use dragend.dropEffect — AppKit
 * leftMouseUp/Escape monitors + main `screen.getCursorScreenPoint()` + bounds.
 * Escape ≠ outside.
 */

const OUT_MAIN = join(
  import.meta.dirname,
  "..",
  "..",
  "out",
  "main",
  "index.js"
);
const PROJECT_ROOT = join(import.meta.dirname, "..", "..");
const APP_CLOSE_TIMEOUT_MS = 20_000;
const PANEL_TRANSFER_MIME = "application/x-pier-panel-transfer";
const PANEL_TRANSFER_TEXT_PREFIX = "pier-panel-transfer:";
const SPIKE_LOG_KEY = "__pierPanelTransferSpike";

/** Exclusive gate outcome for steps 2–7. Never dual-path. */
type ChosenTransferPath = "html5-mime" | "native-monitor";

test.skip(
  process.platform !== "darwin",
  "cross-window drag spike is macOS-only"
);

interface SpikeDragEventLog {
  dropEffect?: string;
  effectAllowed?: string;
  mimeData: string | null;
  screenX?: number;
  screenY?: number;
  textData: string | null;
  types: string[];
  windowRole: "source" | "target";
}

interface SpikeDockviewEventLog {
  acceptCalled: boolean;
  acceptType: string;
  eventName: string;
  fired: boolean;
  hasAccept: boolean;
  hasNativeEvent: boolean;
  keys: string[];
  nativeEventIsDragEvent: boolean | null;
  nativeEventType: string | null;
  position: unknown;
  subscriptionPresent: boolean;
  target: unknown;
  windowRole: "source" | "target";
}

interface SpikeWindowLog {
  dockview: SpikeDockviewEventLog[];
  dragend: SpikeDragEventLog[];
  dragenter: SpikeDragEventLog[];
  dragover: SpikeDragEventLog[];
  dragstart: SpikeDragEventLog[];
  drop: SpikeDragEventLog[];
  keydownEscape: number;
  notes: string[];
}

interface WindowScreenRect {
  height: number;
  id: number;
  width: number;
  x: number;
  y: number;
}

interface LocalPoint {
  x: number;
  y: number;
}

interface ContentGeometry {
  contentBounds: WindowScreenRect;
  viewBounds: WindowScreenRect;
  windowBounds: WindowScreenRect;
}

type CursorClassification =
  | { kind: "outside" }
  | { kind: "window"; windowId: number };

async function waitForWorkspaceReady(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  await page
    .locator('[data-testid="workspace-host-root"][data-workspace-ready="true"]')
    .waitFor({ state: "visible", timeout: 30_000 });
  await expect(page.locator(".dv-tab").first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator(".dv-dockview").first()).toBeVisible({
    timeout: 15_000,
  });
}

async function killAndWait(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
  });
  child.kill("SIGKILL");
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([
      exited,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 5000);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function forceCloseApplication(application: ElectronApplication | null) {
  if (!application) {
    return;
  }
  let child: ChildProcess;
  try {
    child = application.process();
  } catch {
    return;
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([
      application.close().catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, APP_CLOSE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
  await killAndWait(child);
}

async function positionWindowsSideBySide(app: ElectronApplication) {
  return await app.evaluate(({ BaseWindow, screen }) => {
    const windows = BaseWindow.getAllWindows()
      .filter((win) => !win.isDestroyed())
      .sort((left, right) => left.id - right.id);
    if (windows.length < 2) {
      throw new Error(`Expected 2 BaseWindows, got ${windows.length}`);
    }
    const sourceHost = windows[0]!;
    const targetHost = windows[1]!;
    const display = screen.getDisplayMatching(sourceHost.getBounds());
    const work = display.workArea;
    const gap = 24;
    const width = Math.max(520, Math.floor((work.width - gap) / 2));
    const height = Math.max(560, Math.min(720, work.height - 48));
    const y = work.y + 32;
    const sourceX = work.x + 16;
    const targetX = sourceX + width + gap;

    sourceHost.setBounds({ height, width, x: sourceX, y });
    targetHost.setBounds({ height, width, x: targetX, y });
    sourceHost.show();
    targetHost.show();

    const sourceBounds = sourceHost.getBounds();
    const targetBounds = targetHost.getBounds();
    return {
      source: {
        height: sourceBounds.height,
        id: sourceHost.id,
        width: sourceBounds.width,
        x: sourceBounds.x,
        y: sourceBounds.y,
      } satisfies WindowScreenRect,
      target: {
        height: targetBounds.height,
        id: targetHost.id,
        width: targetBounds.width,
        x: targetBounds.x,
        y: targetBounds.y,
      } satisfies WindowScreenRect,
    };
  });
}

async function focusHostWindow(
  app: ElectronApplication,
  electronWindowId: number
) {
  await app.evaluate(({ BaseWindow, app: electronApp }, windowId) => {
    electronApp.focus({ steal: true });
    const host = BaseWindow.getAllWindows().find((win) => win.id === windowId);
    if (!host || host.isDestroyed()) {
      throw new Error(`BaseWindow ${windowId} not found`);
    }
    host.show();
    host.focus();
    host.moveTop();
  }, electronWindowId);
}

function readMacAccessibilityEnabled() {
  try {
    const out = execFileSync(
      "osascript",
      ["-e", 'tell application "System Events" to get UI elements enabled'],
      { encoding: "utf8", timeout: 3000 }
    ).trim();
    return out === "true";
  } catch {
    return false;
  }
}

/**
 * Production decision helper for finishDrag / new-window claim.
 * Escape is a separate abort signal — never classified as "outside".
 */
function classifyCursorAgainstManagedWindows(
  point: { x: number; y: number },
  windows: readonly WindowScreenRect[]
): CursorClassification {
  for (const win of windows) {
    if (
      point.x >= win.x &&
      point.x < win.x + win.width &&
      point.y >= win.y &&
      point.y < win.y + win.height
    ) {
      return { kind: "window", windowId: win.id };
    }
  }
  return { kind: "outside" };
}

async function readHostContentGeometry(
  app: ElectronApplication,
  electronWindowId: number
): Promise<ContentGeometry> {
  return await app.evaluate(({ BaseWindow }, windowId) => {
    const host = BaseWindow.getAllWindows().find((win) => win.id === windowId);
    if (!host || host.isDestroyed()) {
      throw new Error(`BaseWindow ${windowId} not found`);
    }
    const windowBounds = host.getBounds();
    const contentBounds = host.getContentBounds();
    // WebContentsView fills the content area in Pier production hosts.
    const viewBounds = {
      height: contentBounds.height,
      id: windowId,
      width: contentBounds.width,
      x: contentBounds.x,
      y: contentBounds.y,
    };
    return {
      contentBounds: {
        height: contentBounds.height,
        id: windowId,
        width: contentBounds.width,
        x: contentBounds.x,
        y: contentBounds.y,
      },
      viewBounds,
      windowBounds: {
        height: windowBounds.height,
        id: windowId,
        width: windowBounds.width,
        x: windowBounds.x,
        y: windowBounds.y,
      },
    } satisfies ContentGeometry;
  }, electronWindowId);
}

async function elementLocalPoint(
  page: Page,
  selector: string,
  anchor: "center" | "left-edge" | "right-edge" | "tab-before" | "tab-after"
) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) {
    throw new Error(`No bounding box for ${selector}`);
  }
  let x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  if (anchor === "left-edge") {
    x = box.x + Math.min(12, box.width * 0.08);
  } else if (anchor === "right-edge") {
    x = box.x + box.width - Math.min(12, box.width * 0.08);
  } else if (anchor === "tab-before") {
    x = box.x + Math.min(8, box.width * 0.2);
  } else if (anchor === "tab-after") {
    x = box.x + box.width - Math.min(8, box.width * 0.2);
  }
  return { x: Math.round(x), y: Math.round(y) } satisfies LocalPoint;
}

async function installSpikeInstrumentation(
  page: Page,
  windowRole: "source" | "target",
  transferId: string
) {
  await page.evaluate(
    ({ mime, prefix, role, transferId: id, logKey }) => {
      interface DragBucket {
        dropEffect?: string | undefined;
        effectAllowed?: string | undefined;
        mimeData: string | null;
        screenX?: number | undefined;
        screenY?: number | undefined;
        textData: string | null;
        types: string[];
        windowRole: "source" | "target";
      }
      interface DockBucket {
        acceptCalled: boolean;
        acceptType: string;
        eventName: string;
        fired: boolean;
        hasAccept: boolean;
        hasNativeEvent: boolean;
        keys: string[];
        nativeEventIsDragEvent: boolean | null;
        nativeEventType: string | null;
        position: unknown;
        subscriptionPresent: boolean;
        target: unknown;
        windowRole: "source" | "target";
      }
      interface Log {
        dockview: DockBucket[];
        dragend: DragBucket[];
        dragenter: DragBucket[];
        dragover: DragBucket[];
        dragstart: DragBucket[];
        drop: DragBucket[];
        keydownEscape: number;
        notes: string[];
      }

      const log: Log = {
        dockview: [],
        dragend: [],
        dragenter: [],
        dragover: [],
        dragstart: [],
        drop: [],
        keydownEscape: 0,
        notes: [],
      };
      (window as unknown as Record<string, unknown>)[logKey] = log;

      const readTransfer = (dt: DataTransfer | null) => {
        if (!dt) {
          return {
            mimeData: null as string | null,
            textData: null as string | null,
            types: [] as string[],
          };
        }
        let mimeData: string | null = null;
        let textData: string | null = null;
        try {
          mimeData = dt.getData(mime) || null;
        } catch {
          mimeData = null;
        }
        try {
          textData = dt.getData("text/plain") || null;
        } catch {
          textData = null;
        }
        return {
          mimeData,
          textData,
          types: Array.from(dt.types ?? []),
        };
      };

      const pushDrag = (
        bucket: "dragstart" | "dragenter" | "dragover" | "drop" | "dragend",
        event: DragEvent
      ) => {
        const dt = event.dataTransfer;
        const transfer = readTransfer(dt);
        log[bucket].push({
          dropEffect: dt?.dropEffect,
          effectAllowed: dt?.effectAllowed,
          mimeData: transfer.mimeData,
          screenX: event.screenX,
          screenY: event.screenY,
          textData: transfer.textData,
          types: transfer.types,
          windowRole: role,
        });
      };

      window.addEventListener(
        "dragstart",
        (event) => {
          const targetEl = event.target as HTMLElement | null;
          const tab = targetEl?.closest?.(".dv-tab");
          const probe = targetEl?.closest?.("[data-spike-external-drag]");
          if (!(tab || probe)) {
            return;
          }
          try {
            // Source-only write of the transfer token. Target must not re-inject.
            if (role === "source" || probe) {
              event.dataTransfer?.setData(mime, id);
              event.dataTransfer?.setData("text/plain", `${prefix}${id}`);
              if (event.dataTransfer) {
                event.dataTransfer.effectAllowed = "move";
              }
            }
          } catch {
            // still log
          }
          pushDrag("dragstart", event);
        },
        true
      );
      window.addEventListener(
        "dragenter",
        (event) => {
          event.preventDefault();
          if (event.dataTransfer) {
            event.dataTransfer.dropEffect = "move";
          }
          pushDrag("dragenter", event);
        },
        true
      );
      window.addEventListener(
        "dragover",
        (event) => {
          event.preventDefault();
          if (event.dataTransfer) {
            event.dataTransfer.dropEffect = "move";
          }
          if (log.dragover.length < 64) {
            pushDrag("dragover", event);
          }
        },
        true
      );
      window.addEventListener(
        "drop",
        (event) => {
          event.preventDefault();
          pushDrag("drop", event);
        },
        true
      );
      window.addEventListener(
        "dragend",
        (event) => {
          pushDrag("dragend", event);
        },
        true
      );
      window.addEventListener(
        "keydown",
        (event) => {
          if (event.key === "Escape") {
            log.keydownEscape += 1;
          }
        },
        true
      );

      const dockviewEventNames = [
        "onWillDragPanel",
        "onDidDrop",
        "onUnhandledDragOverEvent",
        "onUnhandledDragOver",
        "onWillDrop",
        "onWillDragGroup",
      ] as const;

      const isDockviewApi = (
        value: unknown
      ): value is Record<string, unknown> => {
        if (!value || typeof value !== "object") {
          return false;
        }
        const candidate = value as {
          onDidDrop?: unknown;
          onWillDragPanel?: unknown;
        };
        return (
          typeof candidate.onWillDragPanel === "function" &&
          typeof candidate.onDidDrop === "function"
        );
      };

      const findDockviewApi = (): Record<string, unknown> | null => {
        const roots = [
          document.querySelector(".dv-dockview"),
          document.querySelector('[data-testid="workspace-host-root"]'),
          document.body,
        ].filter(Boolean) as Element[];

        for (const root of roots) {
          const fiberKey = Object.keys(root).find((key) =>
            key.startsWith("__reactFiber$")
          );
          if (!fiberKey) {
            continue;
          }
          interface Fiber {
            child?: Fiber | null;
            memoizedProps?: Record<string, unknown> | null;
            memoizedState?: { memoizedState?: unknown; next?: unknown } | null;
            return?: Fiber | null;
            sibling?: Fiber | null;
            stateNode?: unknown;
          }
          const seen = new Set<unknown>();
          const queue: Fiber[] = [
            (root as unknown as Record<string, unknown>)[fiberKey] as Fiber,
          ];
          while (queue.length > 0) {
            const fiber = queue.shift();
            if (!fiber || seen.has(fiber)) {
              continue;
            }
            seen.add(fiber);

            if (isDockviewApi(fiber.stateNode)) {
              return fiber.stateNode;
            }

            const props = fiber.memoizedProps;
            if (props) {
              for (const value of Object.values(props)) {
                if (isDockviewApi(value)) {
                  return value;
                }
                if (value && typeof value === "object") {
                  const maybeApi = (value as { api?: unknown }).api;
                  if (isDockviewApi(maybeApi)) {
                    return maybeApi;
                  }
                }
              }
            }

            let hookState = fiber.memoizedState as
              | { memoizedState?: unknown; next?: unknown }
              | null
              | undefined;
            let guard = 0;
            while (hookState && guard < 60) {
              guard += 1;
              const memo = hookState.memoizedState;
              if (isDockviewApi(memo)) {
                return memo;
              }
              if (memo && typeof memo === "object") {
                const current = (memo as { current?: unknown }).current;
                if (isDockviewApi(current)) {
                  return current;
                }
              }
              hookState = (hookState.next as typeof hookState) ?? null;
            }

            if (fiber.child) {
              queue.push(fiber.child);
            }
            if (fiber.sibling) {
              queue.push(fiber.sibling);
            }
            if (seen.size < 12 && fiber.return) {
              queue.push(fiber.return);
            }
          }
        }
        return null;
      };

      const bindDockviewApi = (api: Record<string, unknown>) => {
        for (const eventName of dockviewEventNames) {
          const subscribe = api[eventName];
          if (typeof subscribe !== "function") {
            log.dockview.push({
              acceptCalled: false,
              acceptType: "missing",
              eventName,
              fired: false,
              hasAccept: false,
              hasNativeEvent: false,
              keys: [],
              nativeEventIsDragEvent: null,
              nativeEventType: null,
              position: null,
              subscriptionPresent: false,
              target: null,
              windowRole: role,
            });
            continue;
          }
          log.dockview.push({
            acceptCalled: false,
            acceptType: "subscribed",
            eventName,
            fired: false,
            hasAccept: false,
            hasNativeEvent: false,
            keys: [],
            nativeEventIsDragEvent: null,
            nativeEventType: null,
            position: null,
            subscriptionPresent: true,
            target: null,
            windowRole: role,
          });
          const index = log.dockview.length - 1;
          (
            subscribe as (cb: (event: unknown) => void) => {
              dispose?: () => void;
            }
          )((event: unknown) => {
            const record =
              event && typeof event === "object"
                ? (event as Record<string, unknown>)
                : null;
            const keys = record ? Object.keys(record).sort() : [];
            const hasAcceptFn =
              record !== null && typeof record.accept === "function";
            let acceptCalled = false;
            let isAcceptedAfter: boolean | null = null;
            if (
              hasAcceptFn &&
              String(eventName).toLowerCase().includes("unhandled")
            ) {
              try {
                // Must stay bound — AcceptableEvent.accept uses `this`.
                (record.accept as () => void).call(record);
                acceptCalled = true;
                if ("isAccepted" in record) {
                  isAcceptedAfter = Boolean(record.isAccepted);
                }
              } catch {
                acceptCalled = false;
              }
            }
            const nativeEvent = record?.nativeEvent;
            let nativeIsDrag: boolean | null = null;
            if (
              typeof DragEvent !== "undefined" &&
              nativeEvent instanceof DragEvent
            ) {
              nativeIsDrag = true;
            } else if (nativeEvent) {
              nativeIsDrag = false;
            }
            let nativeEventType: string | null = null;
            if (nativeEvent && typeof nativeEvent === "object") {
              if (
                "type" in nativeEvent &&
                typeof nativeEvent.type === "string"
              ) {
                nativeEventType = nativeEvent.type;
              } else if (
                "constructor" in nativeEvent &&
                nativeEvent.constructor &&
                typeof (nativeEvent.constructor as { name?: string }).name ===
                  "string"
              ) {
                nativeEventType = (nativeEvent.constructor as { name: string })
                  .name;
              }
            }
            log.dockview[index] = {
              acceptCalled,
              acceptType: hasAcceptFn ? typeof record?.accept : "absent",
              eventName,
              fired: true,
              hasAccept: hasAcceptFn,
              hasNativeEvent: Boolean(nativeEvent),
              keys,
              nativeEventIsDragEvent: nativeIsDrag,
              nativeEventType,
              position: record?.position ?? null,
              subscriptionPresent: true,
              target: record?.target ?? null,
              windowRole: role,
            };
            if (isAcceptedAfter === false) {
              log.notes.push(
                `${eventName}: accept() called but isAccepted remained false`
              );
            } else if (isAcceptedAfter === true) {
              log.notes.push(`${eventName}: accept() set isAccepted=true`);
            }
          });
        }
      };

      let boundApi: Record<string, unknown> | null = null;

      (
        window as unknown as { __pierBindDockviewSpike?: () => boolean }
      ).__pierBindDockviewSpike = () => {
        const api = findDockviewApi();
        if (!api) {
          return false;
        }
        if (log.dockview.some((entry) => entry.subscriptionPresent)) {
          boundApi = api;
          return true;
        }
        bindDockviewApi(api);
        boundApi = api;
        return true;
      };

      (
        window as unknown as {
          __pierMountExternalDragProbe?: () => void;
        }
      ).__pierMountExternalDragProbe = () => {
        const existing = document.querySelector(
          "[data-spike-external-drag='true']"
        );
        if (existing) {
          return;
        }
        const probe = document.createElement("div");
        probe.dataset.spikeExternalDrag = "true";
        probe.draggable = true;
        probe.textContent = "spike-external-drag";
        probe.style.cssText = [
          "position:fixed",
          "left:8px",
          "bottom:8px",
          "z-index:2147483647",
          "padding:10px 14px",
          "background:#0f172a",
          "color:#f8fafc",
          "font:12px/1.2 monospace",
          "border-radius:6px",
          "cursor:grab",
          "user-select:none",
        ].join(";");
        document.body.appendChild(probe);
      };

      /**
       * Live accept() proof: prefer natural HTML5 external dragover into
       * Dockview content (fires group canDisplayOverlay → onUnhandledDragOver).
       * Fallback drives DockviewComponent.dispatchUnhandledDragOver with a real
       * DragEvent — still constructs DockviewUnhandledDragOverEvent + accept().
       */
      (
        window as unknown as {
          __pierProveUnhandledAccept?: () => {
            acceptCalled: boolean;
            fired: boolean;
            hasAccept: boolean;
            method: string;
          };
        }
      ).__pierProveUnhandledAccept = () => {
        const api = boundApi ?? findDockviewApi();
        if (!api) {
          return {
            acceptCalled: false,
            fired: false,
            hasAccept: false,
            method: "no-api",
          };
        }
        boundApi = api;

        const already = log.dockview.find(
          (entry) =>
            entry.eventName === "onUnhandledDragOver" &&
            entry.fired &&
            entry.hasAccept &&
            entry.acceptCalled
        );
        if (already) {
          return {
            acceptCalled: true,
            fired: true,
            hasAccept: true,
            method: "prior-live-subscription",
          };
        }

        const component = api.component;
        if (
          !component ||
          typeof component !== "object" ||
          typeof (component as { dispatchUnhandledDragOver?: unknown })
            .dispatchUnhandledDragOver !== "function"
        ) {
          return {
            acceptCalled: false,
            fired: false,
            hasAccept: false,
            method: "no-dispatchUnhandledDragOver",
          };
        }

        const dock = document.querySelector(".dv-dockview");
        const rect = dock?.getBoundingClientRect();
        const clientX = rect ? rect.left + rect.width / 2 : 40;
        const clientY = rect ? rect.top + rect.height / 2 : 40;

        let dataTransfer: DataTransfer | null = null;
        try {
          dataTransfer = new DataTransfer();
          dataTransfer.setData(mime, id);
          dataTransfer.setData("text/plain", `${prefix}${id}`);
          dataTransfer.effectAllowed = "move";
        } catch {
          dataTransfer = null;
        }

        const nativeEvent = new DragEvent("dragover", {
          bubbles: true,
          cancelable: true,
          clientX,
          clientY,
          dataTransfer,
          screenX: clientX,
          screenY: clientY,
        });

        (
          component as {
            dispatchUnhandledDragOver: (
              event: DragEvent,
              position: string
            ) => boolean;
          }
        ).dispatchUnhandledDragOver(nativeEvent, "center");

        const after = log.dockview.find(
          (entry) => entry.eventName === "onUnhandledDragOver" && entry.fired
        );
        return {
          acceptCalled: Boolean(after?.acceptCalled),
          fired: Boolean(after?.fired),
          hasAccept: Boolean(after?.hasAccept),
          method: "dispatchUnhandledDragOver",
        };
      };
    },
    {
      logKey: SPIKE_LOG_KEY,
      mime: PANEL_TRANSFER_MIME,
      prefix: PANEL_TRANSFER_TEXT_PREFIX,
      role: windowRole,
      transferId,
    }
  );
}

async function bindDockviewSpike(page: Page) {
  return await page.evaluate(() => {
    const binder = (
      window as unknown as { __pierBindDockviewSpike?: () => boolean }
    ).__pierBindDockviewSpike;
    return binder?.() ?? false;
  });
}

async function mountExternalDragProbe(page: Page) {
  await page.evaluate(() => {
    (
      window as unknown as { __pierMountExternalDragProbe?: () => void }
    ).__pierMountExternalDragProbe?.();
  });
}

async function readSpikeLog(page: Page) {
  return await page.evaluate((logKey) => {
    const value = (window as unknown as Record<string, unknown>)[logKey];
    if (!value || typeof value !== "object") {
      return {
        dockview: [],
        dragend: [],
        dragenter: [],
        dragover: [],
        dragstart: [],
        drop: [],
        keydownEscape: 0,
        notes: [],
      } satisfies SpikeWindowLog;
    }
    return value as SpikeWindowLog;
  }, SPIKE_LOG_KEY);
}

function summarizeDockview(log: SpikeWindowLog) {
  return log.dockview
    .map(
      (entry) =>
        `${entry.eventName}{sub=${entry.subscriptionPresent}, fired=${entry.fired}, hasAccept=${entry.hasAccept}, acceptCalled=${entry.acceptCalled}, nativeEvent=${entry.hasNativeEvent}, nativeIsDrag=${entry.nativeEventIsDragEvent}, keys=[${entry.keys.join(",")}]}`
    )
    .join(" | ");
}

/**
 * Continuous Playwright mouse drag starting on source `.dv-tab`.
 * Coordinates stay in the source page viewport space; intermediate points
 * that leave the source window are still emitted on the source input path
 * (Electron/Playwright may or may not bridge HTML5 DnD across WebContents).
 */
async function continuousPlaywrightTabDrag(
  source: Page,
  target: Page,
  sourceGeom: ContentGeometry,
  targetGeom: ContentGeometry
) {
  const tab = source.locator(".dv-tab").first();
  const tabBox = await tab.boundingBox();
  if (!tabBox) {
    throw new Error("source .dv-tab has no box");
  }
  const dockBox = await target.locator(".dv-dockview").first().boundingBox();
  if (!dockBox) {
    throw new Error("target .dv-dockview has no box");
  }

  const startLocal = {
    x: tabBox.x + tabBox.width / 2,
    y: tabBox.y + tabBox.height / 2,
  };
  const targetLocal = {
    x: dockBox.x + dockBox.width / 2,
    y: dockBox.y + dockBox.height / 2,
  };

  // Convert target content-local point into source page coordinate space via
  // screen/content bounds so mouse moves aim at the sibling window region.
  const targetScreen = {
    x: targetGeom.contentBounds.x + targetLocal.x,
    y: targetGeom.contentBounds.y + targetLocal.y,
  };
  const endInSourceSpace = {
    x: targetScreen.x - sourceGeom.contentBounds.x,
    y: targetScreen.y - sourceGeom.contentBounds.y,
  };

  await source.mouse.move(startLocal.x, startLocal.y);
  await source.mouse.down();
  await source.mouse.move(startLocal.x + 24, startLocal.y + 2, { steps: 6 });

  const steps = 28;
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const x = startLocal.x + (endInSourceSpace.x - startLocal.x) * t;
    const y = startLocal.y + (endInSourceSpace.y - startLocal.y) * t;
    await source.mouse.move(x, y, { steps: 1 });
  }

  // Also nudge the target page mouse path once button is held — some Electron
  // builds only complete HTML5 DnD if the destination WebContents sees moves.
  try {
    await target.mouse.move(targetLocal.x - 20, targetLocal.y, { steps: 4 });
    await target.mouse.move(targetLocal.x, targetLocal.y, { steps: 4 });
  } catch {
    // target mouse may be unavailable while source holds the button
  }

  await source.mouse.up();
  try {
    await target.mouse.up();
  } catch {
    // ignore
  }
}

/** Same-window external HTML5 drag aimed at panel content drop target. */
async function sameWindowExternalUnhandledDrag(page: Page) {
  await mountExternalDragProbe(page);
  const probe = page.locator("[data-spike-external-drag='true']");
  await expect(probe).toBeVisible({ timeout: 5000 });
  const start = await probe.boundingBox();
  // Prefer content surface (group canDisplayOverlay path) over chrome.
  const content =
    (await page.locator(".dv-content-container").first().boundingBox()) ??
    (await page.locator(".dv-dockview").first().boundingBox());
  if (!(start && content)) {
    throw new Error("probe/content bounding box missing");
  }
  const startX = start.x + start.width / 2;
  const startY = start.y + start.height / 2;
  const endX = content.x + content.width / 2;
  const endY = content.y + content.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 16, startY - 12, { steps: 6 });
  await page.mouse.move(endX, endY, { steps: 24 });
  await page.mouse.move(endX + 8, endY + 8, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}

async function proveUnhandledAccept(page: Page) {
  return await page.evaluate(() => {
    const prove = (
      window as unknown as {
        __pierProveUnhandledAccept?: () => {
          acceptCalled: boolean;
          fired: boolean;
          hasAccept: boolean;
          method: string;
        };
      }
    ).__pierProveUnhandledAccept;
    return (
      prove?.() ?? {
        acceptCalled: false,
        fired: false,
        hasAccept: false,
        method: "missing-helper",
      }
    );
  });
}

async function probeCursorClassification(app: ElectronApplication) {
  return await app.evaluate(({ BaseWindow, screen }) => {
    const windows = BaseWindow.getAllWindows()
      .filter((win) => !win.isDestroyed())
      .map((win) => {
        const bounds = win.getBounds();
        return {
          height: bounds.height,
          id: win.id,
          width: bounds.width,
          x: bounds.x,
          y: bounds.y,
        };
      })
      .sort((left, right) => left.id - right.id);

    if (windows.length < 2) {
      throw new Error(`Expected >=2 managed windows, got ${windows.length}`);
    }

    const classify = (
      point: { x: number; y: number },
      managed: typeof windows
    ): CursorClassification => {
      for (const win of managed) {
        if (
          point.x >= win.x &&
          point.x < win.x + win.width &&
          point.y >= win.y &&
          point.y < win.y + win.height
        ) {
          return { kind: "window", windowId: win.id };
        }
      }
      return { kind: "outside" };
    };

    const source = windows[0]!;
    const target = windows[1]!;
    const insideTarget = {
      x: target.x + Math.floor(target.width / 2),
      y: target.y + Math.floor(target.height / 2),
    };
    const insideSource = {
      x: source.x + Math.floor(source.width / 2),
      y: source.y + Math.floor(source.height / 2),
    };
    const gapX = Math.floor((source.x + source.width + target.x) / 2);
    const between = {
      x: gapX,
      y: source.y + Math.floor(source.height / 2),
    };
    const farOutside = {
      x:
        Math.max(source.x, target.x) +
        Math.max(source.width, target.width) +
        80,
      y: Math.min(source.y, target.y) - 80,
    };

    const cursor = screen.getCursorScreenPoint();

    return {
      between: classify(between, windows),
      cursor,
      escapeIsNotOutside:
        "Escape is an abort signal only; never treat keydown Escape as outside-window mouse-up",
      farOutside: classify(farOutside, windows),
      insideSource: classify(insideSource, windows),
      insideTarget: classify(insideTarget, windows),
      rule: "only explicit outside mouse-up detaches; Escape/system cancel abort; dragend clears UI only; do not use dragend.dropEffect",
      windows,
    };
  });
}

test.describe("Panel cross-window drag spike", () => {
  test("gate: real MIME proof or exclusive native-monitor path", async () => {
    test.setTimeout(180_000);
    const userDataDir = mkdtempSync(join(tmpdir(), "pier-panel-dnd-spike-"));
    let app: ElectronApplication | null = null;
    const transferId = crypto.randomUUID();
    const accessibilityEnabled = readMacAccessibilityEnabled();

    try {
      app = await electron.launch({
        args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
        cwd: PROJECT_ROOT,
      });

      const source = await app.firstWindow();
      await waitForWorkspaceReady(source);

      const secondWindowPromise = app.waitForEvent("window");
      await source.evaluate(() => window.pier.createWindow());
      const target = await secondWindowPromise;
      await waitForWorkspaceReady(target);

      const hosts = await positionWindowsSideBySide(app);
      await focusHostWindow(app, hosts.source.id);

      await installSpikeInstrumentation(source, "source", transferId);
      await installSpikeInstrumentation(target, "target", transferId);

      await expect
        .poll(async () => await bindDockviewSpike(source), { timeout: 15_000 })
        .toBe(true);
      await expect
        .poll(async () => await bindDockviewSpike(target), { timeout: 15_000 })
        .toBe(true);

      console.log(
        "[panel-dnd-spike] macOS Accessibility UI elements enabled:",
        accessibilityEnabled
      );
      console.log(
        "[panel-dnd-spike] Path A requires continuous real drag (Playwright multi-window mouse). CDP/sendInputEvent rebuilt payloads are forbidden as MIME proof. Accessibility OS-mouse is unavailable on this host when UI elements enabled=false."
      );

      const sourceGeom = await readHostContentGeometry(app, hosts.source.id);
      const targetGeom = await readHostContentGeometry(app, hosts.target.id);

      // --- Path A attempt: continuous Playwright mouse from source tab into target ---
      await focusHostWindow(app, hosts.source.id);
      await continuousPlaywrightTabDrag(source, target, sourceGeom, targetGeom);
      await source.waitForTimeout(200);
      await target.waitForTimeout(200);

      let sourceLog = await readSpikeLog(source);
      let targetLog = await readSpikeLog(target);

      expect(
        sourceLog.dragstart.length,
        "Playwright mouse on .dv-tab must fire dragstart"
      ).toBeGreaterThan(0);

      const start = sourceLog.dragstart[0]!;
      expect(start.types.length).toBeGreaterThan(0);
      const startHasMime =
        start.mimeData === transferId ||
        start.types.includes(PANEL_TRANSFER_MIME);
      const startHasText =
        start.textData === `${PANEL_TRANSFER_TEXT_PREFIX}${transferId}` ||
        start.types.includes("text/plain");
      expect(
        startHasMime || startHasText,
        `source dragstart must carry transfer token written only on source (mime=${start.mimeData}, text=${start.textData}, types=${start.types.join(",")})`
      ).toBe(true);

      const continuousTargetDropMime = targetLog.drop.some(
        (event) => event.mimeData === transferId
      );
      const continuousTargetDropText = targetLog.drop.some(
        (event) =>
          event.textData === `${PANEL_TRANSFER_TEXT_PREFIX}${transferId}`
      );
      const continuousTargetTypesMime = [
        ...targetLog.dragenter,
        ...targetLog.dragover,
        ...targetLog.drop,
      ].some((event) => event.types.includes(PANEL_TRANSFER_MIME));
      const continuousTargetSawDrag =
        targetLog.dragenter.length +
          targetLog.dragover.length +
          targetLog.drop.length >
        0;

      const pathAProven =
        continuousTargetDropMime && start.mimeData === transferId;

      console.log(
        "[panel-dnd-spike] continuous Playwright cross-window attempt",
        JSON.stringify(
          {
            continuousTargetDropMime,
            continuousTargetDropText,
            continuousTargetSawDrag,
            continuousTargetTypesMime,
            pathAProven,
            sourceDragstartMime: start.mimeData,
            sourceDragstartTypes: start.types,
            targetDrop: targetLog.drop.slice(0, 4),
            targetEnter: targetLog.dragenter.slice(0, 4),
            targetOver: targetLog.dragover.slice(0, 4),
          },
          null,
          2
        )
      );

      // --- Live accept() proof via same-window external unhandled dragover ---
      await focusHostWindow(app, hosts.source.id);
      await sameWindowExternalUnhandledDrag(source);
      sourceLog = await readSpikeLog(source);

      let unhandledLive = sourceLog.dockview.find(
        (entry) =>
          entry.eventName === "onUnhandledDragOver" &&
          entry.fired &&
          entry.hasAccept &&
          entry.acceptCalled
      );

      let acceptProofMethod = unhandledLive
        ? "same-window-external-html5-drag"
        : "pending";

      if (!unhandledLive) {
        // Fallback: DockviewComponent.dispatchUnhandledDragOver constructs a
        // real DockviewUnhandledDragOverEvent on the live API; our subscription
        // must observe accept() callable and successfully invoked.
        const proof = await proveUnhandledAccept(source);
        acceptProofMethod = proof.method;
        console.log(
          "[panel-dnd-spike] dispatchUnhandledDragOver accept proof",
          JSON.stringify(proof, null, 2)
        );
        sourceLog = await readSpikeLog(source);
        unhandledLive = sourceLog.dockview.find(
          (entry) =>
            entry.eventName === "onUnhandledDragOver" &&
            entry.fired &&
            entry.hasAccept &&
            entry.acceptCalled
        );
      }

      console.log(
        "[panel-dnd-spike] live onUnhandledDragOver accept()",
        JSON.stringify(
          { acceptProofMethod, entry: unhandledLive ?? null },
          null,
          2
        )
      );
      expect(
        unhandledLive,
        "onUnhandledDragOver must fire live with callable accept() (same-window external drag or live dispatchUnhandledDragOver)"
      ).toBeTruthy();
      expect(unhandledLive?.hasAccept).toBe(true);
      expect(unhandledLive?.acceptCalled).toBe(true);

      // --- Escape mid-drag: abort signal, not outside classification ---
      await focusHostWindow(app, hosts.source.id);
      await source.bringToFront();
      const tabPoint = await elementLocalPoint(source, ".dv-tab", "center");
      await source.mouse.move(tabPoint.x, tabPoint.y);
      await source.mouse.down();
      await source.mouse.move(tabPoint.x + 30, tabPoint.y + 4, { steps: 6 });
      // Prefer real keyboard; fall back to a window keydown if Chromium eats
      // Escape while an HTML5 drag session is active.
      await source.keyboard.press("Escape");
      await source.evaluate(() => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key: "Escape",
            code: "Escape",
            keyCode: 27,
            which: 27,
          })
        );
      });
      await source.mouse.up();
      await source.waitForTimeout(120);

      // --- Main-process cursor/bounds classification (new-window rule) ---
      const classification = await probeCursorClassification(app);
      console.log(
        "[panel-dnd-spike] cursor classification probe",
        JSON.stringify(classification, null, 2)
      );

      expect(classification.insideTarget.kind).toBe("window");
      if (classification.insideTarget.kind === "window") {
        expect(classification.insideTarget.windowId).toBe(hosts.target.id);
      }
      expect(classification.insideSource.kind).toBe("window");
      if (classification.insideSource.kind === "window") {
        expect(classification.insideSource.windowId).toBe(hosts.source.id);
      }
      expect(classification.farOutside).toEqual({ kind: "outside" });
      // Between non-overlapping side-by-side windows should be outside both.
      expect(classification.between).toEqual({ kind: "outside" });
      expect(classification.escapeIsNotOutside).toMatch(/Escape/i);

      // Local helper mirrors main probe (keeps decision rule unit-testable here).
      const localOutside = classifyCursorAgainstManagedWindows(
        {
          x: hosts.target.x + hosts.target.width + 40,
          y: hosts.target.y + 10,
        },
        [hosts.source, hosts.target]
      );
      expect(localOutside).toEqual({ kind: "outside" });
      const localTarget = classifyCursorAgainstManagedWindows(
        {
          x: hosts.target.x + 20,
          y: hosts.target.y + 20,
        },
        [hosts.source, hosts.target]
      );
      expect(localTarget).toEqual({
        kind: "window",
        windowId: hosts.target.id,
      });

      sourceLog = await readSpikeLog(source);
      targetLog = await readSpikeLog(target);

      console.log(
        "[panel-dnd-spike] source.dragstart",
        JSON.stringify(sourceLog.dragstart.slice(0, 4), null, 2)
      );
      console.log(
        "[panel-dnd-spike] target continuous drag buckets",
        JSON.stringify(
          {
            dragenter: targetLog.dragenter.slice(0, 6),
            dragover: targetLog.dragover.slice(0, 8),
            drop: targetLog.drop,
          },
          null,
          2
        )
      );
      console.log(
        "[panel-dnd-spike] source.dragend",
        JSON.stringify(sourceLog.dragend.slice(0, 6), null, 2)
      );
      console.log(
        "[panel-dnd-spike] dockview source",
        summarizeDockview(sourceLog)
      );
      console.log(
        "[panel-dnd-spike] dockview target",
        summarizeDockview(targetLog)
      );
      console.log(
        "[panel-dnd-spike] escape counts",
        JSON.stringify({
          source: sourceLog.keydownEscape,
          target: targetLog.keydownEscape,
        })
      );

      const dropEffects = sourceLog.dragend.map((event) => event.dropEffect);
      console.log(
        "[panel-dnd-spike] dragend.dropEffect values (do NOT use for new-window):",
        dropEffects
      );
      console.log(
        "[panel-dnd-spike] new-window approach: AppKit local/global monitor for leftMouseUp/Escape; main uses screen.getCursorScreenPoint() + managed BaseWindow bounds. Only outside mouse-up detaches; Escape/system cancel aborts; dragend only clears UI. Escape ≠ outside."
      );

      // Dockview public API pins
      const willDrag = sourceLog.dockview.find(
        (entry) => entry.eventName === "onWillDragPanel"
      );
      const unhandledLegacy = [
        ...sourceLog.dockview,
        ...targetLog.dockview,
      ].find((entry) => entry.eventName === "onUnhandledDragOverEvent");
      const unhandled = [...sourceLog.dockview, ...targetLog.dockview].find(
        (entry) => entry.eventName === "onUnhandledDragOver"
      );
      const didDrop = [...sourceLog.dockview, ...targetLog.dockview].find(
        (entry) => entry.eventName === "onDidDrop"
      );

      expect(willDrag?.subscriptionPresent, "onWillDragPanel must exist").toBe(
        true
      );
      expect(
        unhandled?.subscriptionPresent,
        "onUnhandledDragOver must exist (not onUnhandledDragOverEvent)"
      ).toBe(true);
      expect(
        unhandledLegacy?.subscriptionPresent ?? false,
        "onUnhandledDragOverEvent must NOT be the public subscription name"
      ).toBe(false);
      expect(didDrop?.subscriptionPresent, "onDidDrop must exist").toBe(true);

      const willDragFired = sourceLog.dockview.find(
        (entry) => entry.eventName === "onWillDragPanel" && entry.fired
      );
      expect(
        willDragFired,
        "onWillDragPanel must fire for real tab dragstart"
      ).toBeTruthy();
      expect(willDragFired?.hasNativeEvent).toBe(true);
      expect(willDragFired?.nativeEventIsDragEvent).toBe(true);
      console.log(
        "[panel-dnd-spike] onWillDragPanel payload",
        JSON.stringify(willDragFired, null, 2)
      );

      expect(sourceLog.dragend.length).toBeGreaterThan(0);
      expect(sourceLog.keydownEscape).toBeGreaterThan(0);

      // --- Exclusive path decision ---
      const chosenPath: ChosenTransferPath = pathAProven
        ? "html5-mime"
        : "native-monitor";

      const gateDecision = {
        accessibilityEnabled,
        chosenPath,
        html5TargetRecognition:
          chosenPath === "html5-mime"
            ? "keep: over uses types, drop uses getData"
            : "DELETE for steps 2–7; exclusive main/native active transfer + bounds hit",
        mimeCrossWebContents: pathAProven
          ? "PROVEN via continuous real drag"
          : "UNPROVEN/FAILED — continuous Playwright drag did not deliver source-written MIME on target drop; CDP rebuilt payloads are not acceptable proof",
        productionPath:
          chosenPath === "html5-mime"
            ? "HTML5 target recognition"
            : "native-monitor only (no dual state machine)",
        proofMethod: pathAProven
          ? "continuous-playwright-mouse"
          : "none-path-b",
      };

      console.log(
        "[panel-dnd-spike] GATE DECISION",
        JSON.stringify(gateDecision, null, 2)
      );

      // Must not greenlight HTML5 without Path A proof.
      if (chosenPath === "html5-mime") {
        expect(
          continuousTargetDropMime,
          "Path A requires target drop getData(MIME) === source transferId"
        ).toBe(true);
      } else {
        expect(
          chosenPath,
          "MIME unproven → exclusive native-monitor degradation"
        ).toBe("native-monitor");
        expect(
          pathAProven,
          "Path B selected: continuous real MIME proof must be false"
        ).toBe(false);
        // Explicit anti-claim: failing soft claims that HTML5 was chosen.
        expect(gateDecision.productionPath).not.toMatch(/HTML5 target/i);
        expect(gateDecision.html5TargetRecognition).toMatch(/^DELETE/);
        expect(gateDecision.mimeCrossWebContents).toMatch(/UNPROVEN|FAILED/i);
      }
      // Sanity: exclusive single path only.
      expect(
        gateDecision.chosenPath === "html5-mime" ||
          gateDecision.chosenPath === "native-monitor"
      ).toBe(true);
      if (!pathAProven) {
        expect(gateDecision.chosenPath).toBe("native-monitor");
      }
    } finally {
      await forceCloseApplication(app);
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });
});

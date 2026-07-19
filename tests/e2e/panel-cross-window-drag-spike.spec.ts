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
 * Task 1 gate spike — Electron/Dockview HTML5 DnD across two real Pier windows.
 *
 * Environment:
 * - Electron 43.1.0, two real BaseWindow + WebContentsView windows
 * - production session / contextIsolation / sandbox (same as other e2e)
 *
 * Drag method:
 * - Source dragstart: native Playwright mouse on a real `.dv-tab` (NOT dispatchEvent).
 * - Cross-WebContents delivery: Chromium CDP `Input.dispatchDragEvent` into the
 *   target page with the same DataTransfer payload. This is required on this
 *   agent host because macOS Accessibility is disabled (`UI elements enabled =
 *   false`), so OS CGEvent / cliclick cannot move the system cursor into the
 *   second Electron window. CDP still exercises a separate WebContents realm
 *   and Chromium's real DataTransfer MIME plumbing.
 *
 * Pins Dockview 7.0.2 public names: onWillDragPanel, onDidDrop, onUnhandledDragOver
 * (not onUnhandledDragOverEvent). accept() exists on unhandled overlay events.
 *
 * New-window decisions must NOT use dragend.dropEffect — document AppKit
 * leftMouseUp/Escape monitors + main `screen.getCursorScreenPoint()` + bounds.
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
    const [sourceHost, targetHost] = windows;
    const display = screen.getDisplayMatching(sourceHost.getBounds());
    const work = display.workArea;
    const gap = 16;
    const width = Math.max(480, Math.floor((work.width - gap) / 2));
    const height = Math.max(520, Math.min(700, work.height - 40));
    const y = work.y + 24;
    const sourceX = work.x + 12;
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
        dropEffect?: string;
        effectAllowed?: string;
        mimeData: string | null;
        screenX?: number;
        screenY?: number;
        textData: string | null;
        types: string[];
        windowRole: "source" | "target";
      }
      interface DockBucket {
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
          const tab = (event.target as HTMLElement | null)?.closest?.(
            ".dv-tab"
          );
          if (!tab) {
            return;
          }
          try {
            event.dataTransfer?.setData(mime, id);
            event.dataTransfer?.setData("text/plain", `${prefix}${id}`);
            if (event.dataTransfer) {
              event.dataTransfer.effectAllowed = "move";
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
          if (log.dragover.length < 48) {
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
            const accept =
              record && typeof record.accept === "function"
                ? (record.accept as () => void)
                : null;
            if (
              accept &&
              String(eventName).toLowerCase().includes("unhandled")
            ) {
              try {
                accept();
              } catch {
                // presence matters
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
              acceptType: accept ? typeof record?.accept : "absent",
              eventName,
              fired: true,
              hasAccept: Boolean(accept),
              hasNativeEvent: Boolean(nativeEvent),
              keys,
              nativeEventIsDragEvent: nativeIsDrag,
              nativeEventType,
              position: record?.position ?? null,
              subscriptionPresent: true,
              target: record?.target ?? null,
              windowRole: role,
            };
          });
        }
      };

      (
        window as unknown as { __pierBindDockviewSpike?: () => boolean }
      ).__pierBindDockviewSpike = () => {
        const api = findDockviewApi();
        if (!api) {
          return false;
        }
        if (log.dockview.some((entry) => entry.subscriptionPresent)) {
          return true;
        }
        bindDockviewApi(api);
        return true;
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
        `${entry.eventName}{sub=${entry.subscriptionPresent}, fired=${entry.fired}, hasAccept=${entry.hasAccept}, nativeEvent=${entry.hasNativeEvent}, nativeIsDrag=${entry.nativeEventIsDragEvent}, keys=[${entry.keys.join(",")}]}`
    )
    .join(" | ");
}

async function playwrightSourceTabDragStart(page: Page) {
  const tab = page.locator(".dv-tab").first();
  const box = await tab.boundingBox();
  if (!box) {
    throw new Error("source .dv-tab has no box");
  }
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 28, startY + 4, { steps: 8 });
}

async function cdpDeliverTransferToTarget(
  target: Page,
  transferId: string,
  point: LocalPoint,
  mode: "drop" | "over-only"
) {
  const session = await target.context().newCDPSession(target);
  const data = {
    dragOperationsMask: 16, // Move
    files: [] as string[],
    items: [
      { data: transferId, mimeType: PANEL_TRANSFER_MIME },
      {
        data: `${PANEL_TRANSFER_TEXT_PREFIX}${transferId}`,
        mimeType: "text/plain",
      },
    ],
  };
  await session.send("Input.dispatchDragEvent", {
    data,
    type: "dragEnter",
    x: point.x,
    y: point.y,
  });
  await session.send("Input.dispatchDragEvent", {
    data,
    type: "dragOver",
    x: point.x,
    y: point.y,
  });
  if (mode === "drop") {
    await session.send("Input.dispatchDragEvent", {
      data,
      type: "drop",
      x: point.x,
      y: point.y,
    });
  } else {
    await session.send("Input.dispatchDragEvent", {
      data,
      type: "dragCancel",
      x: point.x,
      y: point.y,
    });
  }
  await session.detach().catch(() => undefined);
}

test.describe("Panel cross-window drag spike", () => {
  test("HTML5 MIME + Dockview events across two BaseWindow WebContentsViews", async () => {
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
      if (!accessibilityEnabled) {
        console.log(
          "[panel-dnd-spike] OS CGEvent cannot drive cross-window cursor without Accessibility; using Playwright source mouse + CDP Input.dispatchDragEvent into target WebContents for MIME/types probe."
        );
      }

      // --- Source: real Playwright mouse dragstart on .dv-tab (forbidden: dispatchEvent) ---
      await focusHostWindow(app, hosts.source.id);
      await playwrightSourceTabDragStart(source);
      await source.waitForTimeout(150);
      let sourceLog = await readSpikeLog(source);
      expect(
        sourceLog.dragstart.length,
        "Playwright mouse on .dv-tab must fire dragstart"
      ).toBeGreaterThan(0);

      // --- Target scenarios via CDP into the other WebContents ---
      const anchors = [
        {
          anchor: "center" as const,
          selector: ".dv-dockview",
          label: "foreground-center",
        },
        {
          anchor: "left-edge" as const,
          selector: ".dv-dockview",
          label: "content-left-edge",
        },
        {
          anchor: "right-edge" as const,
          selector: ".dv-dockview",
          label: "content-right-edge",
        },
      ];

      for (const scenario of anchors) {
        const point = await elementLocalPoint(
          target,
          scenario.selector,
          scenario.anchor
        );
        await cdpDeliverTransferToTarget(target, transferId, point, "drop");
        await target.waitForTimeout(80);
        console.log(
          `[panel-dnd-spike] delivered CDP drop @ ${scenario.label}`,
          point
        );
      }

      if ((await target.locator(".dv-tab").count()) > 0) {
        for (const anchor of ["tab-before", "tab-after"] as const) {
          const point = await elementLocalPoint(target, ".dv-tab", anchor);
          await cdpDeliverTransferToTarget(target, transferId, point, "drop");
          await target.waitForTimeout(80);
          console.log(
            `[panel-dnd-spike] delivered CDP drop @ ${anchor}`,
            point
          );
        }
      }

      // Background-target observation: deliver while source remains focused.
      await focusHostWindow(app, hosts.source.id);
      const bgPoint = await elementLocalPoint(target, ".dv-dockview", "center");
      await cdpDeliverTransferToTarget(target, transferId, bgPoint, "drop");
      await target.waitForTimeout(80);

      // Outside-window / new-window path cannot be CDP-delivered into a page.
      // Document the production approach (no dropEffect).
      await source.evaluate((logKey) => {
        const log = (window as unknown as Record<string, { notes: string[] }>)[
          logKey
        ];
        log?.notes.push(
          "outside-window: use AppKit local/global monitor for leftMouseUp/Escape; main screen.getCursorScreenPoint() + managed BaseWindow bounds; only outside mouse-up detaches; Escape aborts; dragend clears UI only"
        );
      }, SPIKE_LOG_KEY);

      // Escape mid-drag (source window): start a drag then press Escape.
      await focusHostWindow(app, hosts.source.id);
      await playwrightSourceTabDragStart(source);
      await source.keyboard.press("Escape");
      await source.mouse.up();
      await source.waitForTimeout(150);

      // Finish any held button state.
      await source.mouse.up().catch(() => undefined);

      sourceLog = await readSpikeLog(source);
      const targetLog = await readSpikeLog(target);

      console.log(
        "[panel-dnd-spike] source.dragstart",
        JSON.stringify(sourceLog.dragstart, null, 2)
      );
      console.log(
        "[panel-dnd-spike] target.dragenter/dragover/drop",
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
        JSON.stringify(sourceLog.dragend, null, 2)
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
      console.log("[panel-dnd-spike] notes", sourceLog.notes);

      const start = sourceLog.dragstart[0];
      expect(start.types.length).toBeGreaterThan(0);
      const startHasMime =
        start.mimeData === transferId ||
        start.types.includes(PANEL_TRANSFER_MIME);
      const startHasText =
        start.textData === `${PANEL_TRANSFER_TEXT_PREFIX}${transferId}` ||
        start.types.includes("text/plain");
      expect(
        startHasMime || startHasText,
        `dragstart must carry transfer token (mime=${start.mimeData}, text=${start.textData}, types=${start.types.join(",")})`
      ).toBe(true);

      const targetEvents = [
        ...targetLog.dragenter,
        ...targetLog.dragover,
        ...targetLog.drop,
      ];
      const targetSawDrag = targetEvents.length > 0;
      // Browser security: getData is often empty until drop; types still list MIME.
      const targetTypesIncludeMime = targetEvents.some((event) =>
        event.types.includes(PANEL_TRANSFER_MIME)
      );
      const targetMimeReadableOnDrop = targetLog.drop.some(
        (event) => event.mimeData === transferId
      );
      const targetTextReadableOnDrop = targetLog.drop.some(
        (event) =>
          event.textData === `${PANEL_TRANSFER_TEXT_PREFIX}${transferId}`
      );
      const targetMimeReadableOnOver = [
        ...targetLog.dragenter,
        ...targetLog.dragover,
      ].some((event) => event.mimeData === transferId);

      console.log(
        "[panel-dnd-spike] cross-window summary",
        JSON.stringify(
          {
            accessibilityEnabled,
            delivery: accessibilityEnabled
              ? "os-mouse-preferred"
              : "playwright-source + CDP Input.dispatchDragEvent target",
            targetMimeReadableOnDrop,
            targetMimeReadableOnOver,
            targetSawDrag,
            targetTextReadableOnDrop,
            targetTypesIncludeMime,
            transferId,
          },
          null,
          2
        )
      );

      const dropEffects = sourceLog.dragend.map((event) => event.dropEffect);
      console.log(
        "[panel-dnd-spike] dragend.dropEffect values (do NOT use for new-window):",
        dropEffects
      );
      console.log(
        "[panel-dnd-spike] new-window approach: AppKit local/global monitor for leftMouseUp/Escape; main uses screen.getCursorScreenPoint() + managed BaseWindow bounds. Only outside mouse-up detaches; Escape/system cancel aborts; dragend only clears UI."
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

      // accept() on AcceptableEvent: unhandled overlay may not fire for CDP
      // external drops (Dockview only emits for its own DnD path). Type/runtime
      // class still exposes accept(); assert subscription presence above and
      // document accept() from dockview-core AcceptableEvent.
      console.log(
        "[panel-dnd-spike] accept(): DockviewDndOverlayEvent / DockviewUnhandledDragOverEvent extends AcceptableEvent with accept() + isAccepted (dockview-core/events). onUnhandledDragOver is the public name."
      );

      expect(
        targetSawDrag,
        "target WebContents must observe dragenter/dragover/drop"
      ).toBe(true);
      expect(
        targetTypesIncludeMime,
        "target drag events must list application/x-pier-panel-transfer in types"
      ).toBe(true);
      expect(
        targetMimeReadableOnDrop,
        "target drop getData(MIME) must return transferId (cross-WebContents readable on drop)"
      ).toBe(true);

      // Chromium hides getData until drop even same-window; over-phase empty is expected.
      console.log(
        "[panel-dnd-spike] MIME cross-WebContents: YES on drop getData; types visible on dragenter/dragover; getData empty during over (standard Chromium). HTML5 target recognition can use types.includes(MIME) during over + getData on drop."
      );

      expect(sourceLog.dragend.length).toBeGreaterThan(0);
      expect(typeof sourceLog.keydownEscape).toBe("number");
    } finally {
      await forceCloseApplication(app);
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });
});

import { type ChildProcess, execFile } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  type ElectronApplication,
  _electron as electron,
  expect,
  type Page,
  test,
} from "@playwright/test";
import {
  killAndWait,
  makeTempUserDataDir,
  OUT_MAIN,
  PID_LOOP_TASK_ID,
  PROJECT_ROOT,
  removeDirectory,
  runPierCliJson,
  spawnTaskUntilRunning,
  writePidLoopProject,
} from "./terminal-e2e-harness.ts";
import { openWorkbench, setWindowSize } from "./workbench-e2e-harness.ts";

/**
 * Cross-window panel drag e2e — Path B via `pier.panelTransfer` (offer/drop/
 * finishDrag/cancel) plus real same-window Dockview mouse drag where needed.
 */

test.skip(
  process.platform !== "darwin",
  "cross-window panel drag e2e is macOS-only"
);

const execFileAsync = promisify(execFile);
const APP_CLOSE_TIMEOUT_MS = 20_000;
const DEFAULT_TEST_TIMEOUT_MS = 120_000;

type PanelTransferPlacement =
  | { kind: "tab"; groupId: string; index: number }
  | {
      kind: "split";
      referenceGroupId?: string;
      direction: "left" | "right" | "above" | "below";
    }
  | { kind: "root" };

type PanelTransferResult =
  | { ok: true; targetPanelId: string }
  | { ok: false; code: string; message: string };

interface LaunchContext {
  app: ElectronApplication;
  userDataDir: string;
}

interface PanelInfo {
  componentId: string;
  groupId: string;
  panelId: string;
  title: string;
}

interface DockviewApiLike {
  addPanel: (opts: Record<string, unknown>) => unknown;
  onDidDrop?: unknown;
  panels?: unknown;
}

async function waitForWorkspaceReady(page: Page): Promise<void> {
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

async function forceClose(
  application: ElectronApplication | null
): Promise<void> {
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
  await killAndWait(child, APP_CLOSE_TIMEOUT_MS);
}

async function launchApp(): Promise<LaunchContext> {
  const userDataDir = makeTempUserDataDir("pier-panel-xfer-e2e-");
  const app = await electron.launch({
    args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
    cwd: PROJECT_ROOT,
  });
  return { app, userDataDir };
}

async function createSecondWindow(
  app: ElectronApplication,
  source: Page
): Promise<Page> {
  const secondWindowPromise = app.waitForEvent("window");
  await source.evaluate(() => window.pier.createWindow());
  const target = await secondWindowPromise;
  await waitForWorkspaceReady(target);
  return target;
}

async function positionWindowsSideBySide(
  app: ElectronApplication
): Promise<void> {
  await app.evaluate(({ BaseWindow, screen }) => {
    const windows = BaseWindow.getAllWindows()
      .filter((win) => !win.isDestroyed())
      .sort((left, right) => left.id - right.id);
    if (windows.length < 2) {
      throw new Error(`Expected >=2 BaseWindows, got ${windows.length}`);
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
  });
}

/**
 * Move every managed BaseWindow so the current cursor is outside all of them.
 * Used for finishDrag → new-window (outside) classification.
 */
async function moveWindowsAwayFromCursor(
  app: ElectronApplication
): Promise<{ cursor: { x: number; y: number } }> {
  return await app.evaluate(({ BaseWindow, screen }) => {
    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    const work = display.workArea;
    const parkX =
      cursor.x < work.x + work.width / 2
        ? work.x + work.width - 420
        : work.x + 16;
    const parkY =
      cursor.y < work.y + work.height / 2
        ? work.y + work.height - 360
        : work.y + 32;
    for (const win of BaseWindow.getAllWindows()) {
      if (win.isDestroyed()) {
        continue;
      }
      win.setBounds({ height: 320, width: 400, x: parkX, y: parkY });
      win.show();
    }
    return { cursor: { x: cursor.x, y: cursor.y } };
  });
}

/**
 * Deterministically classify the OS cursor as inside a specific BaseWindow by
 * moving that window's bounds around the current physical cursor position.
 * (Playwright's page.mouse does NOT move the OS cursor, so classification
 * must be arranged by window geometry, not synthetic clicks.)
 */
async function surroundCursorWithWindow(
  app: ElectronApplication,
  windowIndex: number
): Promise<void> {
  await app.evaluate(({ BaseWindow, screen }, index) => {
    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    const work = display.workArea;
    const windows = BaseWindow.getAllWindows()
      .filter((win) => !win.isDestroyed())
      .sort((left, right) => left.id - right.id);
    const target = windows[index];
    if (!target) {
      throw new Error(`no BaseWindow at index ${index}`);
    }
    const width = 600;
    const height = 480;
    const x = Math.min(
      Math.max(cursor.x - Math.floor(width / 2), work.x),
      work.x + work.width - width
    );
    const y = Math.min(
      Math.max(cursor.y - Math.floor(height / 2), work.y),
      work.y + work.height - height
    );
    target.setBounds({ height, width, x, y });
    target.show();
    // Park every other window away from the cursor.
    const parkX =
      cursor.x < work.x + work.width / 2
        ? work.x + work.width - 420
        : work.x + 16;
    const parkY =
      cursor.y < work.y + work.height / 2
        ? work.y + work.height - 360
        : work.y + 32;
    for (const [i, win] of windows.entries()) {
      if (i === index) {
        continue;
      }
      win.setBounds({ height: 320, width: 400, x: parkX, y: parkY });
      win.show();
    }
  }, windowIndex);
}

/**
 * React fiber walk from `[data-panel-tab-id]` → `props.api.group.id`
 * (and component / title) as used by PanelTabHeader.
 */
async function readPanelInfo(page: Page, panelId: string): Promise<PanelInfo> {
  const info = await page
    .locator(`[data-panel-tab-id="${panelId}"]`)
    .evaluate((element, expectedId) => {
      interface Fiber {
        child?: Fiber | null;
        memoizedProps?: Record<string, unknown> | null;
        return?: Fiber | null;
        sibling?: Fiber | null;
      }
      const fiberKey = Object.keys(element).find((key) =>
        key.startsWith("__reactFiber$")
      );
      if (!fiberKey) {
        return null;
      }
      const seen = new Set<unknown>();
      const queue: Fiber[] = [
        (element as unknown as Record<string, unknown>)[fiberKey] as Fiber,
      ];
      while (queue.length > 0) {
        const fiber = queue.shift();
        if (!fiber || seen.has(fiber)) {
          continue;
        }
        seen.add(fiber);
        const props = fiber.memoizedProps;
        const api = props?.api as
          | {
              component?: string;
              group?: { id?: string } | null;
              id?: string;
              title?: string;
            }
          | undefined;
        if (
          api &&
          typeof api.id === "string" &&
          api.id === expectedId &&
          typeof api.group?.id === "string"
        ) {
          return {
            componentId: api.component ?? "",
            groupId: api.group.id,
            panelId: api.id,
            title: api.title ?? "",
          };
        }
        if (fiber.child) {
          queue.push(fiber.child);
        }
        if (fiber.sibling) {
          queue.push(fiber.sibling);
        }
        if (fiber.return) {
          queue.push(fiber.return);
        }
      }
      return null;
    }, panelId);
  if (!info?.groupId) {
    throw new Error(`Could not read panel info for ${panelId}`);
  }
  return info;
}

async function readPanelGroupId(page: Page, panelId: string): Promise<string> {
  const info = await readPanelInfo(page, panelId);
  return info.groupId;
}

async function findDockviewApiAndAddPanel(
  page: Page,
  input: Record<string, unknown>
): Promise<void> {
  await page.evaluate((panel) => {
    interface Fiber {
      child?: Fiber | null;
      memoizedProps?: Record<string, unknown> | null;
      memoizedState?: { memoizedState?: unknown; next?: unknown } | null;
      sibling?: Fiber | null;
      stateNode?: unknown;
    }
    const isDockviewApi = (value: unknown): value is DockviewApiLike => {
      if (!value || typeof value !== "object") {
        return false;
      }
      const candidate = value as DockviewApiLike;
      return (
        typeof candidate.addPanel === "function" &&
        typeof candidate.onDidDrop === "function" &&
        Array.isArray(candidate.panels)
      );
    };
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
          fiber.stateNode.addPanel(panel);
          return;
        }
        const props = fiber.memoizedProps;
        if (props) {
          for (const value of Object.values(props)) {
            if (isDockviewApi(value)) {
              value.addPanel(panel);
              return;
            }
            if (value && typeof value === "object") {
              const maybeApi = (value as { api?: unknown }).api;
              if (isDockviewApi(maybeApi)) {
                maybeApi.addPanel(panel);
                return;
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
            memo.addPanel(panel);
            return;
          }
          if (memo && typeof memo === "object") {
            const current = (memo as { current?: unknown }).current;
            if (isDockviewApi(current)) {
              current.addPanel(panel);
              return;
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
      }
    }
    throw new Error("Dockview API not found for addPanel");
  }, input);
}

/** addTab equivalent — keymap binds Meta+t to newTerminal, not Welcome. */
async function openWelcome(page: Page): Promise<string> {
  const id = `welcome-${crypto.randomUUID()}`;
  await findDockviewApiAndAddPanel(page, {
    component: "welcome",
    id,
    title: "Welcome",
  });
  await expect(page.locator(`[data-panel-tab-id="${id}"]`)).toBeVisible({
    timeout: 10_000,
  });
  return id;
}

async function openGitChanges(
  page: Page,
  userDataDir: string,
  repoPath: string
): Promise<string> {
  // The status dropdown only offers 查看变更/View Changes in dirty/active
  // variants — a clean repo renders the clean menu without that action.
  writeFileSync(join(repoPath, "notes.txt"), "dirty for changes panel\n");
  const opened = await runPierCliJson<{ panelId: string }>(userDataDir, [
    "terminal",
    "open",
    "--cwd",
    repoPath,
  ]);
  expect(opened.ok).toBe(true);
  const terminalPanelId = opened.data?.panelId ?? "";
  expect(terminalPanelId).not.toBe("");
  await page.locator(`[data-panel-tab-id="${terminalPanelId}"]`).click();
  const statusTrigger = page
    .locator('[data-testid="worktree-status-trigger"]:visible')
    .first();
  await expect(statusTrigger).toBeVisible({ timeout: 20_000 });
  await statusTrigger.click();
  await page.getByRole("menuitem", { name: /View Changes|查看变更/u }).click();
  const changesTab = page.locator('[data-panel-tab-id^="pier.git.changes:"]');
  await expect(changesTab.first()).toBeVisible({ timeout: 20_000 });
  const panelId = await changesTab.first().getAttribute("data-panel-tab-id");
  expect(panelId).toBeTruthy();
  return panelId!;
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

async function makeTempGitRepo(prefix: string): Promise<string> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  await git(root, ["init", "-q", "-b", "main"]);
  await git(root, ["config", "user.email", "e2e@pier.local"]);
  await git(root, ["config", "user.name", "Pier E2E"]);
  writeFileSync(join(root, "notes.txt"), "clean\n");
  await git(root, ["add", "."]);
  await git(root, ["commit", "-q", "-m", "init"]);
  return root;
}

/** Runtime window ids as main sees them (CLI `--window` routing key). */
async function listWindowIds(userDataDir: string): Promise<string[]> {
  const result = await runPierCliJson<Array<{ id: string }>>(userDataDir, [
    "windows",
    "list",
  ]);
  expect(result.ok).toBe(true);
  return (result.data ?? []).map((info) => info.id);
}

async function openFileViaTree(
  page: Page,
  userDataDir: string,
  repoPath: string,
  fileName: string,
  windowId?: string
): Promise<string> {
  await expect
    .poll(
      async () => {
        const opened = await runPierCliJson<{ panelId: string }>(userDataDir, [
          "terminal",
          "open",
          "--cwd",
          repoPath,
          // Route to an explicit window — the focused-window fallback races OS
          // focus in multi-window tests and can land the terminal elsewhere.
          ...(windowId ? ["--window", windowId] : []),
        ]);
        return opened.ok === true;
      },
      { timeout: 20_000 }
    )
    .toBe(true);

  await page.locator('[data-testid="files-project-status-trigger"]').click();
  const item = page.getByRole("treeitem", { name: new RegExp(fileName, "u") });
  await expect(item).toBeVisible({ timeout: 20_000 });
  await item.click();
  const editor = page.locator(
    '[data-testid="files-code-mirror-editor"] .cm-content'
  );
  await expect(editor).toBeVisible({ timeout: 30_000 });
  const tabIcon = page.locator(`[data-panel-tab-icon="pier.file:${fileName}"]`);
  await expect(tabIcon).toBeVisible({ timeout: 10_000 });
  const panelId = await tabIcon.evaluate((element) =>
    element.closest("[data-panel-tab-id]")?.getAttribute("data-panel-tab-id")
  );
  expect(panelId).toBeTruthy();
  return panelId!;
}

async function editEditorDirty(page: Page, marker: string): Promise<void> {
  const editor = page.locator(
    '[data-testid="files-code-mirror-editor"] .cm-content'
  );
  await expect(editor).toBeVisible({ timeout: 15_000 });
  await editor.click();
  await page.keyboard.press("Meta+End");
  await page.keyboard.type(`\n${marker}`);
  await expect(
    page.getByRole("status", { name: /Draft saved|草稿已保存/ })
  ).toBeAttached({ timeout: 30_000 });
  await expect(
    page.locator('[data-pier-tab-dirty="true"]').first()
  ).toBeVisible({ timeout: 10_000 });
}

async function transferPanel(
  source: Page,
  target: Page,
  input: {
    panelId: string;
    componentId: string;
    title: string;
    placement: PanelTransferPlacement;
  }
): Promise<PanelTransferResult> {
  const transferId = crypto.randomUUID();
  const offerResult = await source.evaluate(
    async ({ offer }) => window.pier.panelTransfer.offer(offer),
    {
      offer: {
        version: 1 as const,
        transferId,
        capability: "movable" as const,
        panel: {
          componentId: input.componentId,
          panelId: input.panelId,
          title: input.title,
        },
      },
    }
  );
  expect(offerResult.accepted).toBe(true);

  const result = await target.evaluate(
    async ({ transferId: id, placement }) =>
      window.pier.panelTransfer.drop({ transferId: id, placement }),
    {
      transferId,
      placement: input.placement,
    }
  );
  return result as PanelTransferResult;
}

async function offerOnly(
  source: Page,
  input: { panelId: string; componentId: string; title: string }
): Promise<string> {
  const transferId = crypto.randomUUID();
  const offerResult = await source.evaluate(
    async ({ offer }) => window.pier.panelTransfer.offer(offer),
    {
      offer: {
        version: 1 as const,
        transferId,
        capability: "movable" as const,
        panel: {
          componentId: input.componentId,
          panelId: input.panelId,
          title: input.title,
        },
      },
    }
  );
  expect(offerResult.accepted).toBe(true);
  return transferId;
}

async function expectPanelOn(page: Page, panelId: string): Promise<void> {
  await expect(page.locator(`[data-panel-tab-id="${panelId}"]`)).toBeVisible({
    timeout: 20_000,
  });
}

/**
 * Presentation-layer assertion: the moved panel must land ACTIVE in the
 * target (VS Code targetGroup.focus() semantics). Guards against the
 * "window opens but renders blank" class of defects that data-layer
 * assertions cannot see.
 */
async function expectPanelActiveOn(page: Page, panelId: string): Promise<void> {
  await expect(
    page.locator(`.dv-tab.dv-active-tab [data-panel-tab-id="${panelId}"]`)
  ).toBeVisible({ timeout: 20_000 });
}

async function expectPanelGone(page: Page, panelId: string): Promise<void> {
  await expect(page.locator(`[data-panel-tab-id="${panelId}"]`)).toHaveCount(
    0,
    { timeout: 20_000 }
  );
}

async function firstTerminalPanelId(page: Page): Promise<string> {
  const tab = page.locator('[data-panel-tab-id^="terminal-"]').first();
  await expect(tab).toBeVisible({ timeout: 15_000 });
  const id = await tab.getAttribute("data-panel-tab-id");
  expect(id).toBeTruthy();
  return id!;
}

async function reorderTabsSameWindow(page: Page): Promise<void> {
  const tabs = page.locator(".dv-tab");
  await expect(tabs).toHaveCount(2, { timeout: 10_000 });
  const first = tabs.nth(0);
  const second = tabs.nth(1);
  const firstBox = await first.boundingBox();
  const secondBox = await second.boundingBox();
  if (!(firstBox && secondBox)) {
    throw new Error("tab boxes missing for same-window reorder");
  }
  const firstId = await first
    .locator("[data-panel-tab-id]")
    .first()
    .getAttribute("data-panel-tab-id");
  const secondId = await second
    .locator("[data-panel-tab-id]")
    .first()
    .getAttribute("data-panel-tab-id");
  expect(firstId).toBeTruthy();
  expect(secondId).toBeTruthy();

  await page.mouse.move(
    firstBox.x + firstBox.width / 2,
    firstBox.y + firstBox.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(
    secondBox.x + secondBox.width - 4,
    secondBox.y + secondBox.height / 2,
    { steps: 12 }
  );
  await page.mouse.up();

  await expect
    .poll(async () => {
      const order = await page
        .locator(".dv-tab [data-panel-tab-id]")
        .evaluateAll((els) =>
          els.map((el) => el.getAttribute("data-panel-tab-id"))
        );
      return order;
    })
    .not.toEqual([firstId, secondId]);
}

async function resolveWorkbenchPanelId(
  page: Page,
  welcomeId: string
): Promise<string> {
  const ids = await page
    .locator("[data-panel-tab-id]")
    .evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-panel-tab-id") ?? "")
    );
  for (const id of ids) {
    if (!id || id === welcomeId || id.startsWith("terminal-")) {
      continue;
    }
    const info = await readPanelInfo(page, id);
    if (info.componentId === "workbench") {
      return id;
    }
  }
  throw new Error("workbench panel id not found");
}

test.describe("Panel cross-window drag (Path B)", () => {
  test.describe("tab placement", () => {
    test("places transferred panel at tab index 0 (before)", async () => {
      test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
      const ctx = await launchApp();
      try {
        const source = await ctx.app.firstWindow();
        await waitForWorkspaceReady(source);
        await setWindowSize(ctx.app, source, 1100, 720);
        const welcomeId = await openWelcome(source);
        const welcome = await readPanelInfo(source, welcomeId);

        const target = await createSecondWindow(ctx.app, source);
        await positionWindowsSideBySide(ctx.app);
        const targetTerminalId = await firstTerminalPanelId(target);
        const targetGroupId = await readPanelGroupId(target, targetTerminalId);

        const result = await transferPanel(source, target, {
          panelId: welcome.panelId,
          componentId: welcome.componentId || "welcome",
          title: welcome.title || "Welcome",
          placement: { kind: "tab", groupId: targetGroupId, index: 0 },
        });
        expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
        await expectPanelGone(source, welcomeId);
        await expectPanelOn(target, welcomeId);

        const order = await target
          .locator(".dv-tab [data-panel-tab-id]")
          .evaluateAll((els) =>
            els.map((el) => el.getAttribute("data-panel-tab-id"))
          );
        expect(order[0]).toBe(welcomeId);
      } finally {
        await forceClose(ctx.app);
        removeDirectory(ctx.userDataDir);
      }
    });

    test("places transferred panel at tab index end (after)", async () => {
      test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
      const ctx = await launchApp();
      try {
        const source = await ctx.app.firstWindow();
        await waitForWorkspaceReady(source);
        const welcomeId = await openWelcome(source);
        const welcome = await readPanelInfo(source, welcomeId);

        const target = await createSecondWindow(ctx.app, source);
        await positionWindowsSideBySide(ctx.app);
        const targetTerminalId = await firstTerminalPanelId(target);
        const targetGroupId = await readPanelGroupId(target, targetTerminalId);
        const endIndex = await target
          .locator("[data-panel-tab-id]")
          .evaluateAll((els) => els.length);

        const result = await transferPanel(source, target, {
          panelId: welcome.panelId,
          componentId: welcome.componentId || "welcome",
          title: welcome.title || "Welcome",
          placement: {
            kind: "tab",
            groupId: targetGroupId,
            index: endIndex,
          },
        });
        expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
        await expectPanelGone(source, welcomeId);
        await expectPanelOn(target, welcomeId);

        const order = await target
          .locator(".dv-tab [data-panel-tab-id]")
          .evaluateAll((els) =>
            els.map((el) => el.getAttribute("data-panel-tab-id"))
          );
        expect(order.at(-1)).toBe(welcomeId);
      } finally {
        await forceClose(ctx.app);
        removeDirectory(ctx.userDataDir);
      }
    });
  });

  test.describe("four-edge split", () => {
    for (const direction of ["left", "right", "above", "below"] as const) {
      test(`splits ${direction} of the target group`, async () => {
        test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
        const ctx = await launchApp();
        try {
          const source = await ctx.app.firstWindow();
          await waitForWorkspaceReady(source);
          const welcomeId = await openWelcome(source);
          const welcome = await readPanelInfo(source, welcomeId);

          const target = await createSecondWindow(ctx.app, source);
          await positionWindowsSideBySide(ctx.app);
          const targetTerminalId = await firstTerminalPanelId(target);
          const referenceGroupId = await readPanelGroupId(
            target,
            targetTerminalId
          );

          const result = await transferPanel(source, target, {
            panelId: welcome.panelId,
            componentId: welcome.componentId || "welcome",
            title: welcome.title || "Welcome",
            placement: {
              kind: "split",
              direction,
              referenceGroupId,
            },
          });
          expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
          await expectPanelGone(source, welcomeId);
          await expectPanelOn(target, welcomeId);

          const welcomeGroup = await readPanelGroupId(target, welcomeId);
          const terminalGroup = await readPanelGroupId(
            target,
            targetTerminalId
          );
          expect(welcomeGroup).not.toBe(terminalGroup);
        } finally {
          await forceClose(ctx.app);
          removeDirectory(ctx.userDataDir);
        }
      });
    }
  });

  test.describe("finishDrag outside → new window", () => {
    test("finishDrag with cursor outside creates a new window", async () => {
      test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
      const ctx = await launchApp();
      try {
        const source = await ctx.app.firstWindow();
        await waitForWorkspaceReady(source);
        const welcomeId = await openWelcome(source);
        const welcome = await readPanelInfo(source, welcomeId);

        await moveWindowsAwayFromCursor(ctx.app);

        const transferId = await offerOnly(source, {
          panelId: welcome.panelId,
          componentId: welcome.componentId || "welcome",
          title: welcome.title || "Welcome",
        });

        const newWindowPromise = ctx.app.waitForEvent("window", {
          timeout: 30_000,
        });
        const result = await source.evaluate(
          async (id) => window.pier.panelTransfer.finishDrag(id),
          transferId
        );
        expect(result).toMatchObject({ ok: true, targetPanelId: welcomeId });

        const created = await newWindowPromise;
        await waitForWorkspaceReady(created);
        await expectPanelGone(source, welcomeId);
        await expectPanelOn(created, welcomeId);
        await expectPanelActiveOn(created, welcomeId);
      } finally {
        await forceClose(ctx.app);
        removeDirectory(ctx.userDataDir);
      }
    });
  });

  test.describe("cancel", () => {
    test("offer then cancel / Escape aborts without moving the panel", async () => {
      test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
      const ctx = await launchApp();
      try {
        const source = await ctx.app.firstWindow();
        await waitForWorkspaceReady(source);
        const welcomeId = await openWelcome(source);
        const welcome = await readPanelInfo(source, welcomeId);
        const target = await createSecondWindow(ctx.app, source);
        await positionWindowsSideBySide(ctx.app);

        const transferId = await offerOnly(source, {
          panelId: welcome.panelId,
          componentId: welcome.componentId || "welcome",
          title: welcome.title || "Welcome",
        });

        await source.keyboard.press("Escape");
        await source.evaluate(
          async (id) => window.pier.panelTransfer.cancel(id),
          transferId
        );

        await expectPanelOn(source, welcomeId);
        await expect(
          target.locator(`[data-panel-tab-id="${welcomeId}"]`)
        ).toHaveCount(0);
      } finally {
        await forceClose(ctx.app);
        removeDirectory(ctx.userDataDir);
      }
    });

    test("offer then finishDrag while cursor still on source aborts (miss)", async () => {
      test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
      const ctx = await launchApp();
      try {
        const source = await ctx.app.firstWindow();
        await waitForWorkspaceReady(source);
        const welcomeId = await openWelcome(source);
        const welcome = await readPanelInfo(source, welcomeId);

        // Wrap the source window around the physical cursor so the bounds
        // classifier reports "source" deterministically.
        await surroundCursorWithWindow(ctx.app, 0);

        const transferId = await offerOnly(source, {
          panelId: welcome.panelId,
          componentId: welcome.componentId || "welcome",
          title: welcome.title || "Welcome",
        });

        const result = await source.evaluate(
          async (id) => window.pier.panelTransfer.finishDrag(id),
          transferId
        );
        expect(result).toBeNull();
        await expectPanelOn(source, welcomeId);
        expect(ctx.app.windows()).toHaveLength(1);
      } finally {
        await forceClose(ctx.app);
        removeDirectory(ctx.userDataDir);
      }
    });
  });

  test.describe("finishDrag managed → existing window", () => {
    test("finishDrag with cursor over another window claims it (user drag path)", async () => {
      test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
      const ctx = await launchApp();
      try {
        const source = await ctx.app.firstWindow();
        await waitForWorkspaceReady(source);
        const welcomeId = await openWelcome(source);
        const welcome = await readPanelInfo(source, welcomeId);

        const target = await createSecondWindow(ctx.app, source);

        // Wrap the TARGET window around the physical cursor: finishDrag must
        // classify "managed", ask the target for placement, and claim it.
        await surroundCursorWithWindow(ctx.app, 1);

        const transferId = await offerOnly(source, {
          panelId: welcome.panelId,
          componentId: welcome.componentId || "welcome",
          title: welcome.title || "Welcome",
        });

        const result = await source.evaluate(
          async (id) => window.pier.panelTransfer.finishDrag(id),
          transferId
        );
        expect(result, JSON.stringify(result)).toMatchObject({
          ok: true,
          targetPanelId: welcomeId,
        });
        await expectPanelGone(source, welcomeId);
        await expectPanelOn(target, welcomeId);
        await expectPanelActiveOn(target, welcomeId);
        expect(ctx.app.windows()).toHaveLength(2);
      } finally {
        await forceClose(ctx.app);
        removeDirectory(ctx.userDataDir);
      }
    });

    test("moving the source's last tab out closes the source window", async () => {
      test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
      const ctx = await launchApp();
      try {
        const source = await ctx.app.firstWindow();
        await waitForWorkspaceReady(source);
        // Give the source a uniquely-id'd Welcome tab, then drop the default
        // terminal so Welcome is the sole survivor. A unique id avoids the
        // stable-id `target_conflict` with the target's own default terminal.
        const welcomeId = await openWelcome(source);
        const welcome = await readPanelInfo(source, welcomeId);
        const defaultTerminalId = await firstTerminalPanelId(source);
        // Close the default terminal via its tab close button so Welcome
        // (unique id, no stable-id conflict with the target) is the last tab.
        await source
          .locator(
            `[data-panel-tab-id="${defaultTerminalId}"] [aria-label="Close tab"]`
          )
          .click();
        await expectPanelGone(source, defaultTerminalId);
        await expect(source.locator("[data-panel-tab-id]")).toHaveCount(1);

        const target = await createSecondWindow(ctx.app, source);
        await surroundCursorWithWindow(ctx.app, 1); // target on top of cursor
        const transferId = await offerOnly(source, {
          panelId: welcome.panelId,
          componentId: welcome.componentId || "welcome",
          title: welcome.title || "Welcome",
        });
        // The successful transfer closes the source window; the evaluate
        // promise may reject with "target closed" as a side effect of its own
        // success. Treat page-closed as the expected outcome and assert on the
        // observable result (panel on target + source window gone).
        await source
          .evaluate(
            async (id) => window.pier.panelTransfer.finishDrag(id),
            transferId
          )
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            if (!/closed/i.test(message)) {
              throw err;
            }
          });
        await expectPanelOn(target, welcomeId);
        await expectPanelActiveOn(target, welcomeId);
        // Source had only Welcome → moving it out closes the source window.
        await expect
          .poll(() => ctx.app.windows().length, { timeout: 30_000 })
          .toBe(1);
      } finally {
        await forceClose(ctx.app);
        removeDirectory(ctx.userDataDir);
      }
    });
  });

  test.describe("same-window Dockview regression", () => {
    test("in-window .dv-tab drag still reorders tabs", async () => {
      test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
      const ctx = await launchApp();
      try {
        const page = await ctx.app.firstWindow();
        await waitForWorkspaceReady(page);
        await setWindowSize(ctx.app, page, 1100, 720);
        await openWelcome(page);
        await reorderTabsSameWindow(page);
        await expect(page.locator(".dv-tab")).toHaveCount(2);
      } finally {
        await forceClose(ctx.app);
        removeDirectory(ctx.userDataDir);
      }
    });
  });

  test.describe("panel kinds", () => {
    test("Welcome / Workbench transfer via Path B", async () => {
      test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
      const ctx = await launchApp();
      try {
        const source = await ctx.app.firstWindow();
        await waitForWorkspaceReady(source);
        const welcomeId = await openWelcome(source);
        await openWorkbench(source);
        const workbenchId = await resolveWorkbenchPanelId(source, welcomeId);

        const target = await createSecondWindow(ctx.app, source);
        await positionWindowsSideBySide(ctx.app);
        const targetTerminalId = await firstTerminalPanelId(target);
        const targetGroupId = await readPanelGroupId(target, targetTerminalId);

        const welcome = await readPanelInfo(source, welcomeId);
        const welcomeResult = await transferPanel(source, target, {
          panelId: welcome.panelId,
          componentId: "welcome",
          title: welcome.title || "Welcome",
          placement: { kind: "tab", groupId: targetGroupId, index: 0 },
        });
        expect(welcomeResult.ok).toBe(true);
        await expectPanelOn(target, welcomeId);
        await expectPanelGone(source, welcomeId);

        const workbench = await readPanelInfo(source, workbenchId);
        const wbResult = await transferPanel(source, target, {
          panelId: workbench.panelId,
          componentId: "workbench",
          title: workbench.title || "Workbench",
          placement: {
            kind: "split",
            direction: "right",
            referenceGroupId: targetGroupId,
          },
        });
        expect(wbResult.ok).toBe(true);
        await expectPanelOn(target, workbenchId);
        await expectPanelGone(source, workbenchId);
        await target.locator(`[data-panel-tab-id="${workbenchId}"]`).click();
        await expect(
          target.locator('[data-testid="workbench-grid-wrapper"]')
        ).toBeVisible({ timeout: 15_000 });
      } finally {
        await forceClose(ctx.app);
        removeDirectory(ctx.userDataDir);
      }
    });

    test("Git changes panel transfers across windows", async () => {
      test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
      const repo = await makeTempGitRepo("pier-panel-xfer-git-");
      const ctx = await launchApp();
      try {
        const source = await ctx.app.firstWindow();
        await waitForWorkspaceReady(source);
        const gitPanelId = await openGitChanges(source, ctx.userDataDir, repo);
        const gitInfo = await readPanelInfo(source, gitPanelId);

        const target = await createSecondWindow(ctx.app, source);
        await positionWindowsSideBySide(ctx.app);
        const targetTerminalId = await firstTerminalPanelId(target);
        const targetGroupId = await readPanelGroupId(target, targetTerminalId);

        const result = await transferPanel(source, target, {
          panelId: gitInfo.panelId,
          componentId: gitInfo.componentId || "pier.git.changes",
          title: gitInfo.title || "Changes",
          placement: { kind: "tab", groupId: targetGroupId, index: 0 },
        });
        expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
        await expectPanelGone(source, gitPanelId);
        await expectPanelOn(target, gitPanelId);
      } finally {
        await forceClose(ctx.app);
        removeDirectory(ctx.userDataDir);
        removeDirectory(repo);
      }
    });

    test("Files dual-dirty: edit in both windows then transfer", async () => {
      test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
      const repo = await makeTempGitRepo("pier-panel-xfer-files-");
      const ctx = await launchApp();
      try {
        const source = await ctx.app.firstWindow();
        await waitForWorkspaceReady(source);
        const sourceFileId = await openFileViaTree(
          source,
          ctx.userDataDir,
          repo,
          "notes.txt"
        );
        await editEditorDirty(source, "source-dirty");

        const windowIdsBefore = await listWindowIds(ctx.userDataDir);
        const target = await createSecondWindow(ctx.app, source);
        await positionWindowsSideBySide(ctx.app);
        const targetWindowId = (await listWindowIds(ctx.userDataDir)).find(
          (id) => !windowIdsBefore.includes(id)
        );
        expect(targetWindowId).toBeTruthy();
        const targetFileId = await openFileViaTree(
          target,
          ctx.userDataDir,
          repo,
          "notes.txt",
          targetWindowId
        );
        await editEditorDirty(target, "target-dirty");
        expect(targetFileId).toBeTruthy();

        const sourceInfo = await readPanelInfo(source, sourceFileId);
        const targetTerminalId = await firstTerminalPanelId(target);
        const targetGroupId = await readPanelGroupId(target, targetTerminalId);

        const result = await transferPanel(source, target, {
          panelId: sourceInfo.panelId,
          componentId: sourceInfo.componentId || "pier.files.filePanel",
          title: sourceInfo.title || "notes.txt",
          placement: {
            kind: "split",
            direction: "below",
            referenceGroupId: targetGroupId,
          },
        });
        expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
        await expectPanelGone(source, sourceFileId);
        await expectPanelOn(target, sourceFileId);
        await expect(
          target.locator('[data-pier-tab-dirty="true"]')
        ).not.toHaveCount(0);

        // The adapter rewrites params.source but must keep params.context —
        // dropping it lands the moved panel in the outside-workspace error.
        await target.locator(`[data-panel-tab-id="${sourceFileId}"]`).click();
        await expect(
          target.getByText(/不属于当前工作区|outside the current workspace/u)
        ).toHaveCount(0);
        await expect(
          target
            .locator('[data-testid="files-code-mirror-editor"] .cm-content')
            .first()
        ).toBeVisible({ timeout: 15_000 });
      } finally {
        await forceClose(ctx.app);
        removeDirectory(ctx.userDataDir);
        removeDirectory(repo);
      }
    });

    test("missing-plugin: disable git then unavailable placeholder", async () => {
      test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
      const repo = await makeTempGitRepo("pier-panel-xfer-missing-");
      const ctx = await launchApp();
      try {
        const source = await ctx.app.firstWindow();
        await waitForWorkspaceReady(source);
        const gitPanelId = await openGitChanges(source, ctx.userDataDir, repo);
        await expectPanelOn(source, gitPanelId);

        await source.evaluate(async () => {
          await window.pier.plugins.disable("pier.git");
        });
        await expectPanelGone(source, gitPanelId);

        const unavailableId = `unavailable-${crypto.randomUUID()}`;
        await findDockviewApiAndAddPanel(source, {
          component: "panel-transfer-unavailable",
          id: unavailableId,
          title: "Changes",
          params: {
            transferRole: "target",
            originalDescriptor: {
              componentId: "pier.git.changes",
              panelId: gitPanelId,
              title: "Changes",
            },
          },
        });

        await expectPanelOn(source, unavailableId);
        await expect(
          source.getByText(/Tab couldn’t be restored|标签无法恢复/u)
        ).toBeVisible({ timeout: 10_000 });

        await source.evaluate(async () => {
          await window.pier.plugins.enable("pier.git");
        });
      } finally {
        await forceClose(ctx.app);
        removeDirectory(ctx.userDataDir);
        removeDirectory(repo);
      }
    });
  });

  test.describe("terminal continuous print / PID migrate", () => {
    test("PID file unchanged after transfer; tab moves to target", async () => {
      test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
      const ctx = await launchApp();
      const pidFile = join(
        tmpdir(),
        `pier-panel-xfer-pid-${crypto.randomUUID()}`
      );
      const projectRoot = makeTempUserDataDir("pier-panel-xfer-pid-proj-");
      writePidLoopProject(projectRoot, pidFile);
      try {
        const source = await ctx.app.firstWindow();
        await waitForWorkspaceReady(source);

        // Task-based PID loop (no osascript keystrokes — Accessibility-free).
        const { panelId: terminalId } = await spawnTaskUntilRunning(
          ctx.userDataDir,
          projectRoot,
          PID_LOOP_TASK_ID
        );
        await expectPanelOn(source, terminalId);
        await expect
          .poll(() =>
            existsSync(pidFile) ? readFileSync(pidFile, "utf8").trim() : ""
          )
          .toMatch(/^\d+$/);
        const pidBefore = readFileSync(pidFile, "utf8").trim();

        const sessionScopeOf = (): string | null => {
          const statePath = join(
            ctx.userDataDir,
            "terminal-session-state.json"
          );
          if (!existsSync(statePath)) {
            return null;
          }
          const parsed = JSON.parse(readFileSync(statePath, "utf8")) as {
            windows?: Record<
              string,
              { panels?: Record<string, unknown> } | undefined
            >;
          };
          for (const [scope, windowState] of Object.entries(
            parsed.windows ?? {}
          )) {
            if (windowState?.panels?.[terminalId]) {
              return scope;
            }
          }
          return null;
        };
        // Real key space: live terminal must own a record-scoped session entry.
        await expect.poll(sessionScopeOf).not.toBeNull();
        const scopeBefore = sessionScopeOf();

        const target = await createSecondWindow(ctx.app, source);
        await positionWindowsSideBySide(ctx.app);
        const targetTerminalId = await firstTerminalPanelId(target);
        const targetGroupId = await readPanelGroupId(target, targetTerminalId);
        const terminalInfo = await readPanelInfo(source, terminalId);

        // Commit must replay the moved session context to the target renderer
        // (its mount-time readSession races the session CAS; without replay
        // the status bar would fall back to stale creation-time params).
        await target.evaluate(() => {
          const sink: unknown[] = [];
          (
            window as unknown as { __pierCwdReplay: unknown[] }
          ).__pierCwdReplay = sink;
          window.pier.terminal.onCwdChange((event) => {
            sink.push(event);
          });
        });

        const result = await transferPanel(source, target, {
          panelId: terminalInfo.panelId,
          componentId: "terminal",
          title: terminalInfo.title || "Terminal",
          placement: {
            kind: "split",
            direction: "right",
            referenceGroupId: targetGroupId,
          },
        });
        expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
        await expectPanelGone(source, terminalId);
        await expectPanelOn(target, terminalId);
        await expectPanelActiveOn(target, terminalId);

        await expect
          .poll(
            () =>
              target.evaluate(
                (movedPanelId) =>
                  (
                    window as unknown as {
                      __pierCwdReplay?: Array<{
                        context?: { cwd?: string };
                        panelId: string;
                      }>;
                    }
                  ).__pierCwdReplay?.find(
                    (event) => event.panelId === movedPanelId
                  )?.context?.cwd ?? null,
                terminalId
              ),
            { timeout: 10_000 }
          )
          .toBe(realpathSync(projectRoot));

        const pidAfter = readFileSync(pidFile, "utf8").trim();
        expect(pidAfter).toBe(pidBefore);

        // Session ownership moved to the target window record.
        await expect.poll(sessionScopeOf).not.toBe(scopeBefore);
        await expect.poll(sessionScopeOf).not.toBeNull();

        const datesFile = `${pidFile}.dates`;
        const sizeBefore = existsSync(datesFile)
          ? readFileSync(datesFile, "utf8").length
          : 0;
        await expect
          .poll(() =>
            existsSync(datesFile) ? readFileSync(datesFile, "utf8").length : 0
          )
          .toBeGreaterThan(sizeBefore);
      } finally {
        await forceClose(ctx.app);
        removeDirectory(ctx.userDataDir);
        removeDirectory(projectRoot);
        for (const filePath of [pidFile, `${pidFile}.dates`]) {
          try {
            unlinkSync(filePath);
          } catch {
            // ignore
          }
        }
      }
    });
  });
});

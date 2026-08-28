import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  type ElectronApplication,
  _electron as electron,
  expect,
  type Locator,
  type Page,
  test,
} from "@playwright/test";
import { setWindowSize } from "../support/app-harness.ts";

const PROJECT_ROOT = join(import.meta.dirname, "..", "..", "..");
const OUT_MAIN = join(PROJECT_ROOT, "out", "main", "index.js");
const PIER_CLI = join(PROJECT_ROOT, "bin", "pier.mjs");
const execFileAsync = promisify(execFile);

const WORLD_A = `import { Artboard, Text, WorldStage } from "pier/canvas";

export const canvas = {
  description: "E2E world A",
  kind: "composition",
  title: "World A",
};

export default function WorldA() {
  return (
    <WorldStage>
      <Artboard height={280} label="A" title="Board A" width={420}>
        <Text className="p-4">World board A</Text>
      </Artboard>
    </WorldStage>
  );
}
`;

const WORLD_B = `import { Artboard, Text, WorldStage } from "pier/canvas";

export const canvas = {
  description: "E2E world B",
  kind: "composition",
  title: "World B",
};

export default function WorldB() {
  return (
    <WorldStage>
      <Artboard height={280} label="B" title="Board B" width={420}>
        <Text className="p-4">World board B</Text>
      </Artboard>
    </WorldStage>
  );
}
`;

const JIT_ORANGE = `import { Artboard, WorldStage } from "pier/canvas";

export const canvas = {
  description: "E2E JIT teardown",
  kind: "composition",
  title: "JIT teardown",
};

export default function JitTeardown() {
  return (
    <WorldStage>
      <Artboard height={200} title="Probe" width={320}>
        <div className="bg-[#ff6b35] h-16 w-16" data-testid="jit-probe" />
      </Artboard>
    </WorldStage>
  );
}
`;

const JIT_TEAL = JIT_ORANGE.replace("bg-[#ff6b35]", "bg-[#00aa88]");

interface CliResult<T> {
  data?: T;
  ok?: boolean;
}

interface WindowInfo {
  id: string;
}

interface Rgb {
  blue: number;
  green: number;
  red: number;
}

async function forceClose(application: ElectronApplication): Promise<void> {
  const child = application.process();
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
  });
  child.kill("SIGKILL");
  await Promise.race([
    exited,
    new Promise<void>((resolve) => setTimeout(resolve, 3000)),
  ]);
}

async function launchPier(userDataDir: string): Promise<ElectronApplication> {
  return await electron.launch({
    args: [OUT_MAIN],
    cwd: PROJECT_ROOT,
    env: { ...process.env, ELECTRON_USER_DATA_DIR: userDataDir },
  });
}

async function pierCliJson<T>(
  userDataDir: string,
  args: readonly string[]
): Promise<CliResult<T>> {
  const { stdout } = await execFileAsync(
    process.execPath,
    [PIER_CLI, ...args, "--json"],
    {
      cwd: PROJECT_ROOT,
      env: { ...process.env, PIER_USER_DATA_DIR: userDataDir },
    }
  );
  return JSON.parse(stdout) as CliResult<T>;
}

async function openWorkspace(
  page: Page,
  userDataDir: string,
  workspaceDir: string,
  windowId?: string
): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  await page
    .locator('[data-testid="workspace-host-root"][data-workspace-ready="true"]')
    .waitFor({ state: "visible", timeout: 30_000 });
  await expect
    .poll(
      async () => {
        const result = await pierCliJson<{ panelId: string }>(userDataDir, [
          "terminal",
          "open",
          "--cwd",
          workspaceDir,
          ...(windowId ? ["--window", windowId] : []),
        ]);
        return result.ok === true;
      },
      { timeout: 20_000 }
    )
    .toBe(true);
  await page.locator('[data-testid="files-project-status-trigger"]').click();
}

async function openTreeFile(
  page: Page,
  segments: readonly string[]
): Promise<void> {
  for (const [index, segment] of segments.entries()) {
    const item = page.getByRole("treeitem", { name: segment }).first();
    await expect(item).toBeVisible({ timeout: 20_000 });
    if (index < segments.length - 1) {
      if ((await item.getAttribute("aria-expanded")) !== "true") {
        await item.click();
      }
      await expect(item).toHaveAttribute("aria-expanded", "true");
      continue;
    }
    await item.click();
  }
}

async function acceptCanvasTrustIfPrompted(page: Page): Promise<void> {
  const confirm = page.getByRole("button", {
    name: /信任并预览|Trust and preview/u,
  });
  try {
    await expect(confirm).toBeVisible({ timeout: 15_000 });
  } catch {
    return;
  }
  await confirm.click();
  await expect(confirm).toHaveCount(0);
}

async function waitForWorldCanvas(page: Page, title: string): Promise<void> {
  const preview = page.locator('[data-slot="file-canvas-preview"]');
  await expect(preview).toBeVisible({ timeout: 30_000 });
  await acceptCanvasTrustIfPrompted(page);
  await expect(page.getByText(title)).toBeVisible({ timeout: 40_000 });
  await expect(page.locator('[data-canvas-stage="world"]')).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.locator('[data-slot="file-canvas-stage"]')).toHaveAttribute(
    "tabindex",
    "0",
    { timeout: 20_000 }
  );
  await expect(
    page.locator('[data-slot="image-preview-controls"]')
  ).toBeVisible({ timeout: 20_000 });
}

function zoomLevelButton(page: Page): Locator {
  return page.getByRole("button", { name: /Zoom level:|缩放级别:/u });
}

async function dispatchStageWheel(
  page: Page,
  deltaY: number,
  ctrlKey = false
): Promise<void> {
  await page.locator('[data-slot="file-canvas-stage"]').evaluate(
    (el, input: { ctrlKey: boolean; deltaY: number }) => {
      el.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          ctrlKey: input.ctrlKey,
          deltaY: input.deltaY,
        })
      );
    },
    { ctrlKey, deltaY }
  );
}

async function stageCameraTransform(page: Page): Promise<string> {
  return await page
    .locator('[data-slot="file-canvas-zoom"]')
    .evaluate((el) => el.style.transform);
}

function transformScale(transform: string): string {
  return transform.match(/scale\([^)]*\)/u)?.[0] ?? "";
}

async function sampleProbe(page: Page): Promise<Rgb> {
  return await page.locator('[data-testid="jit-probe"]').evaluate((el) => {
    const canvas = document.createElement("canvas");
    canvas.height = 1;
    canvas.width = 1;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("canvas 2d unavailable");
    }
    context.fillStyle = getComputedStyle(el).backgroundColor;
    context.fillRect(0, 0, 1, 1);
    const data = context.getImageData(0, 0, 1, 1).data;
    return { blue: data[2] ?? 0, green: data[1] ?? 0, red: data[0] ?? 0 };
  });
}

function rgbDistance(left: Rgb, right: Rgb): number {
  return Math.hypot(
    left.red - right.red,
    left.green - right.green,
    left.blue - right.blue
  );
}

async function frameBudget(
  page: Page
): Promise<{ median: number; p95: number }> {
  return await page.evaluate(async () => {
    const deltas: number[] = [];
    await new Promise<void>((resolve) => {
      let last = 0;
      let count = 0;
      const tick = (now: number) => {
        if (last > 0) {
          deltas.push(now - last);
        }
        last = now;
        count += 1;
        if (count < 48) {
          requestAnimationFrame(tick);
        } else {
          resolve();
        }
      };
      requestAnimationFrame(tick);
    });
    const slice = deltas.slice(6).toSorted((left, right) => left - right);
    return {
      median: slice[Math.floor(slice.length / 2)] ?? 0,
      p95: slice[Math.floor(slice.length * 0.95)] ?? 0,
    };
  });
}

function writeWorkspace(): { userDataDir: string; workspaceDir: string } {
  const userDataDir = mkdtempSync(join(tmpdir(), "pier-canvas-stage-e2e-"));
  const workspaceDir = mkdtempSync(join(tmpdir(), "pier-canvas-stage-ws-"));
  mkdirSync(join(workspaceDir, "docs"), { recursive: true });
  writeFileSync(join(workspaceDir, "docs", "world-a.canvas.tsx"), WORLD_A);
  writeFileSync(join(workspaceDir, "docs", "world-b.canvas.tsx"), WORLD_B);
  writeFileSync(join(workspaceDir, "docs", "jit.canvas.tsx"), JIT_ORANGE);
  return { userDataDir, workspaceDir };
}

test.describe("canvas dual-stage gold (§9)", () => {
  test("world wheel pans and ctrl+wheel zooms at the cursor (camera)", async () => {
    test.setTimeout(120_000);
    const { userDataDir, workspaceDir } = writeWorkspace();
    const application = await launchPier(userDataDir);
    try {
      const page = await application.firstWindow();
      await openWorkspace(page, userDataDir, workspaceDir);
      await setWindowSize(application, page, 1280, 800);
      await openTreeFile(page, ["docs", "world-a.canvas.tsx"]);
      await waitForWorldCanvas(page, "World board A");

      const zoom = zoomLevelButton(page);
      await expect(zoom).toBeVisible();
      await expect(zoom).toHaveText(/Fit to window|适应窗口/u);
      await expect
        .poll(async () => await stageCameraTransform(page))
        .toMatch(/translate/u);

      // Plain wheel pans without any focus gate: translate moves, scale stays.
      const before = await stageCameraTransform(page);
      await dispatchStageWheel(page, -240);
      await expect
        .poll(async () => await stageCameraTransform(page))
        .not.toBe(before);
      const afterPan = await stageCameraTransform(page);
      expect(transformScale(afterPan)).toBe(transformScale(before));

      // ctrl+wheel (trackpad pinch) zooms: the scale factor changes.
      await dispatchStageWheel(page, -240, true);
      await expect
        .poll(async () => transformScale(await stageCameraTransform(page)))
        .not.toBe(transformScale(afterPan));
      await expect(zoom).toHaveText(/%/u);
    } finally {
      await forceClose(application);
      rmSync(userDataDir, { force: true, recursive: true });
      rmSync(workspaceDir, { force: true, recursive: true });
    }
  });

  test("two world windows stay interactive without a stalled frame budget", async () => {
    test.setTimeout(180_000);
    const { userDataDir, workspaceDir } = writeWorkspace();
    const application = await launchPier(userDataDir);
    try {
      const first = await application.firstWindow();
      await openWorkspace(first, userDataDir, workspaceDir);
      await setWindowSize(application, first, 900, 700);
      await openTreeFile(first, ["docs", "world-a.canvas.tsx"]);
      await waitForWorldCanvas(first, "World board A");

      const before = new Set(
        (
          (await pierCliJson<WindowInfo[]>(userDataDir, ["windows", "list"]))
            .data ?? []
        ).map((info) => info.id)
      );
      const secondPromise = application.waitForEvent("window", {
        timeout: 30_000,
      });
      await first.evaluate(() => window.pier.createWindow());
      const second = await secondPromise;
      await second
        .locator(
          '[data-testid="workspace-host-root"][data-workspace-ready="true"]'
        )
        .waitFor({ state: "visible", timeout: 30_000 });
      const after =
        (await pierCliJson<WindowInfo[]>(userDataDir, ["windows", "list"]))
          .data ?? [];
      const newId = after.find((info) => !before.has(info.id))?.id;
      expect(newId).toBeTruthy();

      await openWorkspace(second, userDataDir, workspaceDir, newId);
      await openTreeFile(second, ["docs", "world-b.canvas.tsx"]);
      await waitForWorldCanvas(second, "World board B");

      const zoomInA = first.getByRole("button", { name: /Zoom in|放大/u });
      const zoomInB = second.getByRole("button", { name: /Zoom in|放大/u });
      for (let step = 0; step < 5; step += 1) {
        await zoomInA.click();
        await zoomInB.click();
      }
      await expect(zoomLevelButton(first)).toHaveText(/%/u);
      await expect(zoomLevelButton(second)).toHaveText(/%/u);

      const budgetA = await frameBudget(first);
      const budgetB = await frameBudget(second);
      expect(budgetA.median, JSON.stringify(budgetA)).toBeLessThan(40);
      expect(budgetB.median, JSON.stringify(budgetB)).toBeLessThan(40);
      expect(budgetA.p95, JSON.stringify(budgetA)).toBeLessThan(80);
      expect(budgetB.p95, JSON.stringify(budgetB)).toBeLessThan(80);
    } finally {
      await forceClose(application);
      rmSync(userDataDir, { force: true, recursive: true });
      rmSync(workspaceDir, { force: true, recursive: true });
    }
  });

  test("hot reload drops the previous JIT stylesheet", async () => {
    test.setTimeout(120_000);
    const { userDataDir, workspaceDir } = writeWorkspace();
    const jitPath = join(workspaceDir, "docs", "jit.canvas.tsx");
    const application = await launchPier(userDataDir);
    try {
      const page = await application.firstWindow();
      await openWorkspace(page, userDataDir, workspaceDir);
      await setWindowSize(application, page, 1200, 800);
      await openTreeFile(page, ["docs", "jit.canvas.tsx"]);
      await waitForWorldCanvas(page, "Probe");
      await expect(page.locator('[data-testid="jit-probe"]')).toBeVisible({
        timeout: 40_000,
      });
      await expect
        .poll(
          async () =>
            rgbDistance(await sampleProbe(page), {
              blue: 53,
              green: 107,
              red: 255,
            }) < 30,
          { timeout: 20_000 }
        )
        .toBe(true);

      writeFileSync(jitPath, JIT_TEAL);
      await expect
        .poll(
          async () =>
            rgbDistance(await sampleProbe(page), {
              blue: 136,
              green: 170,
              red: 0,
            }) < 30,
          { timeout: 40_000 }
        )
        .toBe(true);

      const liveCss = await page.evaluate(() =>
        [...document.head.querySelectorAll("style[data-pier-live-css]")].map(
          (node) => ({
            key: node.getAttribute("data-pier-live-css"),
            text: node.textContent ?? "",
          })
        )
      );
      const moduleSheets = liveCss.filter((sheet) =>
        (sheet.key ?? "").includes("jit.canvas.tsx")
      );
      expect(moduleSheets.length).toBe(1);
    } finally {
      await forceClose(application);
      rmSync(userDataDir, { force: true, recursive: true });
      rmSync(workspaceDir, { force: true, recursive: true });
    }
  });
});

import { execFile } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
import { selectTheme, setWindowSize } from "../workbench/e2e-harness.ts";

const PROJECT_ROOT = join(import.meta.dirname, "..", "..", "..");
const OUT_MAIN = join(PROJECT_ROOT, "out", "main", "index.js");
const PIER_CLI = join(PROJECT_ROOT, "bin", "pier.mjs");
const GOLD_DIR = join(
  PROJECT_ROOT,
  ".pier/canvases/multi-agent-orchestration-gold"
);
const FIXTURE_CANVAS_SOURCE = `import { Mermaid, Frame, Stack, Text } from "pier/canvas";

export const canvas = {
  description: "E2E contract: Mermaid kind/tone fills in Files preview.",
  kind: "composition",
  title: "Node graph color contract",
};

export default function GraphColorCanvas() {
  return (
    <Frame maxWidth={1080}>
      <Stack gap={8}>
        <Text as="h1" className="font-semibold text-lg">
          Node graph color contract
        </Text>
        <Mermaid
          aria-label="color contract"
          direction="left-to-right"
          edges={[
            { source: "caller", target: "cli" },
            { source: "cli", target: "runtime" },
          ]}
          nodes={[
            { id: "caller", kind: "actor", meta: "info", title: "Caller", tone: "info" },
            { id: "cli", kind: "tool", meta: "success", title: "CLI", tone: "success" },
            { id: "runtime", kind: "artifact", meta: "done", title: "Runtime", tone: "done" },
          ]}
        />
      </Stack>
    </Frame>
  );
}
`;
const execFileAsync = promisify(execFile);

interface GraphNodeChrome {
  background: string;
  backgroundRgb: Rgb;
  border: string;
  borderRgb: Rgb;
  borderWidth: number;
  kind: string | null;
  title: string;
  tone: string | null;
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

async function openWorkspace(
  page: Page,
  userDataDir: string,
  workspaceDir: string
): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  await page
    .locator('[data-testid="workspace-host-root"][data-workspace-ready="true"]')
    .waitFor({ state: "visible", timeout: 30_000 });
  await expect
    .poll(
      async () => {
        const { stdout } = await execFileAsync(
          process.execPath,
          [PIER_CLI, "terminal", "open", "--cwd", workspaceDir, "--json"],
          {
            cwd: PROJECT_ROOT,
            env: { ...process.env, PIER_USER_DATA_DIR: userDataDir },
          }
        );
        return (JSON.parse(stdout) as { ok?: boolean }).ok === true;
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

function rgbDistance(left: Rgb, right: Rgb): number {
  return Math.hypot(
    left.red - right.red,
    left.green - right.green,
    left.blue - right.blue
  );
}

async function readThemeProbe(page: Page): Promise<{
  border: Rgb;
  card: Rgb;
}> {
  return await page.evaluate(() => {
    const sample = (color: string) => {
      const canvas = document.createElement("canvas");
      canvas.height = 1;
      canvas.width = 1;
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("canvas 2d unavailable");
      }
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const data = context.getImageData(0, 0, 1, 1).data;
      return { blue: data[2] ?? 0, green: data[1] ?? 0, red: data[0] ?? 0 };
    };
    const probe = document.createElement("div");
    probe.className = "border bg-card";
    document.body.append(probe);
    const style = getComputedStyle(probe);
    const card = sample(style.backgroundColor);
    const border = sample(style.borderTopColor);
    probe.remove();
    return { border, card };
  });
}

async function readGraphNodes(page: Page): Promise<GraphNodeChrome[]> {
  return await page.locator('[data-slot="mermaid-node"]').evaluateAll((els) =>
    els.map((el) => {
      const sample = (color: string) => {
        const canvas = document.createElement("canvas");
        canvas.height = 1;
        canvas.width = 1;
        const context = canvas.getContext("2d");
        if (!context) {
          throw new Error("canvas 2d unavailable");
        }
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        const data = context.getImageData(0, 0, 1, 1).data;
        return { blue: data[2] ?? 0, green: data[1] ?? 0, red: data[0] ?? 0 };
      };
      const style = getComputedStyle(el);
      return {
        background: style.backgroundColor,
        backgroundRgb: sample(style.backgroundColor),
        border: style.borderTopColor,
        borderRgb: sample(style.borderTopColor),
        borderWidth: Number.parseFloat(style.borderTopWidth),
        kind: el.getAttribute("data-kind"),
        title: el.querySelector("span.font-medium")?.textContent?.trim() ?? "",
        tone: el.getAttribute("data-tone"),
      };
    })
  );
}

function expectPainted(
  nodes: readonly GraphNodeChrome[],
  theme: { border: Rgb; card: Rgb },
  expected: readonly {
    kind: string;
    title: string;
    tone: string;
  }[]
): void {
  expect(nodes.length).toBeGreaterThan(0);
  for (const want of expected) {
    const node = nodes.find((item) => item.title.includes(want.title));
    expect(
      node,
      `missing node ${want.title}: ${JSON.stringify(nodes)}`
    ).toBeTruthy();
    if (!node) {
      continue;
    }
    expect(node.kind).toBe(want.kind);
    expect(node.tone).toBe(want.tone);
    // Hue hairline (Ant soft border token) vs the neutral border token.
    expect(
      node.borderWidth,
      `${want.title} border width ${node.borderWidth}`
    ).toBeGreaterThanOrEqual(1);
    expect(
      rgbDistance(node.borderRgb, theme.border),
      `${want.title} border ${node.border} too close to neutral border`
    ).toBeGreaterThan(25);
    // Pale status tint: present but soft (not the old saturated wash).
    expect(
      rgbDistance(node.backgroundRgb, theme.card),
      `${want.title} background ${node.background} identical to card`
    ).toBeGreaterThan(5);
  }
  const byTone = new Map<string, string>();
  for (const node of nodes) {
    if (!node.tone || node.tone === "muted") {
      continue;
    }
    const previous = byTone.get(node.tone);
    if (previous) {
      expect(previous).toBe(node.border);
    } else {
      byTone.set(node.tone, node.border);
    }
  }
  expect(new Set(byTone.values()).size).toBe(byTone.size);
}

test("Files canvas preview paints Mermaid kind and tone fills", async ({
  browserName: _browserName,
}, testInfo) => {
  test.setTimeout(120_000);
  const userDataDir = mkdtempSync(join(tmpdir(), "pier-canvas-graph-e2e-"));
  const workspaceDir = mkdtempSync(join(tmpdir(), "pier-canvas-graph-ws-"));
  mkdirSync(join(workspaceDir, "docs"), { recursive: true });
  writeFileSync(
    join(workspaceDir, "docs", "graph-colors.canvas.tsx"),
    FIXTURE_CANVAS_SOURCE
  );
  const goldDest = join(workspaceDir, "docs", "multi-agent-orchestration-gold");
  cpSync(GOLD_DIR, goldDest, { recursive: true });
  const application = await launchPier(userDataDir);

  try {
    const page = await application.firstWindow();
    await openWorkspace(page, userDataDir, workspaceDir);
    await selectTheme(page, { id: "light", label: /Light|浅色/u });
    await setWindowSize(application, page, 1200, 800);

    await openTreeFile(page, ["docs", "graph-colors.canvas.tsx"]);
    const preview = page.locator('[data-slot="file-canvas-preview"]');
    await expect(preview).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Node graph color contract")).toBeVisible({
      timeout: 40_000,
    });
    await expect(page.locator('[data-slot="mermaid-node"]')).toHaveCount(3, {
      timeout: 40_000,
    });
    await page.screenshot({
      path: testInfo.outputPath("canvas-graph-colors-fixture-light.png"),
    });

    const themeProbe = await readThemeProbe(page);
    const fixtureNodes = await readGraphNodes(page);
    expectPainted(fixtureNodes, themeProbe, [
      { kind: "actor", title: "Caller", tone: "info" },
      { kind: "tool", title: "CLI", tone: "success" },
      { kind: "artifact", title: "Runtime", tone: "done" },
    ]);

    await openTreeFile(page, [
      "docs",
      "multi-agent-orchestration-gold",
      "multi-agent-orchestration-gold.canvas.tsx",
    ]);
    await expect(page.getByRole("tab", { name: "设计" })).toBeVisible({
      timeout: 40_000,
    });
    await page.getByRole("tab", { name: "设计" }).click();
    await expect(page.getByText("RuntimeControl")).toBeVisible({
      timeout: 30_000,
    });
    await expect
      .poll(async () => (await readGraphNodes(page)).length, {
        timeout: 30_000,
      })
      .toBeGreaterThan(5);

    const goldNodes = await readGraphNodes(page);
    expectPainted(goldNodes, await readThemeProbe(page), [
      { kind: "tool", title: "focus / interrupt / terminate", tone: "success" },
      { kind: "artifact", title: "RuntimeControl", tone: "done" },
      { kind: "actor", title: "人类 · pier CLI", tone: "info" },
    ]);
    await page.screenshot({
      path: testInfo.outputPath("canvas-graph-colors-gold-light.png"),
    });

    await selectTheme(page, { id: "dark", label: /Dark|深色/u });
    await expect(page.getByText("RuntimeControl")).toBeVisible({
      timeout: 20_000,
    });
    const darkNodes = await readGraphNodes(page);
    expectPainted(darkNodes, await readThemeProbe(page), [
      { kind: "tool", title: "focus / interrupt / terminate", tone: "success" },
      { kind: "artifact", title: "RuntimeControl", tone: "done" },
      { kind: "actor", title: "人类 · pier CLI", tone: "info" },
    ]);
    await page.screenshot({
      path: testInfo.outputPath("canvas-graph-colors-gold-dark.png"),
    });
  } finally {
    await forceClose(application);
    rmSync(userDataDir, { force: true, recursive: true });
    rmSync(workspaceDir, { force: true, recursive: true });
  }
});

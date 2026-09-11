import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { chromium } from "playwright";
import { createServer } from "vite";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outDir = resolve(root, "test-results/canvas-review");
mkdirSync(outDir, { recursive: true });

const PAD = 40;
const PATH_IDS = [
  "hosts",
  "workbench",
  "session",
  "changes",
  "diff",
  "pair",
  "inbox",
  "files",
  "preview",
  "pairCamera",
  "sessionEnded",
  "disconnected",
];

const server = await createServer({
  configFile: false,
  plugins: [react(), tailwindcss()],
  root: resolve(root, "tests/visual"),
  resolve: {
    alias: {
      "@": resolve(root, "src/renderer"),
      "@shared": resolve(root, "src/shared"),
      "@main": resolve(root, "src/main"),
      "@plugins": resolve(root, "src/plugins"),
      "@pier/ui": resolve(root, "packages/ui/src"),
      "pier/canvas": resolve(root, "tests/support/pier-canvas.ts"),
      "pier/host": resolve(root, "tests/support/pier-host.ts"),
    },
  },
  optimizeDeps: { force: true },
  server: { port: 4180, strictPort: true },
});
await server.listen();

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1600, height: 1000 },
});
await page.goto(
  "http://localhost:4180/canvas-diagram-review.html?scene=mobile",
  { waitUntil: "load", timeout: 60_000 }
);
await page.waitForSelector("[data-canvas-stage='world']", { timeout: 30_000 });
await page.waitForSelector("[data-slot='workflow-edge']", {
  state: "attached",
  timeout: 30_000,
});
await page.waitForTimeout(800);

async function measure(ids) {
  return page.evaluate((nextIds) => {
    const plane = document.querySelector("[data-canvas-stage='world']");
    if (!(plane instanceof HTMLElement)) {
      return null;
    }
    const planeRect = plane.getBoundingClientRect();
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    const add = (el) => {
      if (!(el instanceof Element)) {
        return;
      }
      const rect = el.getBoundingClientRect();
      minX = Math.min(minX, rect.left);
      minY = Math.min(minY, rect.top);
      maxX = Math.max(maxX, rect.right);
      maxY = Math.max(maxY, rect.bottom);
    };
    if (nextIds === "stage") {
      add(plane);
    } else {
      add(document.querySelector("[data-slot='mobile-shell-note']"));
      add(document.querySelector("[data-slot='screen-flow-start']"));
      for (const id of nextIds) {
        add(document.querySelector(`[data-artboard-id='${id}']`));
      }
      for (const el of plane.querySelectorAll(
        "[data-slot='workflow-edge-label'], [data-slot='workflow-edge-arrow']"
      )) {
        add(el);
      }
    }
    if (!Number.isFinite(minX)) {
      return null;
    }
    return {
      height: maxY - minY,
      ox: minX - planeRect.left,
      oy: minY - planeRect.top,
      width: maxX - minX,
    };
  }, ids);
}

async function frameRegion(bounds, maxWidth, maxHeight) {
  const scale = Math.min(
    1,
    (maxWidth - PAD * 2) / bounds.width,
    (maxHeight - PAD * 2) / bounds.height
  );
  const viewW = Math.ceil(bounds.width * scale + PAD * 2);
  const viewH = Math.ceil(bounds.height * scale + PAD * 2);
  await page.setViewportSize({ width: viewW, height: viewH });
  await page.evaluate(
    ({ box, pad, nextScale }) => {
      const plane = document.querySelector("[data-canvas-stage='world']");
      if (!(plane instanceof HTMLElement)) {
        return;
      }
      document.body.style.margin = "0";
      document.body.style.overflow = "hidden";
      document.documentElement.style.background =
        getComputedStyle(plane).backgroundColor;
      plane.style.transformOrigin = "0 0";
      plane.style.transform = `translate(${pad - box.ox * nextScale}px, ${pad - box.oy * nextScale}px) scale(${nextScale})`;
    },
    { box: bounds, pad: PAD, nextScale: scale }
  );
  await page.waitForTimeout(200);
  return scale;
}

const pathBounds = await measure(PATH_IDS);
const worldBounds = await measure("stage");
if (pathBounds === null || worldBounds === null) {
  throw new Error("bounds missing");
}

const pathScale = await frameRegion(pathBounds, 2600, 2400);
await page.screenshot({
  path: resolve(outDir, "mobile-shell-fit.png"),
  animations: "disabled",
});
await page.screenshot({
  path: resolve(outDir, "mobile-shell-path.png"),
  animations: "disabled",
});

const hosts = page.locator("[data-artboard-id='hosts']");
if ((await hosts.count()) > 0) {
  await hosts.first().evaluate((el) => {
    el.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
  });
  await page.waitForTimeout(800);
  await page.screenshot({
    path: resolve(outDir, "mobile-shell-hover.png"),
    animations: "disabled",
  });
}

const worldScale = await frameRegion(worldBounds, 2400, 1400);
await page.screenshot({
  path: resolve(outDir, "mobile-shell-full.png"),
  animations: "disabled",
});

await browser.close();
await server.close();
console.log(
  `wrote ${outDir} pathScale=${pathScale.toFixed(3)} worldScale=${worldScale.toFixed(3)}`
);

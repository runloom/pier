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
  server: { port: 4179, strictPort: true },
});
await server.listen();
console.log(server.resolvedUrls);

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 2000, height: 1200 },
});

async function capture(scene, name, hover) {
  await page.goto(
    `http://localhost:4179/canvas-diagram-review.html?scene=${scene}`,
    { waitUntil: "load" }
  );
  await page.waitForTimeout(600);
  if (hover) {
    await page.locator(hover).first().evaluate((el) => {
      el.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    });
    await page.waitForTimeout(700);
  }
  const target =
    scene === "design"
      ? page.locator("[data-canvas-stage='world']").first()
      : page.locator("[data-slot='workflow-diagram']").first();
  await target.screenshot({
    path: resolve(outDir, `${name}.png`),
  });
}

await capture("workflow", "workflow-idle");
await capture("workflow", "workflow-hover", "[data-node-id='approval']");
await capture("design", "design-idle");
await capture("design", "design-hover", "[data-artboard-id='confirm']");

await browser.close();
await server.close();
console.log(`wrote ${outDir}`);

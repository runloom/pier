import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { chromium } from "playwright";
import { createServer } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const outDir = resolve(root, "tests/support/gold-architecture-shot/out");
mkdirSync(outDir, { recursive: true });

/** `node screenshot.mjs [gold|materials|dag|live]` — which architecture graph to shoot. */
const graphId = ["dag", "gold", "live", "materials"].includes(
  process.argv[2] ?? ""
)
  ? process.argv[2]
  : "gold";

const server = await createServer({
  configFile: false,
  root,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(root, "src/renderer"),
      "@shared": resolve(root, "src/shared"),
      "@main": resolve(root, "src/main"),
      "@preload": resolve(root, "src/preload"),
      "@plugins": resolve(root, "src/plugins"),
      "@pier/ui": resolve(root, "packages/ui/src"),
      "pier/canvas": resolve(root, "tests/support/pier-canvas.ts"),
    },
  },
  server: {
    fs: { allow: [root] },
    host: "127.0.0.1",
    port: 4181,
    strictPort: true,
  },
});

await server.listen();
const localUrl = server.resolvedUrls?.local[0];
if (!localUrl) {
  throw new Error("vite did not bind a local URL");
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1100, height: 900 },
  deviceScaleFactor: 2,
});
page.on("pageerror", (error) => {
  console.error("pageerror", error);
});
page.on("console", (msg) => {
  if (msg.type() === "error") {
    console.error("console", msg.text());
  }
});

await page.goto(
  `${localUrl}tests/support/gold-architecture-shot/?graph=${graphId}`,
  { waitUntil: "networkidle" }
);
await page.locator('[data-slot="mermaid-node"]').first().waitFor({
  timeout: 20_000,
});
await page.waitForTimeout(800);

const probe = await page.evaluate(() => {
  const glyphStyle = (el) => {
    const style = getComputedStyle(el);
    return {
      color: style.color,
      fill: style.fill,
      height: style.height,
      stroke: style.stroke,
      width: style.width,
    };
  };
  const cards = [...document.querySelectorAll('[data-slot="mermaid-node"]')];
  return cards.map((card) => {
    const style = getComputedStyle(card);
    const title = card.querySelector("span.font-medium")?.textContent ?? "";
    const icon = card.querySelector("[data-icon]");
    const status = card.querySelector("[data-run-status]");
    const path = card.querySelector("[data-icon] path, [data-run-status] path");
    const rule = card.querySelector(".h-px");
    const action = card.querySelector('[data-slot="button"]');
    const footer = card.querySelector('[data-slot="mermaid-node-content"]');
    const footerChild = footer?.firstElementChild;
    const footerChildStyle = footerChild ? getComputedStyle(footerChild) : null;
    const statusStyle = status ? getComputedStyle(status) : null;
    return {
      background: style.backgroundColor,
      action: action
        ? {
            background: getComputedStyle(action).backgroundColor,
            border: getComputedStyle(action).borderColor,
            color: getComputedStyle(action).color,
            gapFromRule: rule
              ? Math.round(
                  action.getBoundingClientRect().top -
                    rule.getBoundingClientRect().bottom
                )
              : null,
            height: getComputedStyle(action).height,
            variant: action.getAttribute("data-variant"),
          }
        : null,
      footer: footerChildStyle
        ? {
            color: footerChildStyle.color,
            fontSize: footerChildStyle.fontSize,
            fontWeight: footerChildStyle.fontWeight,
          }
        : null,
      icon: icon ? glyphStyle(icon) : null,
      kind: card.getAttribute("data-kind"),
      path: path ? glyphStyle(path) : null,
      status: statusStyle
        ? {
            border: statusStyle.borderTopColor,
            color: statusStyle.color,
            height: statusStyle.height,
            name: status.getAttribute("data-run-status"),
            width: statusStyle.width,
          }
        : null,
      title: title.trim(),
      tone: card.getAttribute("data-tone"),
    };
  });
});

writeFileSync(
  resolve(outDir, `probe-${graphId}.json`),
  `${JSON.stringify(probe, null, 2)}\n`
);

await page.screenshot({
  path: resolve(outDir, `architecture-${graphId}-light.png`),
  fullPage: true,
});
await page.locator('[data-slot="mermaid"]').screenshot({
  path: resolve(outDir, `architecture-${graphId}-light-graph.png`),
});
await page.locator('[data-kind="tool"]').screenshot({
  path: resolve(outDir, `architecture-${graphId}-light-compile.png`),
});
await page.locator('[data-kind="artifact"]').screenshot({
  path: resolve(outDir, `architecture-${graphId}-light-publish.png`),
});

await browser.close();
await server.close();
console.log(`wrote ${outDir}`);
console.log(JSON.stringify(probe, null, 2));

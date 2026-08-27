/**
 * Canvas 双模式壳治理（设计稿：2026-08-26-canvas-dual-stage-and-ui-expansion-design.md §3）。
 *
 * 锁定：
 * 1. 一个壳 — stage 判定单一来源在 canvas-stage.ts；预览目录无第二处推断。
 * 2. 无 fork — world 交互只消费 @pier/ui image-preview 的共享缩放数学
 *    （useZoomPanViewport / ImagePreviewControls / INTERACTIVE_PAN_IGNORE），
 *    预览目录不得自写缩放数学；canvas.tsx 不得 import HtmlWorldCanvas
 *    （包 stage 会重挂 live-module host）。
 * 3. world 视口：相机 transform（overflow-hidden，无滚动条）；wheel = 平移，
 *    ctrl+wheel = 光标锚定缩放，无聚焦门控。
 * 4. WorldStage marker 唯一所有者是 pier-canvas-artboard.tsx。
 * 5. flow 版心 class（max-w-5xl）只出自 canvas-stage.ts。
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../../../..");
const PREVIEW_DIR = join(ROOT, "src/plugins/builtin/files/renderer/preview");

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function previewSources(): { name: string; text: string }[] {
  return readdirSync(PREVIEW_DIR)
    .filter((name) => name.endsWith(".ts") || name.endsWith(".tsx"))
    .map((name) => ({
      name,
      text: readFileSync(join(PREVIEW_DIR, name), "utf8"),
    }));
}

describe("canvas stage governance", () => {
  it("keeps stage detection single-sourced in canvas-stage.ts", () => {
    const offenders = previewSources()
      .filter(({ name }) => name !== "canvas-stage.ts")
      .filter(({ text }) => text.includes("data-canvas-stage"))
      .map(({ name }) => name);
    expect(offenders).toEqual([]);
  });

  it("reuses the shared world camera implementation (no fork)", () => {
    const viewport = read(
      "src/plugins/builtin/files/renderer/preview/use-canvas-stage-viewport.ts"
    );
    expect(viewport).toContain(
      'from "@pier/ui/image-preview/use-world-camera.ts"'
    );
    expect(viewport).toContain(
      'from "@pier/ui/image-preview/world-canvas.tsx"'
    );
    // No local camera/zoom math in canvas shell files: the shared hook owns
    // fit/clamp/anchor math (image.tsx is the image previewer itself).
    const offenders = previewSources()
      .filter(({ name }) => name.includes("canvas"))
      .filter(({ text }) =>
        /measureContainScale|zoomCameraAt|softClampCamera|fitCamera|clampZoom/.test(
          text
        )
      )
      .map(({ name }) => name);
    expect(offenders).toEqual([]);
  });

  it("locks the world viewport to a camera transform (no scroll pan)", () => {
    const frame = read("packages/ui/src/image-preview/world-canvas.tsx");
    // Camera model: overflow-hidden viewport (no scrollbar exists to hide),
    // one transform layer driven by cameraStyle.
    expect(frame).toContain("overflow-hidden bg-background");
    expect(frame).not.toContain("overflow-auto bg-background p-3");
    const cameraHook = read(
      "packages/ui/src/image-preview/use-world-camera.ts"
    );
    expect(cameraHook).toContain("zoomCameraAt");
    expect(cameraHook).toContain("softClampCamera");
    // Plain wheel pans; ctrl+wheel (trackpad pinch) zooms at the cursor.
    expect(cameraHook).toContain("event.ctrlKey");
    expect(cameraHook).not.toContain("scrollLeft");
  });

  it("keeps the world viewport chrome single-sourced in WorldViewportFrame", () => {
    // One frame for both shells: ZoomPanWorldStage and the files preview.
    // The files preview passes active={worldStage && showHost} so flipping
    // flow ↔ world renders `contents` wrappers and never re-parents the
    // imperative live-module host.
    const shell = read("src/plugins/builtin/files/renderer/preview/canvas.tsx");
    expect(shell).toContain("WorldViewportFrame");
    expect(shell).not.toContain("style={worldActive ? { zoom:");
    expect(shell).not.toContain("onPointerDown={worldActive");
    const world = read("packages/ui/src/image-preview/world-canvas.tsx");
    expect(world).toContain("export function WorldViewportFrame");
    expect(
      world.match(/style=\{active \? camera\.cameraStyle : undefined\}/g)
    ).toHaveLength(1);
  });

  it("re-detects the composed root after a remount nonce and host mutations", () => {
    const viewport = read(
      "src/plugins/builtin/files/renderer/preview/use-canvas-stage-viewport.ts"
    );
    expect(viewport).toContain("[hostEl, nonce, stateKind]");
    expect(viewport).toContain("MutationObserver");
  });

  it("uses canvas stage copy for zoom chrome (not image preview copy)", () => {
    const viewport = read(
      "src/plugins/builtin/files/renderer/preview/use-canvas-stage-viewport.ts"
    );
    expect(viewport).toContain("filePanel.canvas.stage.controlsLabel");
    expect(viewport).not.toContain("filePanel.image");
  });

  it("wheel pans without a focus gate (standard canvas semantics)", () => {
    const viewport = read(
      "src/plugins/builtin/files/renderer/preview/use-canvas-stage-viewport.ts"
    );
    // The old focus gate existed because plain wheel used to zoom; with
    // wheel = pan there is no competing scroll target in world mode.
    expect(viewport).not.toContain("contains(document.activeElement)");
    expect(viewport).not.toContain("onStageWheel");
  });

  it("keeps the WorldStage marker owned by the pier/canvas primitive", () => {
    const artboard = read(
      "src/renderer/lib/live-modules/pier-canvas-artboard.tsx"
    );
    expect(artboard).toContain('data-canvas-stage="world"');
  });

  it("keeps the DocsShell marker owned by the pier/canvas primitive", () => {
    const layout = read("src/renderer/lib/live-modules/pier-canvas-layout.ts");
    expect(layout).toContain("data-canvas-docs");
  });

  it("does not wrap the live-module host in HtmlWorldCanvas", () => {
    const shell = read("src/plugins/builtin/files/renderer/preview/canvas.tsx");
    expect(shell).not.toContain("HtmlWorldCanvas");
  });

  it("matches markdown 13px body on the DocsShell reading surface", () => {
    const css = read("src/renderer/app/globals.css");
    expect(css).toContain(
      "[data-pier-canvas-shell][data-canvas-reading] [data-reading-surface]"
    );
    expect(css).toContain("calc(13px * var(--md-scale, 1))");
    expect(css).not.toContain("calc(14px * var(--md-scale, 1))");
    const layout = read("src/renderer/lib/live-modules/pier-canvas-layout.ts");
    expect(layout).toContain("fontSize: 13");
    expect(layout).toContain("var(--md-scale, 1)");
  });

  it("keeps flow measure classes in canvas-stage.ts", () => {
    const stage = read(
      "src/plugins/builtin/files/renderer/preview/canvas-stage.ts"
    );
    expect(stage).toContain("max-w-5xl");
    expect(stage).toContain("canvasFlowMeasureClass");
    const shell = read("src/plugins/builtin/files/renderer/preview/canvas.tsx");
    expect(shell).toContain("canvasFlowMeasureClass");
    expect(shell).not.toContain("max-w-5xl");
  });
});

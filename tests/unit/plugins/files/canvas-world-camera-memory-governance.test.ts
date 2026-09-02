import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SPEC =
  "docs/superpowers/specs/2026-09-01-canvas-world-camera-memory-gold-standard.md";
const DUAL =
  "docs/superpowers/specs/2026-08-26-canvas-dual-stage-and-ui-expansion-design.md";
const AGENTS = "AGENTS.md";
const MEMORY =
  "src/plugins/builtin/files/renderer/preview/canvas-camera-memory.ts";
const VIEWPORT =
  "src/plugins/builtin/files/renderer/preview/use-canvas-stage-viewport.ts";
const MATH = "packages/ui/src/image-preview/canvas-math.ts";
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

describe("canvas world camera memory gold standard", () => {
  it("documents the contract in AGENTS.md and the 2026-09-01 spec", () => {
    const agents = read(AGENTS);
    const spec = read(SPEC);
    const dual = read(DUAL);
    expect(agents).toContain("### Canvas 画板视口记忆");
    expect(agents).toContain(
      "tests/unit/plugins/files/canvas-world-camera-memory-governance.test.ts"
    );
    expect(agents).toContain("worldX");
    expect(agents).toContain("不进 userData");
    expect(spec).toContain("一句话终态");
    expect(spec).toContain("worldX");
    expect(spec).toContain("禁止 nonce");
    expect(spec).toContain("不进 userData");
    expect(spec).toContain("禁止复活这些路径");
    expect(dual).toContain(
      "2026-09-01-canvas-world-camera-memory-gold-standard.md"
    );
    expect(dual).toContain("原世界中心仍在视口中心");
  });

  it("persists look-at, not screen translate, keyed without nonce", () => {
    const memory = read(MEMORY);
    const viewport = read(VIEWPORT);
    expect(memory).toContain("worldX");
    expect(memory).toContain("worldY");
    expect(memory).toContain("v: 1");
    expect(memory).not.toContain("readonly x: number");
    expect(viewport).toContain("resetKey: cameraMemoryKey");
    expect(viewport).not.toMatch(/\$\{path\}:\$\{nonce\}/u);
    expect(viewport).toContain("camera.lookAt");
    expect(viewport).toContain("worldX: memory.worldX");
    expect(viewport).not.toContain('addEventListener("storage"');
  });

  it("keeps look-at math in canvas-math (no fork in the preview dir)", () => {
    const math = read(MATH);
    expect(math).toContain("export function worldPointAtViewportCenter");
    expect(math).toContain("export function cameraLookingAtWorld");
    const offenders = previewSources()
      .filter(({ name }) => name.includes("canvas"))
      .filter(({ text }) =>
        /measureContainScale|zoomCameraAt|softClampCamera|fitCamera|clampZoom|cameraLookingAtWorld|worldPointAtViewportCenter/.test(
          text
        )
      )
      .map(({ name }) => name);
    expect(offenders).toEqual([]);
  });
});

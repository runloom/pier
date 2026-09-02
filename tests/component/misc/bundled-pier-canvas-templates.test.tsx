import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePierCanvasMeta } from "@shared/contracts/pier-canvas.ts";
import { cleanup, render } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it } from "vitest";

const TEMPLATE_LOADERS = import.meta.glob<Record<string, unknown>>(
  "../../../resources/system-skills/pier-canvas/templates/*.canvas.tsx"
);

const TEMPLATES_DIR = join(
  process.cwd(),
  "resources/system-skills/pier-canvas/templates"
);

function templateSource(name: string): string {
  return readFileSync(join(TEMPLATES_DIR, name), "utf8");
}

afterEach(cleanup);

describe("bundled Pier Canvas templates", () => {
  it("direct-mounts one template for every Canvas kind against the host export facade", async () => {
    const kinds = new Set<string>();
    let appletBacked = 0;

    for (const [path, load] of Object.entries(TEMPLATE_LOADERS)) {
      const name = path.split("/").at(-1);
      if (!name) {
        throw new Error(`unrecognized template path: ${path}`);
      }
      const source = templateSource(name);
      if (source.includes("@pier-applet/")) {
        appletBacked += 1;
        expect(source).toContain("export default function");
        expect(source).toContain("export const canvas");
        continue;
      }
      const module = await load();
      const Canvas = module.default as ComponentType | undefined;
      if (typeof Canvas !== "function") {
        throw new Error(`${path} must default-export a component`);
      }
      const metadata = parsePierCanvasMeta(module.canvas);
      expect(
        metadata,
        `${path} must export valid Canvas metadata`
      ).not.toBeNull();
      if (metadata) {
        kinds.add(metadata.kind);
      }

      const { container, unmount } = render(<Canvas />);
      expect(container.firstChild, `${path} must mount content`).not.toBeNull();
      unmount();
    }

    expect(appletBacked).toBeGreaterThan(0);
    expect([...kinds].sort()).toEqual(["composition", "docs", "kit"]);
  });

  it("keeps the reading-flow showcase above skeleton quality", () => {
    // Design: 2026-08-30-canvas-flow-world-showcase-design.md §3.3 — the docs
    // template is the flow-stage showcase; regressing to a bare skeleton is
    // the root cause of low-quality generated canvases.
    const source = templateSource("docs.canvas.tsx");
    expect(source).toContain("DocsShell");
    expect(source).toContain("<Mermaid");
    expect(source).toContain("data-pier-comment-id");
    const navItems = source.match(/\{ id: "/g) ?? [];
    expect(navItems.length).toBeGreaterThanOrEqual(4);
  });

  it("keeps the board-stage showcase above skeleton quality", () => {
    const source = templateSource("design-mockup.canvas.tsx");
    expect(source).toContain("WorldStage");
    expect(source).toContain("data-pier-comment-id");
    const artboards = source.match(/<Artboard/g) ?? [];
    expect(artboards.length).toBeGreaterThanOrEqual(3);
    const presets = new Set(
      [...source.matchAll(/preset="([a-z]+)"/g)].map((match) => match[1])
    );
    expect(presets.size).toBeGreaterThanOrEqual(2);
    expect(source).not.toContain("className={`");
    expect(source).not.toContain("h-auto");
  });

  it("keeps tracker skins as thin applet islands, not a local ledger", () => {
    for (const name of ["task-list.canvas.tsx", "task-dag.canvas.tsx"]) {
      const source = templateSource(name);
      expect(source).toContain("@pier-applet/pier.tasks/");
      expect(source).toContain('from "pier/canvas"');
      expect(source).toContain("<Frame");
      expect(source).toContain("export default function");
      expect(source).not.toContain("useCanvasFile");
      expect(source).not.toContain("board.json");
      expect(source).not.toContain("tracker-board");
    }
    expect(existsSync(join(TEMPLATES_DIR, "tracker-board.canvas.tsx"))).toBe(
      false
    );
  });
});

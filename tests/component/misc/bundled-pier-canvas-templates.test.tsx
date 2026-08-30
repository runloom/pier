import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePierCanvasMeta } from "@shared/contracts/pier-canvas.ts";
import { cleanup, render } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it } from "vitest";

const TEMPLATE_MODULES = import.meta.glob<Record<string, unknown>>(
  "../../../resources/system-skills/pier-canvas/templates/*.canvas.tsx",
  { eager: true }
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
  it("direct-mounts one template for every Canvas kind against the host export facade", () => {
    const kinds = new Set<string>();

    for (const [path, module] of Object.entries(TEMPLATE_MODULES)) {
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

  it("keeps the kanban starter wired to sibling-file persistence", () => {
    // recipe=board teaching contract: disk is the source of truth. The
    // starter must actually read/write/watch board.json, not just import
    // the hook (that regression shipped once).
    const source = templateSource("kanban.canvas.tsx");
    expect(source).toContain("useCanvasFile");
    expect(source).toContain("file.read(");
    expect(source).toContain("file.write(");
    expect(source).toContain("file.watch(");
    expect(source).toContain("schemaVersion");
    expect(source).toContain("onDropItem");
    // `justify` takes CSS values; "between" silently does nothing.
    expect(source).not.toContain('justify="between"');
    expect(source).toContain("cardsRef");
    expect(source).toContain("persistLatest");
  });
});

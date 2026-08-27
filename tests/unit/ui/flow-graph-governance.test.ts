import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function dirSource(rel: string): string {
  const dir = join(ROOT, rel);
  return readdirSync(dir)
    .filter((name) => name.endsWith(".ts") || name.endsWith(".tsx"))
    .map((name) => readFileSync(join(dir, name), "utf8"))
    .join("\n");
}

describe("FlowGraph / DnD canvas primitives", () => {
  it("does not expose topology editing or react-flow", () => {
    const source = dirSource("packages/ui/src/flow-graph");
    expect(source).not.toMatch(/onConnect\b/);
    expect(source).not.toMatch(/onAddEdge\b/);
    expect(source).not.toMatch(/onEdgesChange\b/);
    expect(source).not.toMatch(/isConnectable\b/);
    expect(source).not.toContain("@xyflow");
    expect(source).not.toContain("react-flow");
    expect(source).not.toContain("reactflow");
    expect(source).not.toContain("feTurbulence");
    expect(source).toContain("onNodePositionsChange");
    expect(source).toContain("onSelectNode");
    expect(source).toContain("renderOverlay");
    expect(source).toContain("renderNodeContent");
    expect(source).toContain('"ready"');
    expect(source).toContain('"blocked"');
  });

  it("implements DnD with pointer events and no @dnd-kit", () => {
    const source = dirSource("packages/ui/src/dnd");
    expect(source).not.toContain("@dnd-kit");
    expect(source).toContain("onPointerDown");
    expect(source).toContain("pointermove");
    expect(source).toContain("focus-visible:ring-2");
    expect(source).toContain("focus-visible:ring-ring/40");
    expect(source).toContain('data-slot="dnd-handle"');
  });

  it("gives drags live feedback: ghost, preview order, gap, auto-scroll", () => {
    const source = dirSource("packages/ui/src/dnd");
    expect(source).toContain('data-slot="dnd-ghost"');
    expect(source).toContain('data-slot="dnd-gap"');
    expect(source).toContain("createPortal");
    expect(source).toContain("pointer-events-none");
    expect(source).toContain("autoScrollStep");
    expect(source).toContain("onDropItem");
    // Cross-container moves are a single callback (no dual-write races).
    expect(source).toContain("publishSortableDrag");
  });
});

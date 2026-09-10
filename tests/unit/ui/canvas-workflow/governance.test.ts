import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  WORKFLOW_ARROW_HALF,
  WORKFLOW_ARROW_SIZE,
  WORKFLOW_FLOW_STROKE,
  WORKFLOW_STROKE,
  WORKFLOW_STROKE_SIDE,
} from "@pier/ui/canvas-workflow/metrics.ts";
import { PIER_CANVAS_EXPORT_NAMES } from "@shared/pier-canvas-export-names.ts";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SPEC =
  "docs/superpowers/specs/2026-09-10-canvas-workflow-screen-flow-gold-standard.md";
const WORKFLOW_DIR = join(ROOT, "packages/ui/src/canvas-workflow");
const FORBIDDEN_COMPILE_EXPORTS = [
  "compileWorkflowLayout",
  "compileWorkflowEdges",
  "routeWorkflowEdge",
  "layoutQualityDiagnostics",
] as const;
const PRODUCT_SCAN_ROOTS = [
  join(ROOT, "packages/ui/src"),
  join(ROOT, "src/renderer/lib/live-modules"),
  join(ROOT, "src/shared/pier-canvas-export-names.ts"),
  join(ROOT, "resources/system-skills/pier-canvas/templates"),
  join(ROOT, "resources/system-skills/pier-canvas/sdk"),
] as const;

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function walkSource(dir: string): string[] {
  const files: string[] = [];
  const visit = (current: string) => {
    for (const entry of readdirSync(current)) {
      const filePath = join(current, entry);
      if (statSync(filePath).isDirectory()) {
        visit(filePath);
        continue;
      }
      if (/\.(?:css|ts|tsx)$/.test(entry) && !entry.endsWith(".d.ts")) {
        files.push(filePath);
      }
    }
  };
  visit(dir);
  return files;
}

function productFiles(): string[] {
  const files: string[] = [];
  for (const root of PRODUCT_SCAN_ROOTS) {
    if (statSync(root).isDirectory()) {
      files.push(...walkSource(root));
      continue;
    }
    files.push(root);
  }
  return files;
}

describe("canvas workflow / screen-flow gold standard", () => {
  it("indexes the gold-standard spec from AGENTS.md", () => {
    const agents = read("AGENTS.md");
    const spec = read(SPEC);
    expect(agents).toContain("### Canvas 流程图与界面流程");
    expect(agents).toContain(
      "2026-09-10-canvas-workflow-screen-flow-gold-standard.md"
    );
    expect(agents).toContain(
      "tests/unit/ui/canvas-workflow/governance.test.ts"
    );
    expect(spec).toContain("一句话终态");
    expect(spec).toContain("compileWorkflowLayout");
    expect(spec).toContain("1.8");
    expect(spec).toContain("1.4");
    expect(spec).toContain(".pier-workflow-edge-flow");
    expect(spec).toContain("不得回潮");
  });

  it("keeps author IR free of pixels, vias, and edge colors", () => {
    const types = read("packages/ui/src/canvas-workflow/types.ts");
    const sdk = read("resources/system-skills/pier-canvas/sdk/core.d.ts");
    const edgeBlock = /export interface WorkflowEdge \{[\s\S]*?\n\}/.exec(
      types
    )?.[0];
    expect(edgeBlock).toContain("from: string");
    expect(edgeBlock).toContain("to: string");
    expect(edgeBlock).not.toContain("via");
    expect(edgeBlock).not.toContain("labelAt");
    expect(edgeBlock).not.toContain("fromSide");
    expect(edgeBlock).not.toContain("color");
    expect(sdk).toContain("Failed validation paints Empty");
    expect(sdk).not.toContain("compileWorkflowLayout");
    expect(sdk).not.toContain("compileWorkflowEdges");
  });

  it("does not export the compiler on pier/canvas", () => {
    for (const name of FORBIDDEN_COMPILE_EXPORTS) {
      expect(PIER_CANVAS_EXPORT_NAMES).not.toContain(name);
    }
    expect(PIER_CANVAS_EXPORT_NAMES).toContain("WorkflowDiagram");
    expect(PIER_CANVAS_EXPORT_NAMES).toContain("ScreenFlow");
    expect(PIER_CANVAS_EXPORT_NAMES).toContain("validateWorkflowSpec");
    expect(PIER_CANVAS_EXPORT_NAMES).toContain("validateScreenFlowSpec");
  });

  it("locks the shared pen and rejects the cancelled casing / dim paths", () => {
    expect(WORKFLOW_STROKE).toBe(1.8);
    expect(WORKFLOW_STROKE_SIDE).toBe(1.4);
    expect(WORKFLOW_ARROW_SIZE).toBe(10);
    expect(WORKFLOW_ARROW_HALF).toBe(3.5);
    expect(WORKFLOW_FLOW_STROKE).toBe(3.35);
    const engine = walkSource(WORKFLOW_DIR)
      .map((filePath) => readFileSync(filePath, "utf8"))
      .join("\n");
    const css = read("src/renderer/app/globals.css");
    const liveWorkflow = read(
      "src/renderer/lib/live-modules/pier-canvas-workflow.tsx"
    );
    const liveScreens = read(
      "src/renderer/lib/live-modules/pier-canvas-screen-flow.tsx"
    );
    expect(engine).not.toContain("SCREEN_FLOW_CASING");
    expect(engine).not.toContain("WORKFLOW_DIM_OPACITY");
    expect(engine).not.toContain("dim-rest");
    expect(engine).not.toContain("pier-screen-flow-edge-flow");
    expect(css).toContain(".pier-workflow-edge-flow");
    expect(css).not.toContain("pier-screen-flow-edge-flow");
    expect(liveWorkflow).toContain("validateWorkflowSpec");
    expect(liveWorkflow).toContain("Empty");
    expect(liveScreens).toContain("validateScreenFlowSpec");
    expect(liveScreens).toContain("Empty");
    expect(liveScreens).toContain('kind="screens"');
  });

  it("keeps official templates on validate and the design gold off hand-drawn SVG", () => {
    const workflow = read(
      "resources/system-skills/pier-canvas/templates/workflow.canvas.tsx"
    );
    const design = read(
      "resources/system-skills/pier-canvas/templates/design-mockup.canvas.tsx"
    );
    expect(workflow).toContain("validateWorkflowSpec");
    expect(workflow).toContain("WorkflowDiagram");
    expect(design).toContain("validateScreenFlowSpec");
    expect(design).toContain("ScreenFlow");
    expect(design).not.toContain("<svg");
  });

  it("does not revive FlowGraph in the product canvas surface", () => {
    const hits: string[] = [];
    for (const filePath of productFiles()) {
      const text = readFileSync(filePath, "utf8");
      if (
        text.includes("FlowGraph") ||
        text.includes("layoutFlowGraph") ||
        text.includes("dag-viewer")
      ) {
        hits.push(filePath.slice(ROOT.length + 1));
      }
    }
    expect(hits).toEqual([]);
  });
});

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
      if (name === "workflow.canvas.tsx") {
        expect(container.querySelector("[data-workflow='invalid']")).toBeNull();
        expect(
          container.querySelector("[data-slot='workflow-diagram']")
        ).toBeTruthy();
        expect(
          container.querySelectorAll("[data-slot='workflow-lane']").length
        ).toBe(4);
        expect(
          container.querySelector("[data-slot='workflow-phase']")
        ).toBeTruthy();
        expect(
          container.querySelector("[data-slot='workflow-notes']")
        ).toBeTruthy();
      }
      unmount();
    }

    expect(appletBacked).toBeGreaterThan(0);
    expect([...kinds].sort()).toEqual(["composition", "docs"]);
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
    expect(source).toContain("ScreenFlow");
    expect(source).toContain("validateScreenFlowSpec");
    expect(source).toContain('role: "error"');
    expect(source).toContain('role: "return"');
    expect(source).toContain("data-pier-comment-id");
    expect(source).not.toContain("<svg");
    const artboardIds = [
      ...source.matchAll(/id="([a-zA-Z][a-zA-Z0-9_-]*)"/g),
    ].map((match) => match[1]);
    expect(new Set(artboardIds).size).toBeGreaterThanOrEqual(4);
    const artboards = source.match(/<Artboard/g) ?? [];
    expect(artboards.length).toBeGreaterThanOrEqual(4);
    expect(source).toContain('preset="phone"');
    expect(source).not.toContain("className={`");
    expect(source).not.toContain("h-auto");
  });

  it("keeps the workflow recipe as a typed IR diagram without device frames", () => {
    const source = templateSource("workflow.canvas.tsx");
    expect(source).toContain("WorkflowDiagram");
    expect(source).toContain("validateWorkflowSpec");
    expect(source).toContain('role: "return"');
    expect(source).toContain('role: "error"');
    expect(source).toContain('role: "branch"');
    expect(source).toContain('id: "approval"');
    expect(source).toContain('id: "blocked"');
    expect(source).toContain('variant: "exception"');
    expect(source).toContain("Compiler contract");
    expect(source).toContain("phases");
    expect(source).toContain("groups");
    expect(source).toContain('kind: "gate"');
    expect(source).toContain('kind: "store"');
    expect(source).toContain('kind: "external"');
    expect(source).toContain("detail:");
    expect(source).not.toContain("<Artboard");
    expect(source).not.toContain("<Layer");
  });

  it("keeps the one-pager from teaching approval loops as Mermaid", () => {
    const source = templateSource("one-pager.canvas.tsx");
    expect(source).toContain('kind: "actor"');
    expect(source).toContain("recipe=workflow");
    expect(source).not.toContain("maxWidth={960}");
    expect(source).not.toContain('tone: "danger"');
  });

  it("lets the preview shell own flow measure on Frame templates", () => {
    for (const name of [
      "one-pager.canvas.tsx",
      "decision.canvas.tsx",
      "closed-loop.canvas.tsx",
    ]) {
      const source = templateSource(name);
      expect(source, name).not.toMatch(/maxWidth=\{9\d{2}\}/);
      expect(source, name).not.toContain("maxWidth={1040}");
    }
  });

  it("names workflow as a board recipe in the reading-flow guide", () => {
    const source = templateSource("docs.canvas.tsx");
    expect(source).toContain("recipe=workflow");
    expect(source).toContain("WorkflowDiagram");
    expect(source).toContain("templates/workflow.canvas.tsx");
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

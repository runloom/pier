import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePierCanvasMeta } from "@shared/contracts/pier-canvas.ts";
import { PIER_CANVAS_EXPORT_NAMES } from "@shared/pier-canvas-export-names.ts";
import { cleanup, render } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import { MaterialCard } from "../../../.pier/canvases/canvas-kit/shared.tsx";
import * as pierCanvasModule from "../../support/pier-canvas.ts";

/**
 * Renders every React canvas under `.pier/canvases` for real.
 *
 * Compiling a canvas only proves its imports resolve. Mounting it catches the
 * failures authors actually hit: a primitive used outside its required parent,
 * a hook misuse, a component rendered with props it does not accept.
 */
const CANVAS_MODULES = import.meta.glob<Record<string, unknown>>(
  "../../../.pier/canvases/**/*.canvas.tsx",
  { eager: true }
);

beforeAll(async () => {
  await initI18n();
});

afterEach(cleanup);

function displayPath(path: string): string {
  return path.replace("../../../.pier/canvases/", "canvases/");
}

describe("project canvases render", () => {
  it("exposes exactly the whitelisted pier/canvas exports", () => {
    expect(Object.keys(pierCanvasModule).sort()).toEqual(
      [...PIER_CANVAS_EXPORT_NAMES].sort()
    );
  });

  it("finds the in-repo React canvases (smoke + blank + activity)", () => {
    // Solid entries also end in .canvas.tsx and are excluded below.
    expect(Object.keys(CANVAS_MODULES).length).toBeGreaterThanOrEqual(3);
  });

  it("shows host activity through pier/host", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        ".pier/canvases/activity-overview/activity-overview.canvas.tsx"
      ),
      "utf8"
    );
    expect(source).toContain('useHostSnapshot("foreground-activity")');
    expect(source).toContain("ItemGroup");
    expect(source).toMatch(/from ["']pier\/host["']/);
    expect(source).toMatch(/from ["']pier\/canvas["']/);
    expect(source).not.toContain("window.pier");
    expect(source).not.toContain("useActivityOverview");
    expect(source).not.toContain("This canvas reads useHostSnapshot");
  });

  it("kanban gold is a fill board with DnD primitives", () => {
    const source = readFileSync(
      join(process.cwd(), ".pier/canvases/kanban/kanban.canvas.tsx"),
      "utf8"
    );
    expect(source).toContain("fill gap={16}");
    expect(source).toContain("Sortable");
    expect(source).toContain("Droppable");
    expect(source).toContain('watch("board.json"');
    expect(source).not.toContain("WorldStage");
  });

  it("kanban gold mounts with data-canvas-fill on the root stack", () => {
    const path = Object.keys(CANVAS_MODULES).find((entry) =>
      entry.endsWith("kanban/kanban.canvas.tsx")
    );
    expect(path).toBeDefined();
    const module = CANVAS_MODULES[path ?? ""];
    const Canvas = module?.default as ComponentType | undefined;
    if (typeof Canvas !== "function") {
      throw new Error("kanban canvas must default-export a component");
    }
    const { container } = render(<Canvas />);
    expect(container.querySelector("[data-canvas-fill]")).not.toBeNull();
  });

  it("dag-viewer gold closes invokeCommand through run.output", () => {
    const source = readFileSync(
      join(process.cwd(), ".pier/canvases/dag-viewer/dag-viewer.canvas.tsx"),
      "utf8"
    );
    const instance = readFileSync(
      join(process.cwd(), ".pier/canvases/dag-viewer/instance.json"),
      "utf8"
    );
    expect(source).toContain("http://127.0.0.1");
    expect(source).not.toContain("https://");
    expect(source).toContain("FlowGraph");
    expect(source).toContain('presentation="plain"');
    expect(source).toContain("layoutFlowGraph");
    expect(source).toContain("onSelectNode");
    expect(source).toContain("renderOverlay");
    expect(source).toContain('useHostSnapshot("pier://tasks:runs-changed")');
    expect(source).toContain('type: "run.output"');
    expect(source).toMatch(/from ["']pier\/host["']/);
    expect(instance).toContain("cat graph.json");
  });

  it("design-mockup gold declares stable Design Mode anchors", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        ".pier/canvases/design-mockup/design-mockup.canvas.tsx"
      ),
      "utf8"
    );
    expect(source).toContain("data-pier-comment-id");
    expect(source).toContain("desktop-settings");
    expect(source).toContain("phone-home");
  });

  for (const [path, module] of Object.entries(CANVAS_MODULES)) {
    if (path.endsWith(".canvas.solid.tsx")) {
      continue;
    }

    it(`mounts ${displayPath(path)}`, () => {
      const Canvas = module.default as ComponentType | undefined;
      if (typeof Canvas !== "function") {
        throw new Error(`${path} must default-export a component`);
      }
      const { container } = render(<Canvas />);
      expect(container.firstChild).not.toBeNull();
    });

    it(`declares valid metadata in ${displayPath(path)}`, () => {
      expect(parsePierCanvasMeta(module.canvas)).not.toBeNull();
    });
  }

  it("renders material cards with fixed well and flush chrome", () => {
    // 2026-08-24 修版：井固定 h-28 居中；卡去自身 py/gap，h-full 行内等高。
    const { container } = render(
      <MaterialCard
        install='import { Button } from "pier/canvas"'
        lead="触发主操作"
        name="Button"
      >
        <span>sample</span>
      </MaterialCard>
    );
    const card = container.querySelector("[data-slot='card']");
    expect(card?.className).toContain("h-full");
    expect(card?.className).toContain("py-0");
    expect(card?.className).toContain("gap-0");
    expect(card?.firstElementChild?.className).toContain("h-28");
  });
});

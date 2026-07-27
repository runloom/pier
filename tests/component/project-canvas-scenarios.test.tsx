import { parsePierCanvasMeta } from "@shared/contracts/pier-canvas.ts";
import { PIER_CANVAS_EXPORT_NAMES } from "@shared/pier-canvas-export-names.ts";
import { cleanup, render } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it } from "vitest";
import * as pierCanvasModule from "../support/pier-canvas.ts";

/**
 * Renders every React canvas under `.pier/canvases` for real.
 *
 * Compiling a canvas only proves its imports resolve. Mounting it catches the
 * failures authors actually hit: a primitive used outside its required parent,
 * a hook misuse, a component rendered with props it does not accept.
 */
const CANVAS_MODULES = import.meta.glob<Record<string, unknown>>(
  "../../.pier/canvases/**/*.canvas.tsx",
  { eager: true }
);

afterEach(cleanup);

function displayPath(path: string): string {
  return path.replace("../../.pier/canvases/", "canvases/");
}

describe("project canvases render", () => {
  it("exposes exactly the whitelisted pier/canvas exports", () => {
    expect(Object.keys(pierCanvasModule).sort()).toEqual(
      [...PIER_CANVAS_EXPORT_NAMES].sort()
    );
  });

  it("finds the in-repo React canvases (smoke + blank)", () => {
    // Solid entries also end in .canvas.tsx and are excluded below.
    expect(Object.keys(CANVAS_MODULES).length).toBeGreaterThanOrEqual(2);
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
});

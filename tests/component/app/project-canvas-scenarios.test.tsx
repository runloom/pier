import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePierCanvasMeta } from "@shared/contracts/pier-canvas.ts";
import { PIER_CANVAS_EXPORT_NAMES } from "@shared/pier-canvas-export-names.ts";
import { cleanup, render } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { initI18n } from "@/i18n/index.ts";
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

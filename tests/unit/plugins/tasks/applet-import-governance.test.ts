import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isLiveModuleCanvasFileName,
  LIVE_MODULE_CANVAS_FILE_SUFFIXES,
} from "@shared/live-module-framework.ts";
import { describe, expect, it } from "vitest";

const IMPORT_RE =
  /(?:^|\n)\s*(?:import|export)\s+[^"']*from\s+["']([^"']+)["']/g;

const PLUGIN_APPLET_ROOT = "packages/plugin-tasks/applets";
const TEMPLATE_APPLET_ROOT =
  "resources/system-skills/pier-canvas/templates/applets";
const APPLET_ROOTS = [PLUGIN_APPLET_ROOT];

/** Aligned with the repo hard cap (scripts/check-file-size.sh). */
const APPLET_FILE_LINE_CAP = 500;

function collectFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return collectFiles(path);
    }
    return entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")
      ? [path]
      : [];
  });
}

describe("canvas applet governance", () => {
  it("does not treat .applet.tsx as a live-module canvas entry", () => {
    expect(
      LIVE_MODULE_CANVAS_FILE_SUFFIXES.some((suffix) =>
        suffix.includes(".applet")
      )
    ).toBe(false);
    expect(isLiveModuleCanvasFileName("tracker-board/index.applet.tsx")).toBe(
      false
    );
  });

  it("only imports pier/canvas, pier/host, or relative files", () => {
    const files = APPLET_ROOTS.flatMap((root) =>
      collectFiles(join(process.cwd(), root))
    );
    expect(files.length).toBeGreaterThan(0);
    const violations: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(IMPORT_RE)) {
        const specifier = match[1];
        if (!specifier) {
          continue;
        }
        const allowed =
          specifier === "pier/canvas" ||
          specifier === "pier/host" ||
          specifier === "react" ||
          specifier.startsWith("react/") ||
          specifier.startsWith("./") ||
          specifier.startsWith("../");
        if (!allowed) {
          violations.push(`${file}: ${specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("keeps every applet file within the repo hard size cap", () => {
    const oversized = APPLET_ROOTS.flatMap((root) =>
      collectFiles(join(process.cwd(), root))
    ).filter(
      (file) =>
        readFileSync(file, "utf8").split("\n").length > APPLET_FILE_LINE_CAP
    );
    expect(oversized).toEqual([]);
  });

  it("does not ship plugin applet source in the canvas skill", () => {
    expect(existsSync(join(process.cwd(), TEMPLATE_APPLET_ROOT))).toBe(false);
  });
});

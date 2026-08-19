import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pierCanvasExports } from "@/lib/live-modules/pier-canvas-exports.ts";

const ROOT = process.cwd();

function listFiles(dir: string, suffix: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      found.push(...listFiles(full, suffix));
      continue;
    }
    if (entry.endsWith(suffix)) {
      found.push(full);
    }
  }
  return found;
}

describe("canvas host data contract", () => {
  it("keeps sibling-file reads on pier/canvas and host commands off it", () => {
    expect(pierCanvasExports.useCanvasFile).toBeTypeOf("function");
    expect(pierCanvasExports).not.toHaveProperty("useActivityOverview");
    expect(pierCanvasExports).not.toHaveProperty("host");
  });

  it("keeps canvas sources free of window.pier and workbench widgets", () => {
    const canvases = listFiles(join(ROOT, ".pier/canvases"), ".canvas.tsx");
    const templates = listFiles(
      join(ROOT, "resources/system-skills/pier-canvas/templates"),
      ".canvas.tsx"
    );
    for (const file of [...canvases, ...templates]) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toContain("window.pier");
      expect(source, file).not.toContain("panel-kits/workbench");
    }
  });
});

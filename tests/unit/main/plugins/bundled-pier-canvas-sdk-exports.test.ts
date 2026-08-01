// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PIER_CANVAS_EXPORT_NAMES } from "@shared/pier-canvas-export-names.ts";
import { describe, expect, it } from "vitest";

const SDK_DIR = join(
  process.cwd(),
  "resources",
  "system-skills",
  "pier-canvas",
  "sdk"
);

/** Runtime value exports agents may import from `pier/canvas` (not types). */
function collectSdkRuntimeExportNames(sdkDir: string): string[] {
  const names = new Set<string>();
  for (const entry of readdirSync(sdkDir)) {
    if (!entry.endsWith(".d.ts") || entry === "index.d.ts") {
      continue;
    }
    const text = readFileSync(join(sdkDir, entry), "utf8");
    for (const match of text.matchAll(/^export const (\w+)\b/gm)) {
      names.add(match[1] ?? "");
    }
  }
  names.delete("");
  return [...names].sort();
}

describe("bundled pier-canvas SDK export surface", () => {
  it("keeps sdk/ export const names equal to PIER_CANVAS_EXPORT_NAMES", () => {
    const fromSdk = collectSdkRuntimeExportNames(SDK_DIR);
    const fromHost = [...PIER_CANVAS_EXPORT_NAMES].sort();
    expect(fromSdk).toEqual(fromHost);
  });

  it("barrel index re-exports every focused declaration module", () => {
    const index = readFileSync(join(SDK_DIR, "index.d.ts"), "utf8");
    for (const module of [
      "core",
      "files",
      "forms",
      "primitives",
      "visualizations",
    ] as const) {
      expect(index).toContain(`export * from "./${module}.js"`);
    }
  });
});

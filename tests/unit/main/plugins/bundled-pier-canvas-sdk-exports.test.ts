// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CANVAS_HOST_ALLOWED_CHANNELS,
  CANVAS_HOST_ALLOWED_COMMANDS,
} from "@shared/contracts/canvas-host.ts";
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
    if (
      !entry.endsWith(".d.ts") ||
      entry === "index.d.ts" ||
      entry === "host.d.ts"
    ) {
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
      "data",
      "files",
      "forms",
      "primitives",
      "visualizations",
    ] as const) {
      expect(index).toContain(`export * from "./${module}.js"`);
    }
  });

  it("keeps pier/host outside the pier/canvas barrel", () => {
    const host = readFileSync(join(SDK_DIR, "host.d.ts"), "utf8");
    const index = readFileSync(join(SDK_DIR, "index.d.ts"), "utf8");
    expect(host).toContain("export declare const host");
    expect(host).toContain("useHostSnapshot");
    expect(host).toContain("optional: boolean");
    expect(host).toContain("exemplar: CanvasHostCommandType | null");
    expect(index).not.toContain('from "./host.js"');
  });

  it("types pier/host as the canvas allowlist", () => {
    const host = readFileSync(join(SDK_DIR, "host.d.ts"), "utf8");
    for (const type of CANVAS_HOST_ALLOWED_COMMANDS) {
      expect(host, type).toContain(`"${type}"`);
    }
    for (const channel of CANVAS_HOST_ALLOWED_CHANNELS) {
      expect(host, channel).toContain(`"${channel}"`);
    }
    expect(host).toContain('"foreground-activity"');
    expect(host).toContain('"resources"');
    expect(host).toContain('"usage-data"');
    expect(host).not.toContain('"file.writeText"');
    expect(host).not.toContain('"window.close"');
  });
});

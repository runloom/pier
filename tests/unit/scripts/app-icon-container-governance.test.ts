import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

describe("Pier app-icon container governance", () => {
  it("keeps exactly one authored optical source for each size tier", () => {
    for (const source of [
      "build/app-icon-16.svg",
      "build/app-icon-master.svg",
      "build/app-icon-small.svg",
      "build/app-icon-tiny.svg",
    ]) {
      expect(existsSync(join(ROOT, source))).toBe(true);
    }
    expect(existsSync(join(ROOT, "build/app-icon-micro.svg"))).toBe(false);
    expect(existsSync(join(ROOT, "build/app-icon-unplated.svg"))).toBe(false);
  });

  it("lets the bundle icon own the macOS Dock instead of replacing it at runtime", () => {
    const main = read("src/main/index.ts");
    expect(main).not.toMatch(/\bapp\.dock\.setIcon\s*\(/);
    expect(main).not.toContain("icon-dock.png");
    expect(main).not.toMatch(/\bnativeImage\b/);
    expect(existsSync(join(ROOT, "build/icon-dock.png"))).toBe(false);
  });

  it("keeps the complete 512px master composite for window icon consumers", () => {
    expect(read("src/main/windows/factory.ts")).toContain(
      '"../../build/icon.png"'
    );
    expect(read("scripts/build-app-icons.mjs")).toContain(
      'join(stagingDirectory, "icon.png")'
    );
    const builder = read("scripts/build-app-icons.mjs");
    expect(builder.match(/icon-dock\.png/g)).toHaveLength(1);
    expect(builder).toMatch(
      /rmSync\(join\(outputDirectory, "icon-dock\.png"\), \{ force: true \}\)/
    );
  });

  it("installs canonical generated assets into PierDev without rebuilding artwork", () => {
    const development = read("scripts/dev-profile.mjs");
    expect(development).toContain("macDevIconHash");
    expect(development).toContain('"icon.icns"');
    expect(development).toContain('"Assets.car.inputs"');
    expect(development).toContain("layeredIconFingerprint");
    expect(development).toContain("assertCompiledIconStack");
    expect(development).not.toContain("rsvg-convert");
    expect(development).not.toContain("iconutil");
    expect(development).not.toContain("platedFillSvg");
  });

  it("pins Xcode 26 and rebuilds icons before the macOS CI assertions", () => {
    const workflow = read(".github/workflows/ci.yml");
    expect(workflow).toContain(
      "/Applications/Xcode_26.3.app/Contents/Developer"
    );
    expect(workflow).toMatch(
      /mac-icons:[\s\S]*pnpm build:icons[\s\S]*git diff --exit-code -- build/
    );
    expect(workflow).toContain("build/design-sources/**");
  });
});

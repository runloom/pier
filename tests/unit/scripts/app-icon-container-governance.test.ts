import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

function workflowFilterBlock(
  workflow: string,
  name: string,
  nextName: string
): string {
  const block = new RegExp(
    `^ {12}${name}:\\n([\\s\\S]*?)^ {12}${nextName}:`,
    "m"
  ).exec(workflow)?.[1];
  expect(block, `${name} paths-filter block`).toBeDefined();
  return block ?? "";
}

describe("Pier app-icon container governance", () => {
  it("keeps exactly one authored SVG source and no persistent icon document", () => {
    expect(existsSync(join(ROOT, "build/app-icon-source.svg"))).toBe(true);
    expect(existsSync(join(ROOT, "build/app-icon-source.png"))).toBe(false);
    expect(existsSync(join(ROOT, "build/app-icon.icon"))).toBe(false);
    expect(existsSync(join(ROOT, "build/app-icon.svg"))).toBe(false);
    expect(existsSync(join(ROOT, "build/app-icon-16.svg"))).toBe(false);
    expect(existsSync(join(ROOT, "build/app-icon-master.svg"))).toBe(false);
    expect(existsSync(join(ROOT, "build/app-icon-small.svg"))).toBe(false);
    expect(existsSync(join(ROOT, "build/app-icon-tiny.svg"))).toBe(false);
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
    expect(builder).toContain('["app-icon.icon", "icon-dock.png"]');
    expect(builder).toContain("rmSync(join(outputDirectory, stale)");
  });

  it("installs canonical generated assets into PierDev without rebuilding artwork", () => {
    const development = read("scripts/dev-profile.mjs");
    expect(development).toContain("macDevIconHash");
    expect(development).toContain('"icon.icns"');
    expect(development).toContain('"Assets.car.inputs"');
    expect(development).not.toContain("rsvg-convert");
    expect(development).not.toContain("iconutil");
    expect(development).not.toContain("platedFillSvg");
  });

  it("pins the current stable Xcode and rebuilds icons before the macOS CI assertions", () => {
    const workflow = read(".github/workflows/ci.yml");
    expect(workflow).toContain(
      "/Applications/Xcode_26.6.app/Contents/Developer"
    );
    expect(workflow).toContain("runs-on: macos-26");
    expect(workflow).toMatch(
      /mac-icons:[\s\S]*pnpm build:icons[\s\S]*git diff --exit-code -- build/
    );
    expect(workflow).toContain("build/design-sources/**");
    expect(workflow).toContain("build/app-icon*.svg");
    expect(workflow).not.toContain("build/app-icon-source.png");
    expect(workflow).not.toContain("rsvg-convert");
  });

  it("runs host and mac icon gates for every release or icon pipeline change", () => {
    const workflow = read(".github/workflows/ci.yml");
    const app = workflowFilterBlock(workflow, "app", "native");
    const macIcons = workflowFilterBlock(workflow, "mac_icons", "windows_lsp");

    expect(app).toContain(".github/workflows/release-app.yml");
    for (const path of [
      "build/app-icon*.svg",
      "build/app-icon*.png",
      "build/app-icon.icon/**",
      "package.json",
      ".github/workflows/release-app.yml",
      "scripts/build-dist.sh",
      "scripts/mac-helper-icons.mjs",
      "scripts/verify-mac-release-artifacts.mjs",
      "tests/unit/main/preferences/mac-release-assets.test.ts",
      "tests/unit/main/app-core/release-workflow.test.ts",
    ]) {
      expect(macIcons, path).toContain(path);
    }
    expect(workflow).toMatch(
      /mac-icons:[\s\S]*tests\/unit\/main\/preferences\/mac-release-assets\.test\.ts/
    );
    expect(workflow).toMatch(
      /mac-icons:[\s\S]*tests\/unit\/main\/app-core\/release-workflow\.test\.ts/
    );
  });

  it("brands production Helpers after packaging", () => {
    expect(read("electron-builder.yml")).toContain(
      "afterPack: ./scripts/mac-helper-icons.mjs"
    );
  });
});

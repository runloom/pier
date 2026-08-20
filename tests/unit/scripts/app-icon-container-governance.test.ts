import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

describe("Pier icon container vs Dock plate split", () => {
  it("keeps the macOS plate only on Dock sources", () => {
    const plate = 'fill="#101725"';
    const plateGeometry = 'width="824" height="824"';

    expect(read("build/app-icon-master.svg")).toContain(plate);
    expect(read("build/app-icon-master.svg")).toContain(plateGeometry);
    expect(read("build/app-icon-micro.svg")).toContain(plate);
    expect(read("build/app-icon-micro.svg")).toContain(plateGeometry);

    expect(read("build/app-icon-unplated.svg")).not.toContain(plate);
    expect(read("build/design-sources/pier-logo.svg")).not.toContain(plate);
  });

  it("routes Dock to the plated PNG and window consumers to the unplated PNG", () => {
    expect(read("src/main/index.ts")).toContain('"../../build/icon-dock.png"');
    expect(read("src/main/index.ts")).not.toContain('"../../build/icon.png"');
    expect(read("src/main/windows/factory.ts")).toContain(
      '"../../build/icon.png"'
    );
    expect(read("src/main/windows/factory.ts")).not.toContain(
      '"../../build/icon-dock.png"'
    );
  });

  it("documents that window consumers must not reuse the Dock plate", () => {
    const development = read("docs/development.md");
    expect(development).toContain("build/icon-dock.png");
    expect(development).toContain("会再套一层圆角容器");
    expect(read(".gitignore")).toContain("!/build/icon-dock.png");
    expect(read("scripts/build-app-icons.mjs")).toContain('"icon-dock.png"');
  });

  it("builds the PierDev bundle icon from a plate that fills the canvas", () => {
    const development = read("scripts/dev-profile.mjs");
    expect(development).toContain("app-icon-master.svg");
    expect(development).toContain("app-icon-micro.svg");
    expect(development).toContain("platedFillSvg");
    expect(development).toContain("MAC_ICON_PLATE_FILL");
    expect(development).toContain("macDevElectronRuntimeStamp");
    expect(development).toContain("iconApplied");
    expect(development).not.toContain(
      'path.join(profile.worktreeRoot, "build", "icon.icns")'
    );
  });
});

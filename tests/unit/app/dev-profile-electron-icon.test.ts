import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyPierDevAppIcon,
  brandPierDevHelpers,
  macDevElectronRuntimeIsCurrent,
  macDevElectronRuntimeStamp,
  macDevIconHash,
} from "../../../scripts/dev-profile.mjs";

const ROOT = process.cwd();
const onDarwin = process.platform === "darwin";
const PIER_ICNS = readFileSync(join(ROOT, "build/icon.icns"));
const PIER_CAR = readFileSync(join(ROOT, "build/Assets.car"));
const STOCK_PLIST = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
  '<plist version="1.0">',
  "<dict>",
  "  <key>CFBundleIconFile</key>",
  "  <string>electron.icns</string>",
  "  <key>CFBundleVersion</key>",
  "  <string>43.4.0</string>",
  "</dict>",
  "</plist>",
].join("\n");

function copyCanonicalIconBuild(worktree: string): void {
  const build = join(worktree, "build");
  mkdirSync(build, { recursive: true });
  for (const file of [
    "app-icon-16.svg",
    "app-icon-master.svg",
    "app-icon-small.svg",
    "app-icon-tiny.svg",
    "icon.icns",
    "Assets.car",
    "Assets.car.inputs",
  ]) {
    copyFileSync(join(ROOT, "build", file), join(build, file));
  }
  cpSync(join(ROOT, "build/app-icon.icon"), join(build, "app-icon.icon"), {
    recursive: true,
  });
}

function createTargetApp(root: string): {
  resources: string;
  targetApp: string;
} {
  const targetApp = join(root, "PierDev.app");
  const resources = join(targetApp, "Contents", "Resources");
  mkdirSync(resources, { recursive: true });
  writeFileSync(join(resources, "electron.icns"), "stock-electron-icon");
  writeFileSync(join(targetApp, "Contents", "Info.plist"), STOCK_PLIST);
  return { resources, targetApp };
}

function plistValue(plist: string, key: string): string {
  return execFileSync("plutil", ["-extract", key, "raw", "-o", "-", plist], {
    encoding: "utf8",
  }).trim();
}

describe("PierDev.app bundle icon", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it.runIf(onDarwin)(
    "installs the exact release ICNS and validated native Assets.car",
    { timeout: 15_000 },
    () => {
      const root = mkdtempSync(join(tmpdir(), "pier-dev-icon-"));
      roots.push(root);
      const worktree = join(root, "worktree");
      copyCanonicalIconBuild(worktree);
      const { resources, targetApp } = createTargetApp(root);

      expect(
        applyPierDevAppIcon(worktree, targetApp, { bundleVersion: "43.4.0.8" })
      ).toBe("app-icon");
      expect(readFileSync(join(resources, "electron.icns"))).toEqual(PIER_ICNS);
      expect(readFileSync(join(resources, "AppIcon.icns"))).toEqual(PIER_ICNS);
      expect(readFileSync(join(resources, "Assets.car"))).toEqual(PIER_CAR);
      expect(existsSync(join(resources, "pier.icns"))).toBe(false);

      const plist = join(targetApp, "Contents", "Info.plist");
      expect(plistValue(plist, "CFBundleIconFile")).toBe("AppIcon");
      expect(plistValue(plist, "CFBundleIconName")).toBe("app-icon");
      expect(plistValue(plist, "CFBundleVersion")).toBe("43.4.0.8");
    }
  );

  it("rejects missing or stale generated inputs without mutating the bundle", () => {
    const root = mkdtempSync(join(tmpdir(), "pier-dev-icon-stale-"));
    roots.push(root);
    const worktree = join(root, "worktree");
    const { resources, targetApp } = createTargetApp(root);
    const stock = readFileSync(join(resources, "electron.icns"));

    expect(applyPierDevAppIcon(worktree, targetApp)).toBe(false);
    expect(readFileSync(join(resources, "electron.icns"))).toEqual(stock);

    copyCanonicalIconBuild(worktree);
    writeFileSync(
      join(worktree, "build", "Assets.car.inputs"),
      `${"0".repeat(64)}\n`
    );
    expect(applyPierDevAppIcon(worktree, targetApp)).toBe(false);
    expect(readFileSync(join(resources, "electron.icns"))).toEqual(stock);
    expect(existsSync(join(resources, "Assets.car"))).toBe(false);
  });

  it.runIf(onDarwin)(
    "rejects a corrupt layered catalog even when its sidecar is current",
    () => {
      const root = mkdtempSync(join(tmpdir(), "pier-dev-icon-corrupt-"));
      roots.push(root);
      const worktree = join(root, "worktree");
      copyCanonicalIconBuild(worktree);
      writeFileSync(join(worktree, "build", "Assets.car"), "corrupt-car");
      const { resources, targetApp } = createTargetApp(root);
      const stock = readFileSync(join(resources, "electron.icns"));

      expect(applyPierDevAppIcon(worktree, targetApp)).toBe(false);
      expect(readFileSync(join(resources, "electron.icns"))).toEqual(stock);
      expect(existsSync(join(resources, "Assets.car"))).toBe(false);
    }
  );

  it.runIf(onDarwin)(
    "renames Electron Helper apps and applies the same release assets",
    { timeout: 15_000 },
    () => {
      const root = mkdtempSync(join(tmpdir(), "pier-dev-helper-"));
      roots.push(root);
      const targetApp = join(root, "PierDev.app");
      const helperApp = join(
        targetApp,
        "Contents",
        "Frameworks",
        "Electron Helper.app"
      );
      mkdirSync(join(helperApp, "Contents", "MacOS"), { recursive: true });
      mkdirSync(join(targetApp, "Contents", "Resources"), { recursive: true });
      writeFileSync(
        join(helperApp, "Contents", "MacOS", "Electron Helper"),
        "fake-helper"
      );
      writeFileSync(
        join(helperApp, "Contents", "Info.plist"),
        [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
          '<plist version="1.0"><dict>',
          "  <key>CFBundleIdentifier</key><string>com.github.Electron.helper</string>",
          "  <key>CFBundleName</key><string>Electron Helper</string>",
          "</dict></plist>",
        ].join("\n")
      );
      writeFileSync(
        join(targetApp, "Contents", "Resources", "AppIcon.icns"),
        PIER_ICNS
      );
      writeFileSync(
        join(targetApp, "Contents", "Resources", "Assets.car"),
        PIER_CAR
      );

      expect(brandPierDevHelpers(targetApp, "app-icon")).toBe(true);
      const branded = join(
        targetApp,
        "Contents",
        "Frameworks",
        "PierDev Helper.app"
      );
      expect(
        existsSync(join(branded, "Contents", "MacOS", "PierDev Helper"))
      ).toBe(true);
      expect(
        readFileSync(join(branded, "Contents", "Resources", "AppIcon.icns"))
      ).toEqual(PIER_ICNS);
      expect(
        readFileSync(join(branded, "Contents", "Resources", "Assets.car"))
      ).toEqual(PIER_CAR);
      const plist = join(branded, "Contents", "Info.plist");
      expect(plistValue(plist, "CFBundleIconFile")).toBe("AppIcon");
      expect(plistValue(plist, "CFBundleIconName")).toBe("app-icon");
      expect(plistValue(plist, "CFBundleIdentifier")).toBe(
        "io.pier.dev-electron.helper"
      );
    }
  );

  it("does not mark failed or stale branding as current", () => {
    const expected = {
      iconHash: "abc",
      sourceApp: "/Electron.app",
      sourceVersion: "43.4.0",
    };
    const failed = macDevElectronRuntimeStamp({
      ...expected,
      iconApplied: false,
    });
    expect(failed).not.toHaveProperty("iconRevision");
    expect(failed).not.toHaveProperty("iconHash");
    expect(macDevElectronRuntimeIsCurrent(failed, expected)).toBe(false);

    const applied = macDevElectronRuntimeStamp({
      ...expected,
      iconApplied: true,
    });
    expect(macDevElectronRuntimeIsCurrent(applied, expected)).toBe(true);
    expect(
      macDevElectronRuntimeIsCurrent(applied, {
        ...expected,
        iconHash: "other",
      })
    ).toBe(false);
  });

  it("invalidates the PierDev cache for every canonical icon input", () => {
    const root = mkdtempSync(join(tmpdir(), "pier-dev-icon-hash-"));
    roots.push(root);
    const worktree = join(root, "worktree");
    copyCanonicalIconBuild(worktree);
    const baseline = macDevIconHash(worktree);
    const mutations = [
      "build/app-icon-16.svg",
      "build/app-icon-master.svg",
      "build/app-icon-small.svg",
      "build/app-icon-tiny.svg",
      "build/icon.icns",
      "build/Assets.car",
      "build/Assets.car.inputs",
      "build/app-icon.icon/Assets/prompt.svg",
    ];

    for (const relative of mutations) {
      const file = join(worktree, relative);
      const original = readFileSync(file);
      writeFileSync(file, Buffer.concat([original, Buffer.from("\nmutation")]));
      expect(macDevIconHash(worktree), relative).not.toBe(baseline);
      writeFileSync(file, original);
      expect(macDevIconHash(worktree), `${relative} restored`).toBe(baseline);
    }
  });

  it("rebuilds PierDev from canonical generated assets only", () => {
    const source = readFileSync(join(ROOT, "scripts/dev-profile.mjs"), "utf8");
    expect(source).toContain(
      "applyPierDevAppIcon(profile.worktreeRoot, targetApp"
    );
    expect(source).toContain("registerDevAppWithLaunchServices(targetApp)");
    expect(source).toContain("macDevElectronRuntimeIsCurrent");
    expect(source).toContain("macDevIconHash(profile.worktreeRoot)");
    expect(source).toContain('"icon.icns"');
    expect(source).toContain('"Assets.car.inputs"');
    expect(source).toContain("layeredIconFingerprint");
    expect(source).toContain("assertCompiledIconStack");
    expect(source).toContain("brandPierDevHelpers(");
    expect(source).not.toContain("rsvg-convert");
    expect(source).not.toContain("iconutil");
    expect(source).not.toContain("platedFillSvg");
    expect(source).not.toContain("app-icon-micro.svg");
  });
});

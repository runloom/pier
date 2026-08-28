import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { encodeIcns, parseIcns } from "../../../scripts/app-icon-icns.mjs";
import { macIconFingerprint } from "../../../scripts/app-icon-layered.mjs";
import {
  applyPierDevAppIcon,
  brandPierDevHelpers,
  MAC_DEV_ELECTRON_SIGN_REVISION,
  macDevBundleVersion,
  macDevElectronRuntimeIsCurrent,
  macDevElectronRuntimeStamp,
  macDevIconAssetsAreFresh,
  macDevIconHash,
  signMacDevElectronRuntime,
} from "../../../scripts/dev-profile.mjs";

const ROOT = process.cwd();
const onDarwin = process.platform === "darwin";
function hasCommand(name: string): boolean {
  try {
    execFileSync("which", [name], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
const PIER_ICNS = readFileSync(join(ROOT, "build/icon.icns"));
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
  for (const file of ["app-icon-source.svg", "icon.icns"]) {
    copyFileSync(join(ROOT, "build", file), join(build, file));
  }
  writeFileSync(
    join(build, "Assets.car.inputs"),
    currentIconFingerprint(build)
  );
}

function currentIconFingerprint(build: string): string {
  const sourcePng = parseIcns(readFileSync(join(build, "icon.icns"))).find(
    ({ type }) => type === "ic10"
  )?.data;
  if (!sourcePng) {
    throw new Error("test ICNS is missing ic10");
  }
  return macIconFingerprint(join(build, "app-icon-source.svg"), sourcePng);
}

function withPngTextChunk(png: Buffer): Buffer {
  const data = Buffer.from("Pier\0freshness-regression");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write("tEXt", 4, "ascii");
  data.copy(chunk, 8);
  chunk.writeUInt32BE(
    crc32(chunk.subarray(4, 8 + data.length)),
    8 + data.length
  );
  return Buffer.concat([png.subarray(0, -12), chunk, png.subarray(-12)]);
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

function plistHasKey(plist: string, key: string): boolean {
  return (
    spawnSync("plutil", ["-extract", key, "raw", "-o", "-", plist], {
      stdio: "ignore",
    }).status === 0
  );
}

describe("PierDev.app bundle icon", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it.runIf(onDarwin)(
    "uses the release ICNS directly and removes stale compiled icon material",
    { timeout: 15_000 },
    () => {
      const root = mkdtempSync(join(tmpdir(), "pier-dev-direct-icon-"));
      roots.push(root);
      const worktree = join(root, "worktree");
      copyCanonicalIconBuild(worktree);
      const { resources, targetApp } = createTargetApp(root);
      writeFileSync(join(resources, "Assets.car"), "stale-compiled-icon");
      execFileSync("plutil", [
        "-insert",
        "CFBundleIconName",
        "-string",
        "stale-icon",
        join(targetApp, "Contents", "Info.plist"),
      ]);

      expect(
        applyPierDevAppIcon(worktree, targetApp, {
          bundleVersion: "43.4.11",
        })
      ).toBe(true);
      expect(readFileSync(join(resources, "electron.icns"))).toEqual(PIER_ICNS);
      expect(readFileSync(join(resources, "AppIcon.icns"))).toEqual(PIER_ICNS);
      expect(existsSync(join(resources, "Assets.car"))).toBe(false);

      const plist = join(targetApp, "Contents", "Info.plist");
      expect(plistValue(plist, "CFBundleIconFile")).toBe("AppIcon");
      expect(plistHasKey(plist, "CFBundleIconName")).toBe(false);
      expect(plistValue(plist, "CFBundleVersion")).toBe("43.4.11");
    }
  );

  it("recognizes only an ICNS with the exact current SVG sidecar as fresh", () => {
    const root = mkdtempSync(join(tmpdir(), "pier-dev-icon-freshness-"));
    roots.push(root);
    const worktree = join(root, "worktree");
    copyCanonicalIconBuild(worktree);
    const build = join(worktree, "build");

    expect(macDevIconAssetsAreFresh(worktree)).toBe(true);
    writeFileSync(
      join(build, "Assets.car.inputs"),
      Buffer.concat([
        readFileSync(join(build, "Assets.car.inputs")),
        Buffer.from("\n"),
      ])
    );
    expect(macDevIconAssetsAreFresh(worktree)).toBe(false);
    writeFileSync(
      join(build, "Assets.car.inputs"),
      currentIconFingerprint(build)
    );
    const iconFile = join(build, "icon.icns");
    const icon = readFileSync(iconFile);
    writeFileSync(
      iconFile,
      encodeIcns(
        parseIcns(icon).map((entry) =>
          entry.type === "ic10"
            ? {
                ...entry,
                data: withPngTextChunk(entry.data),
              }
            : entry
        )
      )
    );
    expect(macDevIconAssetsAreFresh(worktree)).toBe(false);
    writeFileSync(iconFile, icon);
    writeFileSync(join(build, "app-icon-source.svg"), "<svg />");
    expect(macDevIconAssetsAreFresh(worktree)).toBe(false);
    rmSync(join(build, "icon.icns"));
    expect(macDevIconAssetsAreFresh(worktree)).toBe(false);
  });

  it("rejects stale generated inputs before mutating the bundle", () => {
    const root = mkdtempSync(join(tmpdir(), "pier-dev-icon-stale-"));
    roots.push(root);
    const worktree = join(root, "worktree");
    const { resources, targetApp } = createTargetApp(root);
    const stock = readFileSync(join(resources, "electron.icns"));
    copyCanonicalIconBuild(worktree);
    writeFileSync(join(resources, "Assets.car"), "stock-car");
    const plist = join(targetApp, "Contents", "Info.plist");
    const plistBefore = readFileSync(plist);
    writeFileSync(
      join(worktree, "build", "app-icon-source.svg"),
      "<svg>unbuilt edit</svg>"
    );

    expect(() => applyPierDevAppIcon(worktree, targetApp)).toThrow(
      /pnpm build:icons/
    );
    expect(readFileSync(join(resources, "electron.icns"))).toEqual(stock);
    expect(readFileSync(join(resources, "Assets.car"), "utf8")).toBe(
      "stock-car"
    );
    expect(readFileSync(plist)).toEqual(plistBefore);
    expect(existsSync(join(resources, "AppIcon.icns"))).toBe(false);
  });

  it.runIf(onDarwin)(
    "renames all Electron Helpers and installs only the shared release ICNS",
    { timeout: 30_000 },
    () => {
      const root = mkdtempSync(join(tmpdir(), "pier-dev-helper-"));
      roots.push(root);
      const targetApp = join(root, "PierDev.app");
      mkdirSync(join(targetApp, "Contents", "Resources"), { recursive: true });
      writeFileSync(
        join(targetApp, "Contents", "Resources", "AppIcon.icns"),
        PIER_ICNS
      );
      const variants = [
        { id: "helper", suffix: "" },
        { id: "helper.GPU", suffix: " (GPU)" },
        { id: "helper.Plugin", suffix: " (Plugin)" },
        { id: "helper.Renderer", suffix: " (Renderer)" },
      ];
      for (const { suffix } of variants) {
        const oldName = `Electron Helper${suffix}`;
        const helperApp = join(
          targetApp,
          "Contents",
          "Frameworks",
          `${oldName}.app`
        );
        mkdirSync(join(helperApp, "Contents", "MacOS"), { recursive: true });
        mkdirSync(join(helperApp, "Contents", "Resources"), {
          recursive: true,
        });
        writeFileSync(
          join(helperApp, "Contents", "MacOS", oldName),
          "fake-helper"
        );
        writeFileSync(
          join(helperApp, "Contents", "Resources", "Assets.car"),
          "stale-helper-car"
        );
        writeFileSync(
          join(helperApp, "Contents", "Info.plist"),
          [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
            '<plist version="1.0"><dict>',
            "  <key>CFBundleIconName</key><string>stale-icon</string>",
            "  <key>CFBundleIdentifier</key><string>com.github.Electron.helper</string>",
            `  <key>CFBundleName</key><string>${oldName}</string>`,
            "</dict></plist>",
          ].join("\n")
        );
      }

      expect(brandPierDevHelpers).toHaveLength(1);
      expect(brandPierDevHelpers(targetApp)).toBe(true);
      for (const { id, suffix } of variants) {
        const newName = `PierDev Helper${suffix}`;
        const branded = join(
          targetApp,
          "Contents",
          "Frameworks",
          `${newName}.app`
        );
        expect(existsSync(join(branded, "Contents", "MacOS", newName))).toBe(
          true
        );
        expect(
          readFileSync(join(branded, "Contents", "Resources", "AppIcon.icns"))
        ).toEqual(PIER_ICNS);
        expect(
          existsSync(join(branded, "Contents", "Resources", "Assets.car"))
        ).toBe(false);
        const plist = join(branded, "Contents", "Info.plist");
        expect(plistValue(plist, "CFBundleIconFile")).toBe("AppIcon");
        expect(plistHasKey(plist, "CFBundleIconName")).toBe(false);
        expect(plistValue(plist, "CFBundleIdentifier")).toBe(
          `io.pier.dev-electron.${id}`
        );
      }
    }
  );

  it.each([
    ["43.4.0", "43.4.12"],
    ["43.4.2", "43.4.12"],
    ["43.4", "43.4.12"],
    ["not-a-version", "0.0.12"],
  ])("derives a three-component bundle version from %s", (source, expected) => {
    const actual = macDevBundleVersion(source);
    expect(actual).toBe(expected);
    expect(actual).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("changes CFBundleVersion when the generated ICNS hash changes", () => {
    expect(macDevBundleVersion("43.4.0", "00abcdff")).toBe("43.4.43981");
    expect(macDevBundleVersion("43.4.0", "00abce00")).not.toBe(
      macDevBundleVersion("43.4.0", "00abcdff")
    );
  });

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
    expect(failed.signRevision).toBe(MAC_DEV_ELECTRON_SIGN_REVISION);
    expect(macDevElectronRuntimeIsCurrent(failed, expected)).toBe(false);

    const applied = macDevElectronRuntimeStamp({
      ...expected,
      iconApplied: true,
    });
    expect(applied.iconRevision).toBe(12);
    expect(macDevElectronRuntimeIsCurrent(applied, expected)).toBe(true);
    expect(applied.signRevision).toBe(MAC_DEV_ELECTRON_SIGN_REVISION);
    expect(
      macDevElectronRuntimeIsCurrent(
        { ...applied, signRevision: MAC_DEV_ELECTRON_SIGN_REVISION - 1 },
        expected
      )
    ).toBe(false);
    expect(
      macDevElectronRuntimeIsCurrent(applied, {
        ...expected,
        iconHash: "other",
      })
    ).toBe(false);
  });

  it("hashes only the generated ICNS and its validated sidecar", () => {
    const root = mkdtempSync(join(tmpdir(), "pier-dev-icon-hash-"));
    roots.push(root);
    const worktree = join(root, "worktree");
    copyCanonicalIconBuild(worktree);
    const baseline = macDevIconHash(worktree);
    const svg = join(worktree, "build/app-icon-source.svg");
    const source = readFileSync(svg);
    writeFileSync(svg, Buffer.concat([source, Buffer.from("\nmutation")]));
    expect(macDevIconHash(worktree)).toBe(baseline);
    writeFileSync(svg, source);

    for (const relative of ["build/icon.icns", "build/Assets.car.inputs"]) {
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
    expect(source).toContain("macDevIconAssetsAreFresh");
    expect(source).toContain("macDevBundleVersion(sourceVersion, iconHash)");
    expect(source).toContain("macDevIconHash(profile.worktreeRoot)");
    expect(source).toContain('"icon.icns"');
    expect(source).toContain('"Assets.car.inputs"');
    expect(source).toContain("macIconFingerprint");
    expect(source).toContain("brandPierDevHelpers(");
    expect(source).toContain("signMacDevElectronRuntime(targetApp)");
    expect(source).toContain("disable-library-validation");
    expect(source).toContain("MAC_DEV_ELECTRON_SIGN_REVISION");
    expect(source).toContain('"runtime"');
    expect(source).not.toContain('"--deep"');
    expect(source).toContain("launch-env.json");
    const prepare = source.slice(
      source.indexOf("function prepareMacDevElectronRuntime"),
      source.indexOf("async function electronDev")
    );
    expect(prepare.indexOf("macDevIconAssetsAreFresh")).toBeGreaterThan(-1);
    expect(prepare.indexOf("macDevIconAssetsAreFresh")).toBeLessThan(
      prepare.indexOf("macDevElectronRuntimeIsCurrent")
    );
    expect(source).not.toContain("rsvg-convert");
    expect(source).not.toContain("iconutil");
    expect(source).not.toContain("platedFillSvg");
    expect(source).not.toContain("app-icon-micro.svg");
  });
});

describe("PierDev helper signing", () => {
  const hasClang = hasCommand("clang");

  it.skipIf(!(onDarwin && hasClang))(
    "adhoc-signs GPU helpers with library validation disabled",
    () => {
      const root = mkdtempSync(join(tmpdir(), "pier-dev-sign-"));
      const targetApp = join(root, "PierDev.app");
      const gpuHelper = join(
        targetApp,
        "Contents",
        "Frameworks",
        "PierDev Helper (GPU).app"
      );
      const writeMachOBundle = (
        appDir: string,
        execName: string,
        id: string
      ) => {
        const mac = join(appDir, "Contents", "MacOS");
        mkdirSync(mac, { recursive: true });
        writeFileSync(
          join(appDir, "Contents", "Info.plist"),
          `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>${execName}</string>
  <key>CFBundleIdentifier</key><string>${id}</string>
</dict></plist>
`
        );
        const src = join(root, `${execName.replaceAll(" ", "-")}.c`);
        writeFileSync(src, "int main(void) { return 0; }\n");
        execFileSync("clang", ["-o", join(mac, execName), src], {
          stdio: "pipe",
        });
      };
      try {
        writeMachOBundle(targetApp, "PierDev", "io.pier.dev-electron");
        writeMachOBundle(
          gpuHelper,
          "PierDev Helper (GPU)",
          "io.pier.dev-electron.helper.GPU"
        );
        signMacDevElectronRuntime(targetApp);
        const dumped = join(root, "gpu.entitlements");
        const gpuExec = join(
          gpuHelper,
          "Contents",
          "MacOS",
          "PierDev Helper (GPU)"
        );
        execFileSync(
          "codesign",
          ["-d", "--entitlements", dumped, "--xml", gpuExec],
          { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
        );
        expect(readFileSync(dumped, "utf8")).toContain(
          "disable-library-validation"
        );
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    },
    15_000
  );
});

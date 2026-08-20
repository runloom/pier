import { execFileSync } from "node:child_process";
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
import { inflateSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyPierDevAppIcon,
  brandPierDevHelpers,
  macDevElectronRuntimeIsCurrent,
  macDevElectronRuntimeStamp,
} from "../../../scripts/dev-profile.mjs";

const onDarwin = process.platform === "darwin";

const ROOT = process.cwd();
const PIER_ICNS = readFileSync(join(ROOT, "build/icon.icns"));
const STOCK_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIconFile</key>
  <string>electron.icns</string>
  <key>CFBundleVersion</key>
  <string>43.4.0</string>
</dict>
</plist>
`;

function extractIcnsPng(icns: string, file: string): Buffer {
  const parent = mkdtempSync(join(tmpdir(), "pier-dev-iconset-"));
  const iconset = join(parent, "AppIcon.iconset");
  try {
    execFileSync("iconutil", ["-c", "iconset", icns, "-o", iconset], {
      stdio: "pipe",
    });
    return readFileSync(join(iconset, file));
  } finally {
    rmSync(parent, { force: true, recursive: true });
  }
}

function pngAlphaAt(png: Buffer, x: number, y: number): number {
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const colorType = png.readUInt8(25);
  if (
    png.readUInt8(24) !== 8 ||
    (colorType !== 2 && colorType !== 6) ||
    png.readUInt8(26) !== 0 ||
    png.readUInt8(27) !== 0 ||
    png.readUInt8(28) !== 0
  ) {
    throw new Error(`Expected 8-bit RGB/RGBA PNG, got ${width}x${height}`);
  }
  if (colorType === 2) {
    return 255;
  }
  const idatChunks: Buffer[] = [];
  let offset = 8;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    if (type === "IDAT") {
      idatChunks.push(png.subarray(offset + 8, offset + 8 + length));
    }
    offset += 12 + length;
  }
  const bytesPerPixel = 4;
  const rowLength = width * bytesPerPixel;
  const raw = inflateSync(Buffer.concat(idatChunks));
  const pixels = Buffer.alloc(rowLength * height);
  let rawOffset = 0;
  for (let row = 0; row < height; row += 1) {
    const filter = raw.readUInt8(rawOffset);
    rawOffset += 1;
    const rowOffset = row * rowLength;
    for (let column = 0; column < rowLength; column += 1) {
      const source = raw.readUInt8(rawOffset + column);
      const left =
        column >= bytesPerPixel
          ? pixels.readUInt8(rowOffset + column - bytesPerPixel)
          : 0;
      const above =
        row > 0 ? pixels.readUInt8(rowOffset - rowLength + column) : 0;
      const upperLeft =
        row > 0 && column >= bytesPerPixel
          ? pixels.readUInt8(rowOffset - rowLength + column - bytesPerPixel)
          : 0;
      let value = source;
      if (filter === 1) {
        value += left;
      } else if (filter === 2) {
        value += above;
      } else if (filter === 3) {
        value += Math.floor((left + above) / 2);
      } else if (filter === 4) {
        const estimate = left + above - upperLeft;
        const leftDistance = Math.abs(estimate - left);
        const aboveDistance = Math.abs(estimate - above);
        const upperLeftDistance = Math.abs(estimate - upperLeft);
        let predictor = upperLeft;
        if (
          leftDistance <= aboveDistance &&
          leftDistance <= upperLeftDistance
        ) {
          predictor = left;
        } else if (aboveDistance <= upperLeftDistance) {
          predictor = above;
        }
        value += predictor;
      } else if (filter !== 0) {
        throw new Error(`Unsupported PNG filter ${filter}`);
      }
      pixels.writeUInt8(value % 256, rowOffset + column);
    }
    rawOffset += rowLength;
  }
  return pixels.readUInt8((y * width + x) * 4 + 3);
}

describe("PierDev.app bundle icon", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it.runIf(onDarwin)(
    "installs a plate-filled icns as electron.icns plus Tahoe AppIcon assets",
    () => {
      const root = mkdtempSync(join(tmpdir(), "pier-dev-icon-"));
      roots.push(root);
      const worktree = join(root, "worktree");
      const targetApp = join(root, "PierDev.app");
      const resources = join(targetApp, "Contents", "Resources");
      mkdirSync(join(worktree, "build"), { recursive: true });
      mkdirSync(resources, { recursive: true });
      copyFileSync(
        join(ROOT, "build", "app-icon-master.svg"),
        join(worktree, "build", "app-icon-master.svg")
      );
      copyFileSync(
        join(ROOT, "build", "app-icon-micro.svg"),
        join(worktree, "build", "app-icon-micro.svg")
      );
      writeFileSync(
        join(resources, "electron.icns"),
        Buffer.from("electron-stock-icon")
      );
      writeFileSync(join(targetApp, "Contents", "Info.plist"), STOCK_PLIST);

      expect(
        applyPierDevAppIcon(worktree, targetApp, { bundleVersion: "43.4.0.1" })
      ).toBe(true);
      const installed = readFileSync(join(resources, "electron.icns"));
      expect(installed.equals(PIER_ICNS)).toBe(false);
      expect(readFileSync(join(resources, "AppIcon.icns"))).toEqual(installed);
      expect(existsSync(join(resources, "pier.icns"))).toBe(false);
      expect(existsSync(join(resources, "Assets.car"))).toBe(true);
      const png = extractIcnsPng(
        join(resources, "electron.icns"),
        "icon_512x512.png"
      );
      expect(pngAlphaAt(png, 0, 0)).toBeGreaterThan(200);
      expect(pngAlphaAt(png, 256, 80)).toBeGreaterThan(200);
      const plist = readFileSync(
        join(targetApp, "Contents", "Info.plist"),
        "utf8"
      );
      expect(plist).toContain("AppIcon");
      expect(plist).toContain("CFBundleIconName");
      expect(plist).toContain("43.4.0.1");
    }
  );

  it("leaves the bundle unchanged when plated sources are missing", () => {
    const root = mkdtempSync(join(tmpdir(), "pier-dev-icon-missing-"));
    roots.push(root);
    const worktree = join(root, "worktree");
    const targetApp = join(root, "PierDev.app");
    const iconPath = join(targetApp, "Contents", "Resources", "electron.icns");
    mkdirSync(join(worktree, "build"), { recursive: true });
    mkdirSync(join(targetApp, "Contents", "Resources"), { recursive: true });
    writeFileSync(iconPath, Buffer.from("electron-stock-icon"));

    expect(applyPierDevAppIcon(worktree, targetApp)).toBe(false);
    expect(readFileSync(iconPath)).toEqual(Buffer.from("electron-stock-icon"));
    expect(existsSync(join(worktree, "build", "icon.icns"))).toBe(false);
  });

  it.runIf(onDarwin)(
    "renames Electron Helper apps and stamps them with the Pier icon",
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
        `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>com.github.Electron.helper</string>
  <key>CFBundleName</key>
  <string>Electron Helper</string>
</dict>
</plist>
`
      );
      writeFileSync(
        join(targetApp, "Contents", "Resources", "AppIcon.icns"),
        PIER_ICNS
      );

      expect(brandPierDevHelpers(targetApp)).toBe(true);
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
        existsSync(
          join(targetApp, "Contents", "Frameworks", "Electron Helper.app")
        )
      ).toBe(false);
      const plist = readFileSync(
        join(branded, "Contents", "Info.plist"),
        "utf8"
      );
      expect(plist).toContain("io.pier.dev-electron.helper");
      expect(plist).toContain("PierDev Helper");
      expect(
        readFileSync(join(branded, "Contents", "Resources", "AppIcon.icns"))
      ).toEqual(PIER_ICNS);
    }
  );

  it.runIf(onDarwin)(
    "restamps already branded PierDev Helper apps with the current icon",
    () => {
      const root = mkdtempSync(join(tmpdir(), "pier-dev-helper-restamp-"));
      roots.push(root);
      const targetApp = join(root, "PierDev.app");
      const helperApp = join(
        targetApp,
        "Contents",
        "Frameworks",
        "PierDev Helper.app"
      );
      mkdirSync(join(helperApp, "Contents", "MacOS"), { recursive: true });
      mkdirSync(join(helperApp, "Contents", "Resources"), { recursive: true });
      mkdirSync(join(targetApp, "Contents", "Resources"), { recursive: true });
      writeFileSync(
        join(helperApp, "Contents", "MacOS", "PierDev Helper"),
        "fake-helper"
      );
      writeFileSync(
        join(helperApp, "Contents", "Info.plist"),
        `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>io.pier.dev-electron.helper</string>
  <key>CFBundleName</key>
  <string>PierDev Helper</string>
</dict>
</plist>
`
      );
      writeFileSync(
        join(helperApp, "Contents", "Resources", "AppIcon.icns"),
        Buffer.from("stale-helper-icon")
      );
      writeFileSync(
        join(targetApp, "Contents", "Resources", "AppIcon.icns"),
        PIER_ICNS
      );

      expect(brandPierDevHelpers(targetApp)).toBe(true);
      expect(
        readFileSync(join(helperApp, "Contents", "Resources", "AppIcon.icns"))
      ).toEqual(PIER_ICNS);
    }
  );

  it("does not mark a failed branding as current", () => {
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
    expect(macDevElectronRuntimeIsCurrent(null, expected)).toBe(false);

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

  it("rebuilds the copied runtime when branding is missing or stale", () => {
    const source = readFileSync(join(ROOT, "scripts/dev-profile.mjs"), "utf8");
    expect(source).toContain(
      "applyPierDevAppIcon(profile.worktreeRoot, targetApp"
    );
    expect(source).toContain("registerDevAppWithLaunchServices(targetApp)");
    expect(source).toContain("macDevElectronRuntimeIsCurrent");
    expect(source).toContain("macDevElectronRuntimeStamp");
    expect(source).toContain("iconApplied");
    expect(source).toContain('["-u", targetApp]');
    expect(source).toContain("bundleVersion:");
    expect(source).toMatch(
      /sourceVersion\}\.\$\{MAC_DEV_ELECTRON_ICON_REVISION\}/
    );
    expect(source).toContain("CFBundleIconName");
    expect(source).toContain("Assets.car");
    expect(source).toContain("brandPierDevHelpers(targetApp)");
    expect(source).toContain("app-icon-master.svg");
    expect(source).toContain("app-icon-micro.svg");
    expect(source).toContain("platedFillSvg");
    expect(source).toContain("if (iconApplied)");
  });
});

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { MAC_UNUSED_USAGE_DESCRIPTION_KEYS } from "../../../scripts/mac-privacy-descriptions.mjs";
import { SCREEN_CAPTURE_DISABLE_FEATURES } from "../../../src/main/display-capture-policy.ts";

const ROOT = process.cwd();
const SPEC =
  "docs/superpowers/specs/2026-09-09-macos-screen-recording-tcc-gold-standard.md";
const AGENTS = "AGENTS.md";
const POLICY = "src/main/display-capture-policy.ts";
const GPU = "src/main/gpu-workarounds.ts";
const MAIN = "src/main/index.ts";
const SOURCE_FILE_RE = /\.(cjs|js|jsx|mjs|mm|m|h|swift|ts|tsx|yml)$/;
const SKIPPED_DIRECTORIES = new Set([
  "build",
  "coverage",
  "dist",
  "dist-builder",
  "node_modules",
  "out",
  "Vendor",
]);
const SOURCE_ROOTS = [
  join(ROOT, "src/main"),
  join(ROOT, "src/renderer"),
  join(ROOT, "src/plugins"),
  join(ROOT, "packages"),
  join(ROOT, "native/Sources"),
  join(ROOT, "native/src"),
  join(ROOT, "scripts"),
] as const;
const FORBIDDEN_MARKERS = [
  ["desktopCapturer", /\bdesktopCapturer\b/],
  ["getDisplayMedia", /\bgetDisplayMedia\b/],
  ["chromeMediaSource", /\bchromeMediaSource\b/],
  [
    "getMediaAccessStatus(screen)",
    /getMediaAccessStatus\s*\(\s*['"]screen['"]\s*\)/,
  ],
  ["CGRequestScreenCaptureAccess", /\bCGRequestScreenCaptureAccess\b/],
  ["CGWindowListCreateImage", /\bCGWindowListCreateImage\b/],
  ["CGDisplayStream", /\bCGDisplayStream\b/],
  ["SCShareableContent", /\bSCShareableContent\b/],
  ["SCScreenshotManager", /\bSCScreenshotManager\b/],
  ["SCStream", /\bSCStream\b/],
  ["SCContentSharingPicker", /\bSCContentSharingPicker\b/],
  ["askForMediaAccess", /\baskForMediaAccess\b/],
  ["AXIsProcessTrusted", /\bAXIsProcessTrusted\b/],
  ["AXUIElementCreate", /\bAXUIElementCreate\b/],
  ["PHPhotoLibrary", /\bPHPhotoLibrary\b/],
  ...MAC_UNUSED_USAGE_DESCRIPTION_KEYS.map(
    (key) => [key, new RegExp(`\\b${key}\\b`)] as const
  ),
] as const;

/**
 * Product files that may keep a marker. Each entry must name the marker and
 * why the file is the gate rather than a caller. Empty is the goal.
 */
const API_ALLOWLIST: readonly {
  file: string;
  marker: string;
  reason: string;
}[] = MAC_UNUSED_USAGE_DESCRIPTION_KEYS.map((key) => ({
  file: "scripts/mac-privacy-descriptions.mjs",
  marker: key,
  reason: "owns the unused-key blacklist that afterPack and PierDev delete",
}));

const CONFIG_FILES = [
  "electron-builder.yml",
  "scripts/dev-profile.mjs",
  "build/zh-Hans.lproj/InfoPlist.strings",
  "build/zh_CN.lproj/InfoPlist.strings",
] as const;

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function projectRelative(filePath: string): string {
  return relative(ROOT, filePath).split(sep).join("/");
}

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const filePath = join(dir, entry);
    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry)) {
        files.push(...sourceFiles(filePath));
      }
      continue;
    }
    if (SOURCE_FILE_RE.test(entry)) {
      files.push(filePath);
    }
  }
  return files;
}

describe("macOS screen recording gold standard", () => {
  it("documents the contract in AGENTS.md and the spec", () => {
    const agents = read(AGENTS);
    const spec = read(SPEC);
    expect(existsSync(join(ROOT, SPEC))).toBe(true);
    expect(agents).toContain("### macOS 未使用隐私权限");
    expect(agents).toContain(SPEC);
    expect(agents).toContain(
      "tests/unit/main/macos-screen-recording-governance.test.ts"
    );
    expect(agents).toContain("tests/unit/main/display-capture-policy.test.ts");
    expect(agents).toContain(
      "tests/unit/scripts/mac-privacy-descriptions.test.ts"
    );
    expect(spec).toContain("一句话终态");
    expect(spec).toContain("明确不做");
    expect(spec).toContain("功能名核对");
    expect(spec).toContain("不再调用会问这些权限的 API");
    expect(spec).toContain("app.whenReady()");
    for (const key of MAC_UNUSED_USAGE_DESCRIPTION_KEYS) {
      expect(spec, key).toContain(`\`${key}\``);
    }
    for (const name of SCREEN_CAPTURE_DISABLE_FEATURES) {
      expect(spec, name).toContain(`\`${name}\``);
    }
    expect(spec).toContain("WarmScreenCaptureSonoma");
    expect(spec).toContain(
      "ThumbnailCapturerMac:capture_mode/sc_screenshot_manager"
    );
  });

  it("keeps the verified disable list as feature names only", () => {
    expect([...SCREEN_CAPTURE_DISABLE_FEATURES]).toEqual([
      "ScreenCaptureKitPickerScreen",
      "ScreenCaptureKitStreamPickerSonoma",
      "ScreenCaptureKitMacScreen",
      "ScreenCaptureKitDeviceMac",
      "ScreenCaptureKitFullDesktopFallback",
      "ThumbnailCapturerMac",
      "UseSCContentSharingPicker",
      "MacCatapLoopbackAudioForScreenShare",
      "MacCatapLoopbackAudioForCast",
      "ScreenAIOCREnabled",
    ]);
    for (const name of SCREEN_CAPTURE_DISABLE_FEATURES) {
      expect(name).not.toContain(":");
    }
  });

  it("disables capture features before ready and denies every session", () => {
    const gpu = read(GPU);
    const gpuFn = gpu.slice(gpu.indexOf("export function applyGpuWorkarounds"));
    const disableAt = gpuFn.indexOf("disableUnusedScreenCaptureFeatures()");
    const readyGuard = gpuFn.indexOf("Number.parseInt(release()");
    expect(disableAt).toBeGreaterThan(-1);
    expect(disableAt).toBeLessThan(readyGuard);
    const main = read(MAIN);
    expect(main.indexOf("applyGpuWorkarounds()")).toBeGreaterThan(-1);
    expect(main.indexOf("applyGpuWorkarounds()")).toBeLessThan(
      main.indexOf("app.whenReady()")
    );
    expect(main).toContain("installDisplayCapturePolicy()");
    expect(read("scripts/dev-profile.mjs")).toContain(
      "stripUnusedUsageDescriptions"
    );
    expect(read("scripts/mac-helper-icons.mjs")).toContain(
      "stripUnusedMacUsageDescriptionsFromApp"
    );
    const policy = read(POLICY);
    expect(policy).toContain("setDisplayMediaRequestHandler");
    expect(policy).toContain("session-created");
    expect(policy).not.toContain("getSources");
  });

  it("does not ship unused capture usage descriptions in product tables", () => {
    for (const rel of CONFIG_FILES) {
      const source = read(rel);
      for (const key of MAC_UNUSED_USAGE_DESCRIPTION_KEYS) {
        expect(source, `${rel} :: ${key}`).not.toContain(key);
      }
    }
  });

  it("bans capture APIs outside the documented allowlist", () => {
    const hits: string[] = [];
    for (const filePath of SOURCE_ROOTS.flatMap((root) => sourceFiles(root))) {
      const rel = projectRelative(filePath);
      const source = readFileSync(filePath, "utf8");
      for (const [marker, pattern] of FORBIDDEN_MARKERS) {
        if (!pattern.test(source)) {
          continue;
        }
        const allowed = API_ALLOWLIST.some(
          (entry) => entry.file === rel && entry.marker === marker
        );
        if (!allowed) {
          hits.push(`${rel} :: ${marker}`);
        }
      }
    }
    expect(hits).toEqual([]);
    for (const entry of API_ALLOWLIST) {
      expect(entry.reason.trim().length).toBeGreaterThan(8);
    }
  });
});

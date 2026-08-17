import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { encodeIcns } from "../../../scripts/app-icon-icns.mjs";
import { buildAppIcons } from "../../../scripts/build-app-icons.mjs";

const SOURCE_DIRECTORY = join(process.cwd(), "build");
const LINUX_ICON_NAMES = [
  "16x16.png",
  "24x24.png",
  "32x32.png",
  "48x48.png",
  "64x64.png",
  "128x128.png",
  "256x256.png",
  "512x512.png",
] as const;

function createOfflineIconConverter(calls: string[]) {
  return async (options: { outDir: string; outputFormat: string }) => {
    calls.push(options.outputFormat);
    mkdirSync(options.outDir, { recursive: true });
    if (options.outputFormat === "icns") {
      copyFileSync(
        join(SOURCE_DIRECTORY, "icon.icns"),
        join(options.outDir, "icon.icns")
      );
      return;
    }
    if (options.outputFormat === "ico") {
      copyFileSync(
        join(SOURCE_DIRECTORY, "icon.ico"),
        join(options.outDir, "icon.ico")
      );
      return;
    }
    if (options.outputFormat === "set") {
      for (const name of LINUX_ICON_NAMES) {
        copyFileSync(
          join(SOURCE_DIRECTORY, "icons", name),
          join(options.outDir, name)
        );
      }
      return;
    }
    throw new Error(`Unexpected icon format ${options.outputFormat}`);
  };
}

function encodeOfflineLegacyIcons() {
  const legacyRgb = (size: number) => {
    const channel: number[] = [];
    let remaining = size * size;
    while (remaining > 0) {
      const count = Math.min(130, remaining);
      channel.push(count + 125, 0);
      remaining -= count;
    }
    return Buffer.from([...channel, ...channel, ...channel]);
  };
  return Promise.resolve({
    legacy16: encodeIcns([
      { type: "is32", data: legacyRgb(16) },
      { type: "s8mk", data: Buffer.alloc(16 * 16) },
    ]),
    legacy32: encodeIcns([
      { type: "il32", data: legacyRgb(32) },
      { type: "l8mk", data: Buffer.alloc(32 * 32) },
    ]),
  });
}

function seedPublishedAssets(outputDirectory: string): Map<string, Buffer> {
  mkdirSync(join(outputDirectory, "icons"), { recursive: true });
  const assets = new Map([
    ["icon.icns", Buffer.from("previous-icns")],
    ["icon.ico", Buffer.from("previous-ico")],
    ["icon.png", Buffer.from("previous-dock")],
    ["icons/16x16.png", Buffer.from("previous-linux")],
  ]);
  for (const [path, data] of assets) {
    writeFileSync(join(outputDirectory, path), data);
  }
  return assets;
}

describe("Pier application icon builder", () => {
  it("keeps the complete published asset set unchanged when generation fails", {
    timeout: 15_000,
  }, async () => {
    const root = mkdtempSync(join(tmpdir(), "pier-icon-transaction-"));
    const outputDirectory = join(root, "output");
    mkdirSync(outputDirectory);
    const previousAssets = seedPublishedAssets(outputDirectory);
    const conversionCalls: string[] = [];
    const failingRasterizer = join(root, "failing-rsvg-convert");
    writeFileSync(
      failingRasterizer,
      '#!/bin/sh\nif [ "$1" = "--version" ]; then exit 0; fi\nexit 42\n'
    );
    chmodSync(failingRasterizer, 0o755);

    try {
      await expect(
        buildAppIcons({
          sourceDirectory: SOURCE_DIRECTORY,
          outputDirectory,
          rsvgCommand: failingRasterizer,
          convertIcons: createOfflineIconConverter(conversionCalls),
          encodeLegacyIcons: encodeOfflineLegacyIcons,
          log: () => undefined,
        })
      ).rejects.toThrow(/exit 42/);
      expect(conversionCalls).toEqual(["icns", "icns", "ico", "set"]);

      for (const [path, data] of previousAssets) {
        expect(readFileSync(join(outputDirectory, path))).toEqual(data);
      }
      expect(
        readdirSync(outputDirectory).filter((name) =>
          name.startsWith(".icon-build-")
        )
      ).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports the missing librsvg dependency before touching outputs", async () => {
    const root = mkdtempSync(join(tmpdir(), "pier-icon-dependency-"));
    const outputDirectory = join(root, "output");
    mkdirSync(outputDirectory);
    const previousAssets = seedPublishedAssets(outputDirectory);

    try {
      await expect(
        buildAppIcons({
          sourceDirectory: SOURCE_DIRECTORY,
          outputDirectory,
          rsvgCommand: join(root, "missing-rsvg-convert"),
          log: () => undefined,
        })
      ).rejects.toThrow(/rsvg-convert.*librsvg/i);

      for (const [path, data] of previousAssets) {
        expect(readFileSync(join(outputDirectory, path))).toEqual(data);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

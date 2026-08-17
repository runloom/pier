import {
  chmodSync,
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
import { buildAppIcons } from "../../../scripts/build-app-icons.mjs";

const SOURCE_DIRECTORY = join(process.cwd(), "build");

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
          log: () => undefined,
        })
      ).rejects.toThrow(/exit 42/);

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

import { execFileSync } from "node:child_process";
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
import {
  assertCompiledIconStack,
  MAC_ICON_MARK_SIZE,
  MAC_ICON_RENDITION_NAME,
} from "../../../scripts/app-icon-layered.mjs";
import { buildAppIcons } from "../../../scripts/build-app-icons.mjs";

function hasCommand(name: string): boolean {
  try {
    execFileSync("which", [name], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const hasRsvgConvert = hasCommand("rsvg-convert");

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
  mkdirSync(join(outputDirectory, "app-icon.icon"), { recursive: true });
  const assets = new Map([
    ["icon.icns", Buffer.from("previous-icns")],
    ["icon.ico", Buffer.from("previous-ico")],
    ["icon.png", Buffer.from("previous-container")],
    ["icon-dock.png", Buffer.from("previous-dock")],
    ["icons/16x16.png", Buffer.from("previous-linux")],
    ["app-icon.icon/icon.json", Buffer.from("previous-icon-document")],
    ["Assets.car", Buffer.from("previous-car")],
    ["Assets.car.inputs", Buffer.from("previous-inputs")],
  ]);
  for (const [path, data] of assets) {
    writeFileSync(join(outputDirectory, path), data);
  }
  return assets;
}

function writeStubRasterizer(root: string): string {
  const stub = join(root, "stub-rsvg-convert");
  writeFileSync(
    stub,
    '#!/bin/sh\nif [ "$1" = "--version" ]; then exit 0; fi\nexit 42\n'
  );
  chmodSync(stub, 0o755);
  return stub;
}

async function rejectLayeredCarCompile(): Promise<never> {
  throw new Error("car compile must not run after an earlier failure");
}

interface CompileOptions {
  documentDirectory: string;
  outputDirectory: string;
}

function createRecordingCompile(
  calls: CompileOptions[],
  result: { omitCar?: boolean; renditionName?: string } = {}
) {
  const renditionName = result.renditionName ?? MAC_ICON_RENDITION_NAME;
  return async (options: CompileOptions) => {
    calls.push(options);
    if (!result.omitCar) {
      writeFileSync(
        join(options.outputDirectory, "Assets.car"),
        Buffer.from("fake-layered-car")
      );
    }
    writeFileSync(
      join(options.outputDirectory, "partial.plist"),
      `<plist><dict><key>CFBundleIconName</key><string>${renditionName}</string></dict></plist>`
    );
    return Promise.resolve();
  };
}

interface AssetUtilInfo {
  ok: boolean;
  stderr: string;
  stdout: string;
}

function inspectWith(stdout: string, ok = true) {
  return (): AssetUtilInfo => ({ ok, stdout, stderr: "" });
}

const LAYERED_STACK_ENTRIES = JSON.stringify([
  { AssetType: "IconImageStack", Name: MAC_ICON_RENDITION_NAME },
  {
    AssetType: "Icon Image",
    Name: MAC_ICON_RENDITION_NAME,
    PixelWidth: MAC_ICON_MARK_SIZE,
  },
]);

describe("Pier application icon builder", () => {
  it("keeps the complete published asset set unchanged when generation fails", {
    timeout: 15_000,
  }, async () => {
    const root = mkdtempSync(join(tmpdir(), "pier-icon-transaction-"));
    const outputDirectory = join(root, "output");
    mkdirSync(outputDirectory);
    const previousAssets = seedPublishedAssets(outputDirectory);
    const conversionCalls: string[] = [];
    const failingRasterizer = writeStubRasterizer(root);

    try {
      await expect(
        buildAppIcons({
          sourceDirectory: SOURCE_DIRECTORY,
          outputDirectory,
          rsvgCommand: failingRasterizer,
          convertIcons: createOfflineIconConverter(conversionCalls),
          encodeLegacyIcons: encodeOfflineLegacyIcons,
          compileIconDocument: rejectLayeredCarCompile,
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

  it("reports the missing actool dependency before touching outputs", async () => {
    const root = mkdtempSync(join(tmpdir(), "pier-icon-actool-"));
    const outputDirectory = join(root, "output");
    mkdirSync(outputDirectory);
    const previousAssets = seedPublishedAssets(outputDirectory);
    const stubRasterizer = writeStubRasterizer(root);

    try {
      await expect(
        buildAppIcons({
          sourceDirectory: SOURCE_DIRECTORY,
          outputDirectory,
          rsvgCommand: stubRasterizer,
          xcrunCommand: join(root, "missing-xcrun"),
          convertIcons: createOfflineIconConverter([]),
          encodeLegacyIcons: encodeOfflineLegacyIcons,
          log: () => undefined,
        })
      ).rejects.toThrow(/actool.*Xcode/);

      for (const [path, data] of previousAssets) {
        expect(readFileSync(join(outputDirectory, path))).toEqual(data);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.runIf(hasRsvgConvert)(
    "publishes the staged layered icon document and reuses the car on identical inputs",
    { timeout: 60_000 },
    async () => {
      const root = mkdtempSync(join(tmpdir(), "pier-icon-success-"));
      const outputDirectory = join(root, "output");
      mkdirSync(outputDirectory);
      seedPublishedAssets(outputDirectory);
      const compileCalls: CompileOptions[] = [];
      const fakeCompile = createRecordingCompile(compileCalls);
      const buildOnce = () =>
        buildAppIcons({
          sourceDirectory: SOURCE_DIRECTORY,
          outputDirectory,
          convertIcons: createOfflineIconConverter([]),
          encodeLegacyIcons: encodeOfflineLegacyIcons,
          compileIconDocument: fakeCompile,
          log: () => undefined,
        });

      try {
        await buildOnce();

        expect(compileCalls).toHaveLength(1);
        expect(
          compileCalls[0]?.documentDirectory.endsWith("app-icon.icon")
        ).toBe(true);
        expect(
          readFileSync(join(outputDirectory, "Assets.car")).toString()
        ).toBe("fake-layered-car");
        expect(
          readFileSync(join(outputDirectory, "app-icon.icon", "icon.json"))
        ).toEqual(
          readFileSync(join(SOURCE_DIRECTORY, "app-icon.icon", "icon.json"))
        );
        const mark = readFileSync(
          join(outputDirectory, "app-icon.icon", "Assets", "pier-mark.png")
        );
        expect(mark.readUInt32BE(16)).toBe(1024);
        expect(mark.readUInt32BE(20)).toBe(1024);
        expect(
          readFileSync(join(outputDirectory, "Assets.car.inputs"), "utf8")
        ).toMatch(/^[0-9a-f]{64}\n$/);
        expect(
          readdirSync(outputDirectory).filter((name) =>
            name.startsWith(".icon-build-")
          )
        ).toEqual([]);

        // Identical inputs must not recompile the volatile car.
        await buildOnce();
        expect(compileCalls).toHaveLength(1);
        expect(
          readFileSync(join(outputDirectory, "Assets.car")).toString()
        ).toBe("fake-layered-car");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  );

  it("accepts a compiled car carrying the layered stack and full-size rendition", () => {
    expect(() =>
      assertCompiledIconStack("Assets.car", inspectWith(LAYERED_STACK_ENTRIES))
    ).not.toThrow();
  });

  it("rejects a car without the layered rendition or full-size frame", () => {
    const flatOnly = JSON.stringify([
      {
        AssetType: "Icon Image",
        Name: MAC_ICON_RENDITION_NAME,
        PixelWidth: MAC_ICON_MARK_SIZE,
      },
    ]);
    expect(() =>
      assertCompiledIconStack("Assets.car", inspectWith(flatOnly))
    ).toThrow(/missing .*layered rendition/);
    const undersizedFrame = JSON.stringify([
      { AssetType: "IconImageStack", Name: MAC_ICON_RENDITION_NAME },
      {
        AssetType: "Icon Image",
        Name: MAC_ICON_RENDITION_NAME,
        PixelWidth: 512,
      },
    ]);
    expect(() =>
      assertCompiledIconStack("Assets.car", inspectWith(undersizedFrame))
    ).toThrow(/missing .*layered rendition/);
  });

  it("rejects uninspectable or unparseable assetutil output", () => {
    expect(() =>
      assertCompiledIconStack("Assets.car", () => ({
        ok: false,
        stdout: "",
        stderr: "boom",
      }))
    ).toThrow(/could not inspect/);
    expect(() =>
      assertCompiledIconStack("Assets.car", inspectWith("not-json"))
    ).toThrow(/unparseable/);
  });

  it.runIf(hasRsvgConvert)(
    "rejects an actool run that produces no Assets.car",
    { timeout: 60_000 },
    async () => {
      const root = mkdtempSync(join(tmpdir(), "pier-icon-nocar-"));
      const outputDirectory = join(root, "output");
      mkdirSync(outputDirectory);
      seedPublishedAssets(outputDirectory);
      const compileCalls: CompileOptions[] = [];

      try {
        await expect(
          buildAppIcons({
            sourceDirectory: SOURCE_DIRECTORY,
            outputDirectory,
            convertIcons: createOfflineIconConverter([]),
            encodeLegacyIcons: encodeOfflineLegacyIcons,
            compileIconDocument: createRecordingCompile(compileCalls, {
              omitCar: true,
            }),
            log: () => undefined,
          })
        ).rejects.toThrow(/did not produce Assets\.car/);
        expect(compileCalls).toHaveLength(1);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  );

  it.runIf(hasRsvgConvert)(
    "rejects a partial Info.plist naming a different icon",
    { timeout: 60_000 },
    async () => {
      const root = mkdtempSync(join(tmpdir(), "pier-icon-plist-"));
      const outputDirectory = join(root, "output");
      mkdirSync(outputDirectory);
      seedPublishedAssets(outputDirectory);
      const compileCalls: CompileOptions[] = [];

      try {
        await expect(
          buildAppIcons({
            sourceDirectory: SOURCE_DIRECTORY,
            outputDirectory,
            convertIcons: createOfflineIconConverter([]),
            encodeLegacyIcons: encodeOfflineLegacyIcons,
            compileIconDocument: createRecordingCompile(compileCalls, {
              renditionName: "other-icon",
            }),
            log: () => undefined,
          })
        ).rejects.toThrow(`CFBundleIconName=${MAC_ICON_RENDITION_NAME}`);
        expect(compileCalls).toHaveLength(1);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  );

  it.runIf(hasRsvgConvert)(
    "recompiles when the sidecar is stale even though the car exists",
    { timeout: 60_000 },
    async () => {
      const root = mkdtempSync(join(tmpdir(), "pier-icon-stale-"));
      const outputDirectory = join(root, "output");
      mkdirSync(outputDirectory);
      seedPublishedAssets(outputDirectory);
      const compileCalls: CompileOptions[] = [];
      const buildOnce = () =>
        buildAppIcons({
          sourceDirectory: SOURCE_DIRECTORY,
          outputDirectory,
          convertIcons: createOfflineIconConverter([]),
          encodeLegacyIcons: encodeOfflineLegacyIcons,
          compileIconDocument: createRecordingCompile(compileCalls),
          log: () => undefined,
        });

      try {
        await buildOnce();
        writeFileSync(
          join(outputDirectory, "Assets.car.inputs"),
          `${"0".repeat(64)}\n`
        );

        await buildOnce();

        expect(compileCalls).toHaveLength(2);
        expect(
          readFileSync(join(outputDirectory, "Assets.car.inputs"), "utf8")
        ).toMatch(/^[0-9a-f]{64}\n$/);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  );

  it.runIf(hasRsvgConvert)(
    "recompiles when the published car is missing despite a matching sidecar",
    { timeout: 60_000 },
    async () => {
      const root = mkdtempSync(join(tmpdir(), "pier-icon-orphan-"));
      const outputDirectory = join(root, "output");
      mkdirSync(outputDirectory);
      seedPublishedAssets(outputDirectory);
      const compileCalls: CompileOptions[] = [];
      const buildOnce = () =>
        buildAppIcons({
          sourceDirectory: SOURCE_DIRECTORY,
          outputDirectory,
          convertIcons: createOfflineIconConverter([]),
          encodeLegacyIcons: encodeOfflineLegacyIcons,
          compileIconDocument: createRecordingCompile(compileCalls),
          log: () => undefined,
        });

      try {
        await buildOnce();
        rmSync(join(outputDirectory, "Assets.car"));

        await buildOnce();

        expect(compileCalls).toHaveLength(2);
        expect(
          readFileSync(join(outputDirectory, "Assets.car")).toString()
        ).toBe("fake-layered-car");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  );

  it.runIf(hasRsvgConvert)(
    "validates a reused car only when publication validation is enabled",
    { timeout: 60_000 },
    async () => {
      const root = mkdtempSync(join(tmpdir(), "pier-icon-validate-"));
      const outputDirectory = join(root, "output");
      mkdirSync(outputDirectory);
      seedPublishedAssets(outputDirectory);
      const compileCalls: CompileOptions[] = [];
      const buildOnce = (validatePublishedCar?: boolean) =>
        buildAppIcons({
          sourceDirectory: SOURCE_DIRECTORY,
          outputDirectory,
          convertIcons: createOfflineIconConverter([]),
          encodeLegacyIcons: encodeOfflineLegacyIcons,
          compileIconDocument: createRecordingCompile(compileCalls),
          validatePublishedCar,
          log: () => undefined,
        });

      try {
        await buildOnce();
        writeFileSync(
          join(outputDirectory, "Assets.car"),
          Buffer.from("corrupt-car")
        );

        // Injection seam off (tests/hermetic hosts): reuse skips inspection.
        await buildOnce();
        expect(compileCalls).toHaveLength(1);
        expect(
          readFileSync(join(outputDirectory, "Assets.car")).toString()
        ).toBe("corrupt-car");

        await expect(buildOnce(true)).rejects.toThrow(/assetutil/);
        expect(compileCalls).toHaveLength(1);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  );
});

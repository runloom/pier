import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import {
  encodeIcns,
  ICNS_DIMENSIONS,
} from "../../../scripts/app-icon-icns.mjs";
import { MAC_ICON_RENDITION_NAME } from "../../../scripts/app-icon-layered.mjs";
import {
  buildAppIcons,
  extractLargestIconPng,
} from "../../../scripts/build-app-icons.mjs";

const SOURCE_DIRECTORY = join(process.cwd(), "build");
const ICON_NAMES = [
  "16x16.png",
  "24x24.png",
  "32x32.png",
  "48x48.png",
  "64x64.png",
  "128x128.png",
  "256x256.png",
  "512x512.png",
] as const;

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function pngChunk(type: string, data = Buffer.alloc(0)): Buffer {
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, 4, "ascii");
  data.copy(chunk, 8);
  chunk.writeUInt32BE(
    crc32(chunk.subarray(4, 8 + data.length)),
    8 + data.length
  );
  return chunk;
}

function rgbaPng(size: number, marker: string): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("tEXt", Buffer.from(`fixture\0${marker}`)),
    pngChunk("IDAT", deflateSync(Buffer.alloc((size * 4 + 1) * size))),
    pngChunk("IEND"),
  ]);
}

const IC10_PNG = rgbaPng(1024, "literal-ic10-frame");
const GENERATED_ICNS = encodeIcns(
  Object.entries(ICNS_DIMENSIONS).map(([type, size]) => ({
    type,
    data: type === "ic10" ? IC10_PNG : rgbaPng(size, type),
  }))
);
const CHANGED_IC10_PNG = rgbaPng(1024, "changed-literal-ic10-frame");
const GENERATED_ICNS_WITH_CHANGED_IC10 = encodeIcns(
  Object.entries(ICNS_DIMENSIONS).map(([type, size]) => ({
    type,
    data: type === "ic10" ? CHANGED_IC10_PNG : rgbaPng(size, type),
  }))
);

function createOfflineConverter(
  calls: string[],
  failOn?: string,
  generatedIcns: () => Buffer = () => GENERATED_ICNS
) {
  return async (options: {
    inputFile: string;
    outDir: string;
    outputFormat: string;
  }) => {
    calls.push(`${basename(options.inputFile)}:${options.outputFormat}`);
    if (options.outputFormat === failOn) {
      throw new Error(`failed ${failOn} conversion`);
    }
    mkdirSync(options.outDir, { recursive: true });
    if (options.outputFormat === "set") {
      for (const name of ICON_NAMES) {
        copyFileSync(
          join(SOURCE_DIRECTORY, "icons", name),
          join(options.outDir, name)
        );
      }
      return;
    }
    if (options.outputFormat === "ico") {
      copyFileSync(
        join(SOURCE_DIRECTORY, "icon.ico"),
        join(options.outDir, "icon.ico")
      );
      return;
    }
    if (options.outputFormat === "icns") {
      writeFileSync(join(options.outDir, "icon.icns"), generatedIcns());
      return;
    }
    throw new Error(`unexpected format ${options.outputFormat}`);
  };
}

function encodeOfflineLegacyIcons(options: {
  source16: string;
  source32: string;
}) {
  expect(basename(options.source16)).toBe("16x16.png");
  expect(basename(options.source32)).toBe("32x32.png");
  const legacyRgb = (size: number) => {
    const channel: number[] = [];
    for (let remaining = size * size; remaining > 0; ) {
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

function seedPublishedAssets(outputDirectory: string) {
  mkdirSync(join(outputDirectory, "icons"), { recursive: true });
  const assets = new Map([
    ["icon.icns", Buffer.from("previous-icns")],
    ["icon.ico", Buffer.from("previous-ico")],
    ["icon.png", Buffer.from("previous-container")],
    ["icon-dock.png", Buffer.from("previous-dock")],
    ["icons/16x16.png", Buffer.from("previous-linux")],
    ["icons/96x96.png", Buffer.from("previous-extra-size")],
    ["Assets.car", Buffer.from("previous-car")],
    ["Assets.car.inputs", Buffer.from("previous-inputs")],
    ["app-icon-source.png", Buffer.from("previous-published-source")],
  ]);
  for (const [path, data] of assets) {
    writeFileSync(join(outputDirectory, path), data);
  }
  return assets;
}

function createCompile(
  calls: string[],
  options: {
    expectedPng?: () => Buffer;
    carContents?: () => string;
    iconName?: string;
    omitCar?: boolean;
    omitIconFile?: boolean;
  } = {}
) {
  return async ({
    documentDirectory,
    outputDirectory,
  }: {
    documentDirectory: string;
    outputDirectory: string;
  }) => {
    calls.push(documentDirectory);
    expect(
      readFileSync(join(documentDirectory, "Assets/app-icon-source.png"))
    ).toEqual(options.expectedPng?.() ?? IC10_PNG);
    if (!options.omitCar) {
      writeFileSync(
        join(outputDirectory, "Assets.car"),
        options.carContents?.() ?? "fake-car"
      );
    }
    const iconName = options.iconName ?? MAC_ICON_RENDITION_NAME;
    writeFileSync(
      join(outputDirectory, "partial.plist"),
      `<plist><dict>${options.omitIconFile ? "" : `<key>CFBundleIconFile</key><string>${iconName}</string>`}<key>CFBundleIconName</key><string>${iconName}</string></dict></plist>`
    );
  };
}

describe("Pier SVG-first application icon builder", () => {
  it("extracts only a validated 1024 RGBA ic10 frame", () => {
    expect(extractLargestIconPng(GENERATED_ICNS)).toEqual(IC10_PNG);
    expect(() =>
      extractLargestIconPng(
        encodeIcns([{ type: "ic09", data: rgbaPng(512, "no-ic10") }])
      )
    ).toThrow(/ic10/);
    expect(() =>
      extractLargestIconPng(
        encodeIcns([{ type: "ic10", data: rgbaPng(512, "wrong-size") }])
      )
    ).toThrow(/1024/);
  });

  it("keeps every published asset unchanged when generation fails", async () => {
    const root = mkdtempSync(join(tmpdir(), "pier-icon-transaction-"));
    const output = join(root, "output");
    mkdirSync(output);
    const previous = seedPublishedAssets(output);
    try {
      await expect(
        buildAppIcons({
          compileIconDocument: vi.fn(),
          convertIcons: createOfflineConverter([], "ico"),
          encodeLegacyIcons: encodeOfflineLegacyIcons,
          log: () => undefined,
          outputDirectory: output,
          sourceDirectory: SOURCE_DIRECTORY,
        })
      ).rejects.toThrow(/failed ico conversion/);
      for (const [path, data] of previous) {
        expect(readFileSync(join(output, path)), path).toEqual(data);
      }
      expect(
        readdirSync(output).filter((name) => name.startsWith(".icon-build-"))
      ).toEqual([]);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("reports missing sips and actool before touching outputs", async () => {
    const root = mkdtempSync(join(tmpdir(), "pier-icon-dependencies-"));
    const output = join(root, "output");
    mkdirSync(output);
    const previous = seedPublishedAssets(output);
    try {
      await expect(
        buildAppIcons({
          compileIconDocument: vi.fn(),
          convertIcons: createOfflineConverter([]),
          log: () => undefined,
          outputDirectory: output,
          sipsCommand: join(root, "missing-sips"),
          sourceDirectory: SOURCE_DIRECTORY,
        })
      ).rejects.toThrow(/sips.*legacy/i);

      await expect(
        buildAppIcons({
          convertIcons: createOfflineConverter([]),
          encodeLegacyIcons: encodeOfflineLegacyIcons,
          log: () => undefined,
          outputDirectory: output,
          sourceDirectory: SOURCE_DIRECTORY,
          xcrunCommand: join(root, "missing-xcrun"),
        })
      ).rejects.toThrow(/actool.*Xcode/i);

      for (const [path, data] of previous) {
        expect(readFileSync(join(output, path)), path).toEqual(data);
      }
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("publishes the complete set, deletes stale sources, and recompiles the native catalog every time", async () => {
    const root = mkdtempSync(join(tmpdir(), "pier-icon-success-"));
    const output = join(root, "output");
    mkdirSync(output);
    seedPublishedAssets(output);
    mkdirSync(join(output, "app-icon.icon"));
    const conversions: string[] = [];
    const compileCalls: string[] = [];
    const build = () =>
      buildAppIcons({
        compileIconDocument: createCompile(compileCalls),
        convertIcons: createOfflineConverter(conversions),
        encodeLegacyIcons: encodeOfflineLegacyIcons,
        log: () => undefined,
        outputDirectory: output,
        sourceDirectory: SOURCE_DIRECTORY,
      });

    try {
      await build();
      expect(conversions).toEqual([
        "app-icon-source.svg:set",
        "app-icon-source.svg:ico",
        "app-icon-source.svg:icns",
      ]);
      expect(compileCalls).toHaveLength(1);
      expect(readdirSync(join(output, "icons")).sort()).toEqual(
        [...ICON_NAMES].sort()
      );
      expect(existsSync(join(output, "icons/96x96.png"))).toBe(false);
      expect(existsSync(join(output, "app-icon.icon"))).toBe(false);
      expect(existsSync(join(output, "app-icon-source.png"))).toBe(false);
      expect(existsSync(join(output, "icon-dock.png"))).toBe(false);
      expect(readFileSync(join(output, "icon.png"))).toEqual(
        readFileSync(join(output, "icons/512x512.png"))
      );
      expect(readFileSync(join(output, "Assets.car")).toString()).toBe(
        "fake-car"
      );
      expect(readFileSync(join(output, "Assets.car.inputs"), "utf8")).toMatch(
        /^[0-9a-f]{64}\n$/
      );

      await build();
      expect(compileCalls).toHaveLength(2);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("recompiles the native catalog when authored SVG bytes change but the extracted PNG does not", async () => {
    const root = mkdtempSync(join(tmpdir(), "pier-icon-svg-fingerprint-"));
    const sourceDirectory = join(root, "source");
    const output = join(root, "output");
    mkdirSync(sourceDirectory);
    mkdirSync(output);
    copyFileSync(
      join(SOURCE_DIRECTORY, "app-icon-source.svg"),
      join(sourceDirectory, "app-icon-source.svg")
    );
    const compileCalls: string[] = [];
    const build = () =>
      buildAppIcons({
        compileIconDocument: createCompile(compileCalls),
        convertIcons: createOfflineConverter([]),
        encodeLegacyIcons: encodeOfflineLegacyIcons,
        log: () => undefined,
        outputDirectory: output,
        sourceDirectory,
      });

    try {
      await build();
      const baseline = readFileSync(join(output, "Assets.car.inputs"), "utf8");
      const source = join(sourceDirectory, "app-icon-source.svg");
      writeFileSync(
        source,
        `${readFileSync(source, "utf8")}\n<!-- changed -->\n`
      );

      await build();

      expect(compileCalls).toHaveLength(2);
      expect(readFileSync(join(output, "Assets.car.inputs"), "utf8")).not.toBe(
        baseline
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("keeps published catalog bytes when a fresh compile has the same semantic icon", async () => {
    const root = mkdtempSync(join(tmpdir(), "pier-icon-semantic-cache-"));
    const output = join(root, "output");
    mkdirSync(output);
    let compiledCar = "first-nondeterministic-car";
    const build = () =>
      buildAppIcons({
        compileIconDocument: createCompile([], {
          carContents: () => compiledCar,
        }),
        compiledIconSemanticSignature: () => "same-visible-icon",
        convertIcons: createOfflineConverter([]),
        encodeLegacyIcons: encodeOfflineLegacyIcons,
        log: () => undefined,
        outputDirectory: output,
        sourceDirectory: SOURCE_DIRECTORY,
      });

    try {
      await build();
      compiledCar = "second-nondeterministic-car";
      await build();
      expect(readFileSync(join(output, "Assets.car"), "utf8")).toBe(
        "first-nondeterministic-car"
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("replaces a structurally valid catalog when fresh semantic content differs", async () => {
    const root = mkdtempSync(join(tmpdir(), "pier-icon-semantic-drift-"));
    const output = join(root, "output");
    mkdirSync(output);
    let compiledCar = "visible-icon-a";
    const build = () =>
      buildAppIcons({
        compileIconDocument: createCompile([], {
          carContents: () => compiledCar,
        }),
        compiledIconSemanticSignature: (path: string) =>
          readFileSync(path, "utf8"),
        convertIcons: createOfflineConverter([]),
        encodeLegacyIcons: encodeOfflineLegacyIcons,
        log: () => undefined,
        outputDirectory: output,
        sourceDirectory: SOURCE_DIRECTORY,
      });

    try {
      await build();
      compiledCar = "visible-icon-b";
      await build();
      expect(readFileSync(join(output, "Assets.car"), "utf8")).toBe(
        "visible-icon-b"
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("recompiles the native catalog when the extracted ic10 PNG changes but authored SVG bytes do not", async () => {
    const root = mkdtempSync(join(tmpdir(), "pier-icon-png-fingerprint-"));
    const output = join(root, "output");
    mkdirSync(output);
    const compileCalls: string[] = [];
    let generatedIcns = GENERATED_ICNS;
    let expectedPng = IC10_PNG;
    const build = () =>
      buildAppIcons({
        compileIconDocument: createCompile(compileCalls, {
          expectedPng: () => expectedPng,
        }),
        convertIcons: createOfflineConverter(
          [],
          undefined,
          () => generatedIcns
        ),
        encodeLegacyIcons: encodeOfflineLegacyIcons,
        log: () => undefined,
        outputDirectory: output,
        sourceDirectory: SOURCE_DIRECTORY,
      });

    try {
      await build();
      const baseline = readFileSync(join(output, "Assets.car.inputs"), "utf8");
      generatedIcns = GENERATED_ICNS_WITH_CHANGED_IC10;
      expectedPng = CHANGED_IC10_PNG;

      await build();

      expect(compileCalls).toHaveLength(2);
      expect(readFileSync(join(output, "Assets.car.inputs"), "utf8")).not.toBe(
        baseline
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("rejects SVG sources without the exact viewBox or with external assets", async () => {
    const root = mkdtempSync(join(tmpdir(), "pier-icon-invalid-svg-"));
    try {
      const invalidSources: readonly (readonly [string, string])[] = [
        ["wrong-viewbox", '<svg viewBox="0 0 512 512"/>'],
        [
          "external-image",
          '<svg viewBox="0 0 1024 1024"><image href="art.png"/></svg>',
        ],
      ];
      for (const [name, source] of invalidSources) {
        const sourceDirectory = join(root, name);
        const outputDirectory = join(root, `${name}-output`);
        mkdirSync(sourceDirectory);
        mkdirSync(outputDirectory);
        writeFileSync(join(sourceDirectory, "app-icon-source.svg"), source);
        await expect(
          buildAppIcons({
            compileIconDocument: vi.fn(),
            convertIcons: createOfflineConverter([]),
            encodeLegacyIcons: encodeOfflineLegacyIcons,
            log: () => undefined,
            outputDirectory,
            sourceDirectory,
          })
        ).rejects.toThrow(/viewBox|self-contained/i);
      }
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("rejects missing native outputs and mismatched plist identity", async () => {
    const root = mkdtempSync(join(tmpdir(), "pier-icon-native-errors-"));
    try {
      for (const compile of [
        createCompile([], { omitCar: true }),
        createCompile([], { iconName: "other-icon" }),
        createCompile([], { omitIconFile: true }),
      ]) {
        const output = join(root, Math.random().toString(36));
        mkdirSync(output);
        await expect(
          buildAppIcons({
            compileIconDocument: compile,
            convertIcons: createOfflineConverter([]),
            encodeLegacyIcons: encodeOfflineLegacyIcons,
            log: () => undefined,
            outputDirectory: output,
            sourceDirectory: SOURCE_DIRECTORY,
          })
        ).rejects.toThrow(/Assets\.car|CFBundleIconFile/);
      }
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});

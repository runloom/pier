// build/app-icon-{16,master,small,tiny}.svg → platform application icons.
//
// Sources:
//   - app-icon-16.svg: pixel-grid correction for physical 16×16 slots only.
//   - app-icon-master.svg: approved complete rendition for 256px and larger.
//   - app-icon-small.svg: optically adjusted rendition for 64–128px.
//   - app-icon-tiny.svg: optically adjusted rendition for 24–48px.
//   - app-icon.icon: authored three-layer vector document for macOS 26+. It is
//     compiled with Xcode's actool into build/Assets.car so Tahoe owns the
//     system mask and container lighting without boxing a legacy icon.
//
// Conversion uses electron-builder's pinned official icons toolset, which produces
// valid ICNS/ICO/icon sets consistently across host macOS versions. The macOS
// system `sips` encoder supplies legacy non-Retina 16px/32px frames so `iconutil`
// and AppKit decode those slots correctly; rsvg-convert rasterizes their SVG input.

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mergeIcnsRenditions } from "./app-icon-icns.mjs";
import {
  buildMacLayeredIcon,
  compileIconDocumentWithActool,
  MAC_ICON_DOCUMENT,
} from "./app-icon-layered.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_BUILD_DIRECTORY = join(ROOT, "build");
const PUBLISHED_TARGETS = Object.freeze([
  "icon.icns",
  "icon.ico",
  "icon.png",
  "icons",
  "app-icon.icon",
  "Assets.car",
  "Assets.car.inputs",
]);

const requireFromElectronBuilder = createRequire(
  import.meta.resolve("electron-builder")
);
const { runIconsTool } = requireFromElectronBuilder(
  "app-builder-lib/out/toolsets/icons.js"
);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: options.quiet ? "ignore" : ["ignore", "inherit", "inherit"],
  });
  if (result.error) {
    throw new Error(`${command} could not start: ${result.error.message}`, {
      cause: result.error,
    });
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} → exit ${result.status}`);
  }
}

function assertSipsAvailable(command) {
  const result = spawnSync(command, ["--help"], { stdio: "ignore" });
  if (result.error || result.status !== 0) {
    throw new Error(
      "macOS sips is required to encode the official legacy 16px and 32px ICNS frames.",
      result.error ? { cause: result.error } : undefined
    );
  }
}

function assertRasterizerAvailable(command) {
  const result = spawnSync(command, ["--version"], { stdio: "ignore" });
  if (result.error || result.status !== 0) {
    throw new Error(
      "rsvg-convert is required to build Pier icons. Install librsvg first (macOS: brew install librsvg; Debian/Ubuntu: sudo apt install librsvg2-bin).",
      result.error ? { cause: result.error } : undefined
    );
  }
}

function assertActoolAvailable(command) {
  const result = spawnSync(command, ["--find", "actool"], { stdio: "ignore" });
  if (result.error || result.status !== 0) {
    throw new Error(
      "Xcode actool is required to compile the macOS 26 layered icon (build/app-icon.icon → build/Assets.car). Install Xcode 26 or newer and select it with xcode-select.",
      result.error ? { cause: result.error } : undefined
    );
  }
}

function rasterize(command, source, size, output) {
  run(command, ["-w", String(size), "-h", String(size), "-o", output, source]);
}

async function convertToBuffer(
  source,
  format,
  workingDirectory,
  temporaryName,
  convertIcons
) {
  const outputDirectory = join(workingDirectory, `.icon-tool-${temporaryName}`);
  rmSync(outputDirectory, { recursive: true, force: true });
  mkdirSync(outputDirectory, { recursive: true });
  try {
    await convertIcons({
      inputFile: source,
      outputFormat: format,
      outDir: outputDirectory,
    });
    return readFileSync(join(outputDirectory, `icon.${format}`));
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true });
  }
}

async function encodeLegacyIconsWithSips(options) {
  const workingDirectory = join(options.stagingDirectory, ".legacy-icon-tool");
  mkdirSync(workingDirectory, { recursive: true });
  const encoded = {};
  for (const [size, source] of [
    [16, options.source16],
    [32, options.source32],
  ]) {
    const png = join(workingDirectory, `micro-${size}.png`);
    const icns = join(workingDirectory, `micro-${size}.icns`);
    rasterize(options.rsvgCommand, source, size, png);
    run(options.sipsCommand, ["-s", "format", "icns", png, "--out", icns], {
      quiet: true,
    });
    encoded[`legacy${size}`] = readFileSync(icns);
  }
  return encoded;
}

async function buildIcns(sources, stagingDirectory, dependencies) {
  const master = await convertToBuffer(
    sources.master,
    "icns",
    stagingDirectory,
    "icns-master",
    dependencies.convertIcons
  );
  const small = await convertToBuffer(
    sources.small,
    "icns",
    stagingDirectory,
    "icns-small",
    dependencies.convertIcons
  );
  const tiny = await convertToBuffer(
    sources.tiny,
    "icns",
    stagingDirectory,
    "icns-tiny",
    dependencies.convertIcons
  );
  const { legacy16, legacy32 } = await dependencies.encodeLegacyIcons({
    source16: sources.sixteen,
    source32: sources.tiny,
    stagingDirectory,
    rsvgCommand: dependencies.rsvgCommand,
    sipsCommand: dependencies.sipsCommand,
  });
  writeFileSync(
    join(stagingDirectory, "icon.icns"),
    mergeIcnsRenditions(master, small, tiny, legacy16, legacy32)
  );
}

const CROSS_PLATFORM_RENDITIONS = Object.freeze([
  [16, "sixteen"],
  [24, "tiny"],
  [32, "tiny"],
  [48, "tiny"],
  [64, "small"],
  [96, "small"],
  [128, "small"],
  [256, "master"],
  [512, "master"],
]);

const ICO_SIZES = new Set([16, 24, 32, 48, 64, 128, 256]);

function encodeIco(frames) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  let payloadOffset = 6 + frames.length * 16;
  const directory = frames.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    const encodedSize = size === 256 ? 0 : size;
    entry.writeUInt8(encodedSize, 0);
    entry.writeUInt8(encodedSize, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(payloadOffset, 12);
    payloadOffset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...directory, ...frames.map(({ png }) => png)]);
}

function buildIco(sources, stagingDirectory, rasterizeCommand) {
  const workingDirectory = join(stagingDirectory, ".ico-frames");
  mkdirSync(workingDirectory, { recursive: true });
  const frames = [];
  for (const [size, rendition] of CROSS_PLATFORM_RENDITIONS) {
    if (!ICO_SIZES.has(size)) {
      continue;
    }
    const output = join(workingDirectory, `${size}.png`);
    rasterize(rasterizeCommand, sources[rendition], size, output);
    frames.push({ size, png: readFileSync(output) });
  }
  writeFileSync(join(stagingDirectory, "icon.ico"), encodeIco(frames));
}

function buildLinuxIcons(sources, stagingDirectory, rasterizeCommand) {
  const linuxIcons = join(stagingDirectory, "icons");
  mkdirSync(linuxIcons, { recursive: true });
  for (const [size, rendition] of CROSS_PLATFORM_RENDITIONS) {
    rasterize(
      rasterizeCommand,
      sources[rendition],
      size,
      join(linuxIcons, `${size}x${size}.png`)
    );
  }
}

function buildContainerPng(sources, stagingDirectory, rasterizeCommand) {
  rasterize(
    rasterizeCommand,
    sources.master,
    512,
    join(stagingDirectory, "icon.png")
  );
}

function publishStagedAssets(stagingDirectory, outputDirectory) {
  const backupDirectory = mkdtempSync(
    join(outputDirectory, ".icon-build-backup-")
  );
  const backedUp = [];
  const published = [];

  try {
    for (const target of PUBLISHED_TARGETS) {
      const staged = join(stagingDirectory, target);
      if (!existsSync(staged)) {
        throw new Error(`Staged icon asset is missing: ${target}`);
      }

      const destination = join(outputDirectory, target);
      if (existsSync(destination)) {
        renameSync(destination, join(backupDirectory, target));
        backedUp.push(target);
      }
      renameSync(staged, destination);
      published.push(target);
    }
    rmSync(join(outputDirectory, "icon-dock.png"), { force: true });
  } catch (error) {
    for (const target of published.reverse()) {
      rmSync(join(outputDirectory, target), { recursive: true, force: true });
    }
    for (const target of backedUp.reverse()) {
      renameSync(join(backupDirectory, target), join(outputDirectory, target));
    }
    throw error;
  } finally {
    rmSync(backupDirectory, { recursive: true, force: true });
  }
}

export async function buildAppIcons(options = {}) {
  const sourceDirectory = options.sourceDirectory ?? DEFAULT_BUILD_DIRECTORY;
  const outputDirectory = options.outputDirectory ?? DEFAULT_BUILD_DIRECTORY;
  const rsvgCommand = options.rsvgCommand ?? "rsvg-convert";
  const sipsCommand = options.sipsCommand ?? "sips";
  const xcrunCommand = options.xcrunCommand ?? "xcrun";
  const convertIcons = options.convertIcons ?? runIconsTool;
  const encodeLegacyIcons =
    options.encodeLegacyIcons ?? encodeLegacyIconsWithSips;
  const compileIconDocument =
    options.compileIconDocument ?? compileIconDocumentWithActool;
  const validatePublishedCar =
    options.validatePublishedCar ?? options.compileIconDocument === undefined;
  const log = options.log ?? console.log;
  const sources = {
    sixteen: join(sourceDirectory, "app-icon-16.svg"),
    master: join(sourceDirectory, "app-icon-master.svg"),
    small: join(sourceDirectory, "app-icon-small.svg"),
    tiny: join(sourceDirectory, "app-icon-tiny.svg"),
    iconDocument: join(sourceDirectory, MAC_ICON_DOCUMENT),
  };

  assertRasterizerAvailable(rsvgCommand);
  if (options.encodeLegacyIcons === undefined) {
    assertSipsAvailable(sipsCommand);
  }
  if (options.compileIconDocument === undefined) {
    assertActoolAvailable(xcrunCommand);
  }
  mkdirSync(outputDirectory, { recursive: true });
  const stagingDirectory = mkdtempSync(
    join(outputDirectory, ".icon-build-staging-")
  );

  try {
    log(
      "→ build/icon.icns (16px optical + Tiny 32px + Small 64–128px + Master 256–1024px)"
    );
    await buildIcns(sources, stagingDirectory, {
      convertIcons,
      encodeLegacyIcons,
      rsvgCommand,
      sipsCommand,
    });
    log("→ build/icon.ico (optically routed Windows size set)");
    buildIco(sources, stagingDirectory, rsvgCommand);
    log("→ build/icons/* (optically routed Linux hicolor size set)");
    buildLinuxIcons(sources, stagingDirectory, rsvgCommand);
    log("→ build/icon.png 512×512 (complete master composite)");
    buildContainerPng(sources, stagingDirectory, rsvgCommand);
    log(
      "→ build/app-icon.icon Assets + build/Assets.car (macOS 26 layered rendition)"
    );
    await buildMacLayeredIcon(sources, stagingDirectory, outputDirectory, {
      compileIconDocument,
      xcrunCommand,
      validatePublishedCar,
    });
    publishStagedAssets(stagingDirectory, outputDirectory);
    log("✓ icons regenerated");
  } finally {
    rmSync(stagingDirectory, { recursive: true, force: true });
  }
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  await buildAppIcons();
}

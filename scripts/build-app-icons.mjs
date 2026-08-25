// build/app-icon-{master,micro,unplated}.svg → platform application icons.
//
// Sources:
//   - app-icon-master.svg: F rendition for macOS 256px and larger.
//   - app-icon-micro.svg: I rendition for macOS 16–128px and development Dock.
//   - app-icon-unplated.svg: transparent 1024×1024 mark for Windows, Linux,
//     and any consumer that wraps the bitmap in its own rounded container.
//   - app-icon.icon: Icon Composer document for macOS 26+. Its mark layer
//     (Assets/pier-mark.png) is regenerated here from app-icon-master.svg and
//     the document is compiled with Xcode's actool into build/Assets.car so
//     Tahoe renders the layered rendition natively instead of boxing the
//     legacy ICNS onto a system plate.
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
  "icon-dock.png",
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
  for (const size of [16, 32]) {
    const png = join(workingDirectory, `micro-${size}.png`);
    const icns = join(workingDirectory, `micro-${size}.icns`);
    rasterize(options.rsvgCommand, options.source, size, png);
    run(options.sipsCommand, ["-s", "format", "icns", png, "--out", icns], {
      quiet: true,
    });
    encoded[`legacy${size}`] = readFileSync(icns);
  }
  return encoded;
}

async function buildIcns(sources, stagingDirectory, dependencies) {
  const standard = await convertToBuffer(
    sources.master,
    "icns",
    stagingDirectory,
    "icns-standard",
    dependencies.convertIcons
  );
  const micro = await convertToBuffer(
    sources.micro,
    "icns",
    stagingDirectory,
    "icns-micro",
    dependencies.convertIcons
  );
  const { legacy16, legacy32 } = await dependencies.encodeLegacyIcons({
    source: sources.micro,
    stagingDirectory,
    rsvgCommand: dependencies.rsvgCommand,
    sipsCommand: dependencies.sipsCommand,
  });
  writeFileSync(
    join(stagingDirectory, "icon.icns"),
    mergeIcnsRenditions(standard, micro, legacy16, legacy32)
  );
}

async function buildIco(sources, stagingDirectory, convertIcons) {
  const icon = await convertToBuffer(
    sources.unplated,
    "ico",
    stagingDirectory,
    "ico",
    convertIcons
  );
  writeFileSync(join(stagingDirectory, "icon.ico"), icon);
}

async function buildLinuxIcons(
  sources,
  stagingDirectory,
  rasterizeCommand,
  convertIcons
) {
  const linuxIcons = join(stagingDirectory, "icons");
  mkdirSync(linuxIcons, { recursive: true });
  await convertIcons({
    inputFile: sources.unplated,
    outputFormat: "set",
    outDir: linuxIcons,
  });
  rasterize(
    rasterizeCommand,
    sources.unplated,
    96,
    join(linuxIcons, "96x96.png")
  );
}

function buildContainerPng(sources, stagingDirectory, rasterizeCommand) {
  rasterize(
    rasterizeCommand,
    sources.unplated,
    512,
    join(stagingDirectory, "icon.png")
  );
}

function buildDevDockPng(sources, stagingDirectory, rasterizeCommand) {
  rasterize(
    rasterizeCommand,
    sources.micro,
    512,
    join(stagingDirectory, "icon-dock.png")
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
    master: join(sourceDirectory, "app-icon-master.svg"),
    micro: join(sourceDirectory, "app-icon-micro.svg"),
    unplated: join(sourceDirectory, "app-icon-unplated.svg"),
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
    log("→ build/icon.icns (I Micro 16–128px + F Standard 256–1024px)");
    await buildIcns(sources, stagingDirectory, {
      convertIcons,
      encodeLegacyIcons,
      rsvgCommand,
      sipsCommand,
    });
    log("→ build/icon.ico (transparent Windows official size set)");
    await buildIco(sources, stagingDirectory, convertIcons);
    log("→ build/icons/* (transparent Linux hicolor size set)");
    await buildLinuxIcons(sources, stagingDirectory, rsvgCommand, convertIcons);
    log(
      "→ build/icon.png 512×512 (unplated mark for window/taskbar containers)"
    );
    buildContainerPng(sources, stagingDirectory, rsvgCommand);
    log("→ build/icon-dock.png 512×512 (macOS development Dock)");
    buildDevDockPng(sources, stagingDirectory, rsvgCommand);
    log(
      "→ build/app-icon.icon Assets + build/Assets.car (macOS 26 layered rendition)"
    );
    await buildMacLayeredIcon(sources, stagingDirectory, outputDirectory, {
      compileIconDocument,
      rsvgCommand,
      xcrunCommand,
      rasterize,
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

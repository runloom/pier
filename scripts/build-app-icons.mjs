// build/app-icon-source.svg → every platform application icon.
//
// electron-builder's pinned icon tool rasterizes the approved 1024-unit SVG
// and performs every standard-size Lanczos resize. The validated ICNS ic10
// frame is staged temporarily for macOS 26 Icon Composer compilation.

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
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
import {
  ICNS_DIMENSIONS,
  mergeIcnsRenditions,
  parseIcns,
} from "./app-icon-icns.mjs";
import {
  buildMacLayeredIcon,
  compiledIconSemanticSignature,
  compileIconDocumentWithActool,
} from "./app-icon-layered.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_BUILD_DIRECTORY = join(ROOT, "build");
const CANONICAL_ICON_FILE = "app-icon-source.svg";
const PUBLISHED_TARGETS = Object.freeze([
  "icon.icns",
  "icon.ico",
  "icon.png",
  "icons",
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

function assertActoolAvailable(command) {
  const result = spawnSync(command, ["--find", "actool"], { stdio: "ignore" });
  if (result.error || result.status !== 0) {
    throw new Error(
      "Xcode actool is required to compile the macOS 26 PNG icon stack. Install Xcode 26 or newer and select it with xcode-select.",
      result.error ? { cause: result.error } : undefined
    );
  }
}

function assertCanonicalSvg(source) {
  if (!existsSync(source)) {
    throw new Error(`Canonical app icon is missing: ${source}`);
  }
  const data = readFileSync(source, "utf8");
  const svgTag = data.match(/<svg\b[^>]*>/i)?.[0];
  if (!(svgTag && /\bviewBox\s*=\s*["']0 0 1024 1024["']/.test(svgTag))) {
    throw new Error(
      `${source} must have the exact SVG viewBox "0 0 1024 1024".`
    );
  }
  const references = [
    ...data.matchAll(/\b(?:href|xlink:href)\s*=\s*["']([^"']+)["']/gi),
  ];
  const urls = [...data.matchAll(/url\(\s*["']?([^)'"\s]+)["']?\s*\)/gi)];
  if (
    /<(?:image|text|script|foreignObject)\b/i.test(data) ||
    /@(?:font-face|import)\b/i.test(data) ||
    references.some((match) => !match[1].startsWith("#")) ||
    urls.some((match) => !match[1].startsWith("#"))
  ) {
    throw new Error(`${source} must be a self-contained SVG.`);
  }
}

export function extractLargestIconPng(icns) {
  const entry = parseIcns(icns).find(({ type }) => type === "ic10");
  if (!entry) {
    throw new Error("Generated ICNS is missing the ic10 1024px frame");
  }
  if (
    entry.data.readUInt32BE(16) !== ICNS_DIMENSIONS.ic10 ||
    entry.data.readUInt32BE(20) !== ICNS_DIMENSIONS.ic10
  ) {
    throw new Error("Generated ICNS ic10 frame must be 1024×1024");
  }
  return entry.data;
}

async function convertToBuffer(source, format, workingDirectory, convertIcons) {
  const outputDirectory = join(workingDirectory, `.icon-tool-${format}`);
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
  for (const [size, png] of [
    [16, options.source16],
    [32, options.source32],
  ]) {
    const icns = join(workingDirectory, `${size}.icns`);
    run(options.sipsCommand, ["-s", "format", "icns", png, "--out", icns], {
      quiet: true,
    });
    encoded[`legacy${size}`] = readFileSync(icns);
  }
  return encoded;
}

async function buildIcns(
  source,
  iconDirectory,
  stagingDirectory,
  dependencies
) {
  const complete = await convertToBuffer(
    source,
    "icns",
    stagingDirectory,
    dependencies.convertIcons
  );
  const { legacy16, legacy32 } = await dependencies.encodeLegacyIcons({
    sipsCommand: dependencies.sipsCommand,
    source16: join(iconDirectory, "16x16.png"),
    source32: join(iconDirectory, "32x32.png"),
    stagingDirectory,
  });
  writeFileSync(
    join(stagingDirectory, "icon.icns"),
    mergeIcnsRenditions(complete, legacy16, legacy32)
  );
  return complete;
}

async function buildCrossPlatformRasters(
  source,
  stagingDirectory,
  dependencies
) {
  const iconDirectory = join(stagingDirectory, "icons");
  mkdirSync(iconDirectory, { recursive: true });
  await dependencies.convertIcons({
    inputFile: source,
    outputFormat: "set",
    outDir: iconDirectory,
  });
  writeFileSync(
    join(stagingDirectory, "icon.ico"),
    await convertToBuffer(
      source,
      "ico",
      stagingDirectory,
      dependencies.convertIcons
    )
  );
  copyFileSync(
    join(iconDirectory, "512x512.png"),
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
    rmSync(join(outputDirectory, "app-icon-source.png"), { force: true });
    for (const stale of ["app-icon.icon", "icon-dock.png"]) {
      rmSync(join(outputDirectory, stale), { force: true, recursive: true });
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
  const sipsCommand = options.sipsCommand ?? "sips";
  const xcrunCommand = options.xcrunCommand ?? "xcrun";
  const convertIcons = options.convertIcons ?? runIconsTool;
  const encodeLegacyIcons =
    options.encodeLegacyIcons ?? encodeLegacyIconsWithSips;
  const compileIconDocument =
    options.compileIconDocument ?? compileIconDocumentWithActool;
  const semanticSignature =
    options.compiledIconSemanticSignature ??
    (options.compileIconDocument === undefined
      ? compiledIconSemanticSignature
      : (path) => readFileSync(path).toString("base64"));
  const validatePublishedCar =
    options.validatePublishedCar ?? options.compileIconDocument === undefined;
  const log = options.log ?? console.log;
  const source = join(sourceDirectory, CANONICAL_ICON_FILE);

  assertCanonicalSvg(source);
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
    log("→ build/icon.ico + build/icons/* + build/icon.png");
    await buildCrossPlatformRasters(source, stagingDirectory, {
      convertIcons,
    });
    log("→ build/icon.icns (single approved SVG source)");
    const generatedIcns = await buildIcns(
      source,
      join(stagingDirectory, "icons"),
      stagingDirectory,
      {
        convertIcons,
        encodeLegacyIcons,
        sipsCommand,
      }
    );
    const temporaryPng = join(stagingDirectory, "app-icon-source.png");
    writeFileSync(temporaryPng, extractLargestIconPng(generatedIcns));
    log("→ build/Assets.car (generated one-PNG macOS 26 icon stack)");
    await buildMacLayeredIcon(
      temporaryPng,
      source,
      stagingDirectory,
      outputDirectory,
      {
        compileIconDocument,
        compiledIconSemanticSignature: semanticSignature,
        validatePublishedCar,
        xcrunCommand,
      }
    );
    publishStagedAssets(stagingDirectory, outputDirectory);
    log("✓ icons regenerated from build/app-icon-source.svg");
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

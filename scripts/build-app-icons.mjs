// build/app-icon-{master,micro,unplated}.svg → platform application icons.
//
// Sources:
//   - app-icon-master.svg: F rendition for macOS 256px and larger.
//   - app-icon-micro.svg: I rendition for macOS 16–128px and development Dock.
//   - app-icon-unplated.svg: transparent 1024×1024 mark for Windows and Linux.
//
// Conversion uses electron-builder's pinned official icons toolset, which produces
// valid ICNS/ICO/icon sets consistently across host macOS versions. rsvg-convert is
// used only for the macOS development Dock PNG and Linux's optional 96px slot.

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

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_BUILD_DIRECTORY = join(ROOT, "build");
const PUBLISHED_TARGETS = Object.freeze([
  "icon.icns",
  "icon.ico",
  "icon.png",
  "icons",
]);

const requireFromElectronBuilder = createRequire(
  import.meta.resolve("electron-builder")
);
const { runIconsTool } = requireFromElectronBuilder(
  "app-builder-lib/out/toolsets/icons.js"
);

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: ["ignore", "inherit", "inherit"],
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

function assertRasterizerAvailable(command) {
  const result = spawnSync(command, ["--version"], { stdio: "ignore" });
  if (result.error || result.status !== 0) {
    throw new Error(
      "rsvg-convert is required to build Pier icons. Install librsvg first (macOS: brew install librsvg; Debian/Ubuntu: sudo apt install librsvg2-bin).",
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
  temporaryName
) {
  const outputDirectory = join(workingDirectory, `.icon-tool-${temporaryName}`);
  rmSync(outputDirectory, { recursive: true, force: true });
  mkdirSync(outputDirectory, { recursive: true });
  try {
    await runIconsTool({
      inputFile: source,
      outputFormat: format,
      outDir: outputDirectory,
    });
    return readFileSync(join(outputDirectory, `icon.${format}`));
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true });
  }
}

async function buildIcns(sources, stagingDirectory) {
  const standard = await convertToBuffer(
    sources.master,
    "icns",
    stagingDirectory,
    "icns-standard"
  );
  const micro = await convertToBuffer(
    sources.micro,
    "icns",
    stagingDirectory,
    "icns-micro"
  );
  writeFileSync(
    join(stagingDirectory, "icon.icns"),
    mergeIcnsRenditions(standard, micro)
  );
}

async function buildIco(sources, stagingDirectory) {
  const icon = await convertToBuffer(
    sources.unplated,
    "ico",
    stagingDirectory,
    "ico"
  );
  writeFileSync(join(stagingDirectory, "icon.ico"), icon);
}

async function buildLinuxIcons(sources, stagingDirectory, rasterizeCommand) {
  const linuxIcons = join(stagingDirectory, "icons");
  mkdirSync(linuxIcons, { recursive: true });
  await runIconsTool({
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

function buildDevDockPng(sources, stagingDirectory, rasterizeCommand) {
  rasterize(
    rasterizeCommand,
    sources.micro,
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
  const log = options.log ?? console.log;
  const sources = {
    master: join(sourceDirectory, "app-icon-master.svg"),
    micro: join(sourceDirectory, "app-icon-micro.svg"),
    unplated: join(sourceDirectory, "app-icon-unplated.svg"),
  };

  assertRasterizerAvailable(rsvgCommand);
  mkdirSync(outputDirectory, { recursive: true });
  const stagingDirectory = mkdtempSync(
    join(outputDirectory, ".icon-build-staging-")
  );

  try {
    log("→ build/icon.icns (I Micro 16–128px + F Standard 256–1024px)");
    await buildIcns(sources, stagingDirectory);
    log("→ build/icon.ico (transparent Windows official size set)");
    await buildIco(sources, stagingDirectory);
    log("→ build/icons/* (transparent Linux hicolor size set)");
    await buildLinuxIcons(sources, stagingDirectory, rsvgCommand);
    log("→ build/icon.png 512×512 (macOS development Dock)");
    buildDevDockPng(sources, stagingDirectory, rsvgCommand);
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

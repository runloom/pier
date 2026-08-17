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
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mergeIcnsRenditions } from "./app-icon-icns.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = join(ROOT, "build");
const SRC_MASTER = join(BUILD, "app-icon-master.svg");
const SRC_MICRO = join(BUILD, "app-icon-micro.svg");
const SRC_UNPLATED = join(BUILD, "app-icon-unplated.svg");
const LINUX_ICONS = join(BUILD, "icons");

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
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} → exit ${result.status}`);
  }
}

function rasterize(source, size, output) {
  run("rsvg-convert", [
    "-w",
    String(size),
    "-h",
    String(size),
    "-o",
    output,
    source,
  ]);
}

async function convertToBuffer(source, format, temporaryName) {
  const outputDirectory = join(BUILD, `.icon-tool-${temporaryName}`);
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

async function buildIcns() {
  const standard = await convertToBuffer(SRC_MASTER, "icns", "icns-standard");
  const micro = await convertToBuffer(SRC_MICRO, "icns", "icns-micro");
  writeFileSync(join(BUILD, "icon.icns"), mergeIcnsRenditions(standard, micro));
}

async function buildIco() {
  const icon = await convertToBuffer(SRC_UNPLATED, "ico", "ico");
  writeFileSync(join(BUILD, "icon.ico"), icon);
}

async function buildLinuxIcons() {
  rmSync(LINUX_ICONS, { recursive: true, force: true });
  mkdirSync(LINUX_ICONS, { recursive: true });
  await runIconsTool({
    inputFile: SRC_UNPLATED,
    outputFormat: "set",
    outDir: LINUX_ICONS,
  });
  rasterize(SRC_UNPLATED, 96, join(LINUX_ICONS, "96x96.png"));
}

function buildDevDockPng() {
  rasterize(SRC_MICRO, 512, join(BUILD, "icon.png"));
}

console.log("→ build/icon.icns (I Micro 16–128px + F Standard 256–1024px)");
await buildIcns();
console.log("→ build/icon.ico (transparent Windows official size set)");
await buildIco();
console.log("→ build/icons/* (transparent Linux hicolor size set)");
await buildLinuxIcons();
console.log("→ build/icon.png 512×512 (macOS development Dock)");
buildDevDockPng();
console.log("✓ icons regenerated");

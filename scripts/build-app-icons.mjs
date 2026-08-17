// build/app-icon-{master,rounded,micro}.svg → build/icon.{icns,ico,png}
// Three sources:
//   - app-icon-master.svg  full display artwork for macOS .icns sizes >= 64 px
//   - app-icon-rounded.svg full display artwork for runtime .png / .ico sizes >= 48 px
//   - app-icon-micro.svg   optically compensated artwork for 16–32 px outputs
//
// The micro source is intentionally solid-color and heavier. Rasterizing the
// display master down to favicon-size makes the terminal prompt and berth merge.
// Dependencies: rsvg-convert (librsvg), iconutil (macOS), magick (ImageMagick).
// pnpm build:icons triggers this script.

import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = join(ROOT, "build");
const SRC_MASTER = join(BUILD, "app-icon-master.svg");
const SRC_ROUNDED = join(BUILD, "app-icon-rounded.svg");
const SRC_MICRO = join(BUILD, "app-icon-micro.svg");
const ICONSET = join(BUILD, "icon.iconset");

// macOS .icns iconset mapping: <basename>_<logicalSize>x<logicalSize>[@2x].png
const MAC_ICONS = [
  { name: "icon_16x16.png", size: 16 },
  { name: "icon_16x16@2x.png", size: 32 },
  { name: "icon_32x32.png", size: 32 },
  { name: "icon_32x32@2x.png", size: 64 },
  { name: "icon_128x128.png", size: 128 },
  { name: "icon_128x128@2x.png", size: 256 },
  { name: "icon_256x256.png", size: 256 },
  { name: "icon_256x256@2x.png", size: 512 },
  { name: "icon_512x512.png", size: 512 },
  { name: "icon_512x512@2x.png", size: 1024 },
];

// Windows .ico multi-resolution frames. ImageMagick does not support frames
// above 256 px in .ico, so each size is rasterized before merging.
const WIN_SIZES = [16, 32, 48, 64, 128, 256];
const MICRO_MAX_SIZE = 32;

function run(cmd, args) {
  const result = spawnSync(cmd, args, {
    stdio: ["ignore", "inherit", "inherit"],
  });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} → exit ${result.status}`);
  }
}

function rasterize(src, size, out) {
  run("rsvg-convert", ["-w", String(size), "-h", String(size), "-o", out, src]);
}

function sourceForSize(displaySource, size) {
  return size <= MICRO_MAX_SIZE ? SRC_MICRO : displaySource;
}

function buildIcns() {
  rmSync(ICONSET, { recursive: true, force: true });
  mkdirSync(ICONSET, { recursive: true });
  for (const { name, size } of MAC_ICONS) {
    rasterize(sourceForSize(SRC_MASTER, size), size, join(ICONSET, name));
  }
  run("iconutil", ["-c", "icns", ICONSET, "-o", join(BUILD, "icon.icns")]);
  rmSync(ICONSET, { recursive: true, force: true });
}

function buildIco() {
  const tmpDir = join(BUILD, ".ico-tmp");
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });
  const frames = WIN_SIZES.map((size) => {
    const frame = join(tmpDir, `${size}.png`);
    rasterize(sourceForSize(SRC_ROUNDED, size), size, frame);
    return frame;
  });
  run("magick", [...frames, join(BUILD, "icon.ico")]);
  rmSync(tmpDir, { recursive: true, force: true });
}

function buildLinuxPng() {
  // Electron Builder expects a 512×512 PNG on Linux. Pier also uses this file
  // for the development Dock icon on macOS, so it keeps the rounded artwork.
  rasterize(SRC_ROUNDED, 512, join(BUILD, "icon.png"));
}

console.log("→ build/icon.icns (display + micro optical sizes)");
buildIcns();
console.log("→ build/icon.ico (rounded display + micro optical sizes)");
buildIco();
console.log("→ build/icon.png 512×512 (rounded display source)");
buildLinuxPng();
console.log("✓ icons regenerated");

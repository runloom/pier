// Pier reference-locked icon sources → build/icon.{icns,ico,png}
// app-icon-master.svg and app-icon-rounded.svg are intentionally byte-identical.
// app-icon-micro.svg is the only optical-size variant and is used at 16–32 px.

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = join(ROOT, "build");
const SRC_MASTER = join(BUILD, "app-icon-master.svg");
const SRC_ROUNDED = join(BUILD, "app-icon-rounded.svg");
const SRC_MICRO = join(BUILD, "app-icon-micro.svg");
const ICONSET = join(BUILD, "icon.iconset");
const MAC_ICONS = [{ name: "icon_16x16.png", size: 16 },{ name: "icon_16x16@2x.png", size: 32 },{ name: "icon_32x32.png", size: 32 },{ name: "icon_32x32@2x.png", size: 64 },{ name: "icon_128x128.png", size: 128 },{ name: "icon_128x128@2x.png", size: 256 },{ name: "icon_256x256.png", size: 256 },{ name: "icon_256x256@2x.png", size: 512 },{ name: "icon_512x512.png", size: 512 },{ name: "icon_512x512@2x.png", size: 1024 }];
const WIN_SIZES = [16, 32, 48, 64, 128, 256];
const MICRO_MAX_SIZE = 32;
function run(cmd, args) { const result = spawnSync(cmd, args, { stdio: ["ignore", "inherit", "inherit"] }); if (result.status !== 0) throw new Error(`${cmd} ${args.join(" ")} → exit ${result.status}`); }
function verifyReferenceLock() {
  const master = readFileSync(SRC_MASTER, "utf8");
  const rounded = readFileSync(SRC_ROUNDED, "utf8");
  if (master !== rounded) throw new Error("app-icon-master.svg and app-icon-rounded.svg drifted");
  for (const token of ['viewBox="0 0 412 412"', "M95 177H135V251", 'x="121" y="102" width="170" height="152"', "M170 153L199 181L170 209", "M211 202H242"]) if (!master.includes(token)) throw new Error(`approved 03 Minimal geometry is missing: ${token}`);
}
function rasterize(src, size, out) { run("rsvg-convert", ["-w", String(size), "-h", String(size), "-o", out, src]); }
function sourceForSize(size) { return size <= MICRO_MAX_SIZE ? SRC_MICRO : SRC_MASTER; }
function buildIcns() { rmSync(ICONSET, { recursive: true, force: true }); mkdirSync(ICONSET, { recursive: true }); for (const { name, size } of MAC_ICONS) rasterize(sourceForSize(size), size, join(ICONSET, name)); run("iconutil", ["-c", "icns", ICONSET, "-o", join(BUILD, "icon.icns")]); rmSync(ICONSET, { recursive: true, force: true }); }
function buildIco() { const tmpDir = join(BUILD, ".ico-tmp"); rmSync(tmpDir, { recursive: true, force: true }); mkdirSync(tmpDir, { recursive: true }); const frames = WIN_SIZES.map((size) => { const frame = join(tmpDir, `${size}.png`); rasterize(sourceForSize(size), size, frame); return frame; }); run("magick", [...frames, join(BUILD, "icon.ico")]); rmSync(tmpDir, { recursive: true, force: true }); }
function buildLinuxPng() { rasterize(SRC_MASTER, 512, join(BUILD, "icon.png")); }
verifyReferenceLock(); buildIcns(); buildIco(); buildLinuxPng(); console.log("✓ icons regenerated from the reference-locked 03 Minimal source");

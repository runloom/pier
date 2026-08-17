// build/app-icon-{master,rounded}.svg → build/icon.{icns,ico,png}
// 两个源:
//   - app-icon-master.svg  方角全幅, 给 .icns (macOS 打包 iconutil + OS 共套圆角遮罩)
//   - app-icon-rounded.svg 824×824 rx=185 预烘圆角, 给 .png / .ico (dev dock + Win/Linux 运行时不套遮罩)
// 依赖: rsvg-convert (librsvg), iconutil (macOS 自带), magick (ImageMagick).
// pnpm build:icons 触发.

import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = join(ROOT, "build");
const SRC_MASTER = join(BUILD, "app-icon-master.svg");
const SRC_ROUNDED = join(BUILD, "app-icon-rounded.svg");
const ICONSET = join(BUILD, "icon.iconset");

// macOS .icns 规定的 iconset 文件名映射: <basename>_<logicalSize>x<logicalSize>[@2x].png
// iconutil 严格按文件名解析, 缺一档就报 invalid Iconset.
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

// Windows .ico 多分辨率帧: 16/32/48/64/128/256.
// magick 的 -define icon:auto-resize 在新版本不允许超过 256, 所以全部预生成再合并.
const WIN_SIZES = [16, 32, 48, 64, 128, 256];

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: ["ignore", "inherit", "inherit"] });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} → exit ${r.status}`);
  }
}

function rasterize(src, size, out) {
  run("rsvg-convert", ["-w", String(size), "-h", String(size), "-o", out, src]);
}

function buildIcns() {
  rmSync(ICONSET, { recursive: true, force: true });
  mkdirSync(ICONSET, { recursive: true });
  for (const { name, size } of MAC_ICONS) {
    rasterize(SRC_MASTER, size, join(ICONSET, name));
  }
  run("iconutil", ["-c", "icns", ICONSET, "-o", join(BUILD, "icon.icns")]);
  rmSync(ICONSET, { recursive: true, force: true });
}

function buildIco() {
  const tmpDir = join(BUILD, ".ico-tmp");
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });
  const frames = WIN_SIZES.map((size) => {
    const p = join(tmpDir, `${size}.png`);
    rasterize(SRC_ROUNDED, size, p);
    return p;
  });
  run("magick", [...frames, join(BUILD, "icon.ico")]);
  rmSync(tmpDir, { recursive: true, force: true });
}

function buildLinuxPng() {
  // electron-builder linux 期望 512×512 PNG. 也被 dev 期 app.dock.setIcon 取用 (mac),
  // 所以用 rounded 源, 否则 dock 显示直角方块.
  rasterize(SRC_ROUNDED, 512, join(BUILD, "icon.png"));
}

console.log("→ build/icon.icns (master · 方角, OS 套 mask)");
buildIcns();
console.log("→ build/icon.ico (rounded · 预烘圆角)");
buildIco();
console.log("→ build/icon.png 512×512 (rounded · 预烘圆角)");
buildLinuxPng();
console.log("✓ icons regenerated");

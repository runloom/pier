#!/usr/bin/env node
// 让 git worktree 可运行 (照搬 loomdesk/scripts/setup-worktree.mjs, 适配 pnpm/React).
//
// 背景: git worktree 不复制 `node_modules` 等 `pnpm install` 产物. Pier 的 renderer 两条加载
// 路径都依赖它们 —— dev 用 electron-vite 内嵌 vite dev server (需 node_modules 才能起),
// prod 用 `file://` 加载 out/renderer (需 `pnpm build` 生成). 新 worktree 两者皆缺,
// 于是 Electron 窗口加载不到 renderer → 白屏.
//
// pnpm 11 会把 workspace 与 patchedDependencies 的绝对路径写入 node_modules
// 状态。整体软链主仓 node_modules 会让 worktree 永久被判定为依赖不同步，
// `pnpm run/exec` 进而尝试清理主仓的共享目录。因此每个 worktree 保持自己的
// 顶层 node_modules 布局；包内容仍由 pnpm store 去重复用，无需重复下载。
//
// 幂等: 已有完整的本地安装则跳过; prod/packaged 需要的 `out/` 不在此处理
// (按需 `pnpm build`).

import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
} from "node:fs";
import path from "node:path";

const cwd = process.cwd();

function git(args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function resolveFromCwd(p) {
  return path.resolve(cwd, p);
}

let commonDir;
let gitDir;
try {
  commonDir = resolveFromCwd(git(["rev-parse", "--git-common-dir"]));
  gitDir = resolveFromCwd(git(["rev-parse", "--git-dir"]));
} catch (err) {
  console.error(
    `[setup-worktree] 不是 git 仓库或 git 不可用: ${err instanceof Error ? err.message : String(err)}`
  );
  process.exit(1);
}

// 主仓根 = git common dir (主仓 .git) 的父目录.
const mainRoot = path.dirname(commonDir);
const isWorktree = commonDir !== gitDir;

if (!isWorktree) {
  console.log(
    "[setup-worktree] 当前在主仓（非 worktree），无需初始化 worktree 依赖."
  );
  process.exit(0);
}

const mainNodeModules = path.join(mainRoot, "node_modules");
const wtNodeModules = path.join(cwd, "node_modules");

function ensureWorktreeNodeModules() {
  if (existsSync(wtNodeModules) || isBrokenSymlink(wtNodeModules)) {
    const stat = lstatSync(wtNodeModules);
    if (stat.isSymbolicLink()) {
      const target = path.resolve(cwd, readlinkSync(wtNodeModules));
      if (target === mainNodeModules) {
        console.log(
          "[setup-worktree] 移除与 pnpm 11 不兼容的主仓 node_modules 软链."
        );
      }
      rmSync(wtNodeModules); // 只删除 worktree 软链，不会删除目标目录。
    } else {
      // 真实目录：.modules.yaml 与根依赖同时存在才视为完整安装。
      if (
        existsSync(path.join(wtNodeModules, ".modules.yaml")) &&
        existsSync(path.join(wtNodeModules, "react"))
      ) {
        console.log(
          "[setup-worktree] worktree 已有独立完整 node_modules, 保留不动."
        );
        return;
      }
      rmSync(wtNodeModules, { recursive: true, force: true });
    }
  }
  console.log(
    "[setup-worktree] 安装 worktree 本地依赖（包内容复用 pnpm store）..."
  );
  const result = spawnSync("pnpm", ["install", "--frozen-lockfile"], {
    cwd,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    console.error(
      `[setup-worktree] pnpm install 失败 (exit ${result.status}).`
    );
    process.exit(1);
  }
}

function isBrokenSymlink(p) {
  try {
    return lstatSync(p).isSymbolicLink() && !existsSync(p);
  } catch {
    return false;
  }
}

function compareMissingPath(left, right) {
  const leftExists = existsSync(left);
  const rightExists = existsSync(right);
  if (!(leftExists || rightExists)) {
    return { equal: true };
  }
  if (!(leftExists && rightExists)) {
    return { equal: false, path: leftExists ? right : left };
  }
  return null;
}

function compareSymlink(left, right, leftStat, rightStat) {
  if (!(leftStat.isSymbolicLink() && rightStat.isSymbolicLink())) {
    return { equal: false, path: right };
  }
  return readlinkSync(left) === readlinkSync(right)
    ? { equal: true }
    : { equal: false, path: right };
}

function compareDirectory(left, right, leftStat, rightStat) {
  if (!(leftStat.isDirectory() && rightStat.isDirectory())) {
    return { equal: false, path: right };
  }
  const leftEntries = readdirSync(left).sort();
  const rightEntries = readdirSync(right).sort();
  if (leftEntries.length !== rightEntries.length) {
    return { equal: false, path: right };
  }
  for (let i = 0; i < leftEntries.length; i += 1) {
    if (leftEntries[i] !== rightEntries[i]) {
      return { equal: false, path: path.join(right, rightEntries[i] ?? "") };
    }
    const child = compareTree(
      path.join(left, leftEntries[i]),
      path.join(right, rightEntries[i])
    );
    if (!child.equal) {
      return child;
    }
  }
  return { equal: true };
}

function compareFile(left, right, leftStat, rightStat) {
  if (!(leftStat.isFile() && rightStat.isFile())) {
    return { equal: false, path: right };
  }
  if (leftStat.size !== rightStat.size) {
    return { equal: false, path: right };
  }
  return readFileSync(left).equals(readFileSync(right))
    ? { equal: true }
    : { equal: false, path: right };
}

function compareTree(left, right) {
  const missing = compareMissingPath(left, right);
  if (missing) {
    return missing;
  }

  const leftStat = lstatSync(left);
  const rightStat = lstatSync(right);
  if (leftStat.isSymbolicLink() || rightStat.isSymbolicLink()) {
    return compareSymlink(left, right, leftStat, rightStat);
  }
  if (leftStat.isDirectory() || rightStat.isDirectory()) {
    return compareDirectory(left, right, leftStat, rightStat);
  }
  return compareFile(left, right, leftStat, rightStat);
}

function libghosttyBuildInputsMatch() {
  const inputs = [
    "scripts/build-libghostty.sh",
    path.join("native", "Vendor", "libghostty-spm", "Patches", "ghostty"),
  ];
  for (const input of inputs) {
    const result = compareTree(
      path.join(mainRoot, input),
      path.join(cwd, input)
    );
    if (!result.equal) {
      return { match: false, path: result.path ?? input };
    }
  }
  return { match: true };
}

function copyLibghosttyFromMain(xcf) {
  if (process.env.GHOSTTY_TAG || process.env.LAKR_TAG) {
    console.log(
      "[setup-worktree] 检测到 GHOSTTY_TAG/LAKR_TAG 覆盖, 跳过主仓 GhosttyKit.xcframework 复用."
    );
    return false;
  }

  const mainXcf = path.join(
    mainRoot,
    "native",
    "Vendor",
    "libghostty-spm",
    "GhosttyKit.xcframework"
  );
  if (!existsSync(mainXcf)) {
    return false;
  }

  const inputs = libghosttyBuildInputsMatch();
  if (!inputs.match) {
    console.log(
      `[setup-worktree] libghostty 构建输入与主仓不一致 (${inputs.path}), 跳过主仓 GhosttyKit.xcframework 复用.`
    );
    return false;
  }

  rmSync(xcf, { force: true, recursive: true });
  mkdirSync(path.dirname(xcf), { recursive: true });
  cpSync(mainXcf, xcf, { recursive: true, verbatimSymlinks: true });
  console.log(`[setup-worktree] 从主仓复制 GhosttyKit.xcframework → ${xcf}`);
  return true;
}

// native/build/Release/ 是 `pnpm build:native` (swift + node-gyp) 的产物, git 不入库.
// 每个 worktree 必须各自编译一次, 否则主进程 require('.../ghostty_native.node') 直接抛
// "Cannot find module", panel 内只看到一行报错难以定位.
const nativeAddon = path.join(
  cwd,
  "native",
  "build",
  "Release",
  "ghostty_native.node"
);
const nativeBridgeDylib = path.join(
  cwd,
  "native",
  "build",
  "Release",
  "libGhosttyBridge.dylib"
);

function findNewestMtime(target) {
  if (!existsSync(target)) {
    return null;
  }
  const stat = statSync(target);
  if (!stat.isDirectory()) {
    return { path: target, mtimeMs: stat.mtimeMs };
  }
  let newest = null;
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      continue;
    }
    const sub = findNewestMtime(path.join(target, entry.name));
    if (sub && (!newest || sub.mtimeMs > newest.mtimeMs)) {
      newest = sub;
    }
  }
  return newest;
}

function staleNativeSource() {
  if (!(existsSync(nativeAddon) && existsSync(nativeBridgeDylib))) {
    return null;
  }
  const nativeRoot = path.join(cwd, "native");
  const artifactMtime = Math.min(
    statSync(nativeAddon).mtimeMs,
    statSync(nativeBridgeDylib).mtimeMs
  );
  const sourceCandidates = [
    path.join(nativeRoot, "src"),
    path.join(nativeRoot, "Sources"),
    path.join(nativeRoot, "Vendor", "libghostty-spm", "Sources"),
    path.join(nativeRoot, "Vendor", "libghostty-spm", "Package.swift"),
    path.join(nativeRoot, "binding.gyp"),
    path.join(nativeRoot, "Package.swift"),
    path.join(nativeRoot, "build.sh"),
  ];
  let stale = null;
  for (const candidate of sourceCandidates) {
    const newest = findNewestMtime(candidate);
    if (
      newest &&
      newest.mtimeMs > artifactMtime &&
      (!stale || newest.mtimeMs > stale.mtimeMs)
    ) {
      stale = newest;
    }
  }
  return stale;
}

function ensureNativeAddon() {
  const staleSource = staleNativeSource();
  if (
    existsSync(nativeAddon) &&
    existsSync(nativeBridgeDylib) &&
    !staleSource
  ) {
    console.log("[setup-worktree] native addon 已编译, 跳过.");
    return;
  }
  if (staleSource) {
    console.log(
      `[setup-worktree] native addon 过期 (${staleSource.path}), 重新编译...`
    );
  } else {
    console.log("[setup-worktree] 编译 native addon (首次约 30s)...");
  }
  const r = spawnSync("pnpm", ["build:native"], { cwd, stdio: "inherit" });
  if (r.status !== 0) {
    console.error(
      `[setup-worktree] native 编译失败 (exit ${r.status}). 见上方 build.sh 输出.`
    );
    process.exit(1);
  }
}

// GhosttyKit.xcframework 由 scripts/build-libghostty.sh 现地构建，不入库。
// 缺失就走 pnpm build:libghostty，避免 build:native 时 swift build 报难懂
// 的 "no such module 'libghostty'" 让用户猜。
function ensureLibghostty() {
  const xcf = path.join(
    cwd,
    "native",
    "Vendor",
    "libghostty-spm",
    "GhosttyKit.xcframework"
  );
  if (existsSync(xcf)) {
    return;
  }
  if (copyLibghosttyFromMain(xcf)) {
    return;
  }
  console.log(
    "[setup-worktree] GhosttyKit.xcframework 缺失, 从上游 + patches 现地构建 (首次约 3-5 分钟)..."
  );
  const r = spawnSync("pnpm", ["build:libghostty"], { cwd, stdio: "inherit" });
  if (r.status !== 0) {
    console.error(
      `[setup-worktree] libghostty 构建失败 (exit ${r.status}). 见上方脚本输出.`
    );
    process.exit(1);
  }
}

ensureWorktreeNodeModules();
ensureLibghostty();
ensureNativeAddon();

console.log(
  "[setup-worktree] 完成. dev 模式可运行 (pnpm run electron:dev).\n" +
    "  prod/packaged 加载需要 out/ —— 按需执行: pnpm build"
);

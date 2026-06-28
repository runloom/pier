#!/usr/bin/env node
// 让 git worktree 可运行 (照搬 loomdesk/scripts/setup-worktree.mjs, 适配 pnpm/React).
//
// 背景: git worktree 不复制 `node_modules` 等 `pnpm install` 产物. Pier 的 renderer 两条加载
// 路径都依赖它们 —— dev 用 electron-vite 内嵌 vite dev server (需 node_modules 才能起),
// prod 用 `file://` 加载 out/renderer (需 `pnpm build` 生成). 新 worktree 两者皆缺,
// 于是 Electron 窗口加载不到 renderer → 白屏.
//
// 本脚本把 worktree 的 node_modules 软链到主仓 node_modules: 主仓那份已经过 postinstall 的
// electron-rebuild (针对本机 Electron ABI), 软链复用比在 worktree 内重新 `pnpm install` +
// rebuild 更快也更稳.
//
// 幂等: 已正确软链则跳过; prod/packaged 需要的 `out/` 不在此处理 (按需 `pnpm build`).

import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readdirSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
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
    "[setup-worktree] 当前在主仓 (非 worktree), 无需软链 node_modules."
  );
  process.exit(0);
}

const mainNodeModules = path.join(mainRoot, "node_modules");
const wtNodeModules = path.join(cwd, "node_modules");

if (!existsSync(mainNodeModules)) {
  console.error(
    `[setup-worktree] 主仓缺 node_modules: ${mainNodeModules}\n` +
      `  请先在主仓执行: (cd ${mainRoot} && pnpm install)`
  );
  process.exit(1);
}

function linkNodeModules() {
  if (existsSync(wtNodeModules) || isBrokenSymlink(wtNodeModules)) {
    const stat = lstatSync(wtNodeModules);
    if (stat.isSymbolicLink()) {
      const target = path.resolve(cwd, readlinkSync(wtNodeModules));
      if (target === mainNodeModules) {
        console.log("[setup-worktree] node_modules 已软链到主仓, 跳过.");
        return;
      }
      rmSync(wtNodeModules); // 指向别处的软链, 重建
    } else {
      // 真实目录: 若已是完整安装 (含 react) 则尊重它, 不动; 否则视为残缺 (如仅 .vite 缓存) 替换.
      if (existsSync(path.join(wtNodeModules, "react"))) {
        console.log(
          "[setup-worktree] worktree 已有独立完整 node_modules, 保留不动."
        );
        return;
      }
      rmSync(wtNodeModules, { recursive: true, force: true });
    }
  }
  symlinkSync(mainNodeModules, wtNodeModules, "dir");
  console.log(`[setup-worktree] 已软链 node_modules → ${mainNodeModules}`);
}

function isBrokenSymlink(p) {
  try {
    return lstatSync(p).isSymbolicLink() && !existsSync(p);
  } catch {
    return false;
  }
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

linkNodeModules();
ensureNativeAddon();

console.log(
  "[setup-worktree] 完成. dev 模式可运行 (pnpm run electron:dev).\n" +
    "  prod/packaged 加载需要 out/ —— 按需执行: pnpm build"
);

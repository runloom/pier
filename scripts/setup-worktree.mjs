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

import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readlinkSync,
  rmSync,
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

linkNodeModules();

console.log(
  "[setup-worktree] 完成. dev 模式可运行 (pnpm run electron:dev).\n" +
    "  prod/packaged 加载需要 out/ —— 按需执行: pnpm build"
);

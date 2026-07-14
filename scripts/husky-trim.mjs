// husky 9 每次 `pnpm prepare` 会往 .husky/_/ 下生成一整套 (~15 个) 空转 hook
// 包装脚本 (post-checkout / post-merge / post-rewrite / pre-auto-gc / ...),
// 即便仓库根本没写对应 hook, git 也会在每次 checkout / merge / rebase / gc /
// worktree add 时 exec 一次 sh 只为让它 exit 0.
//
// 这在启用了 XProtect Behavioral 扫描的 macOS (26+) 上很脆弱: 首次 exec
// 每个 sh 都会被同步扫 20-30s, 上游若给 git 设了 timeout (Pier / Codex / Kiro
// / CI 都会这么做) 就会 SIGKILL 整棵进程树, git 抛出:
//
//   error: <hook> died of signal 9
//
// 治本做法: 仅保留仓库 .husky/ 下实际定义过的 hook. git 在 core.hooksPath
// 里找不到对应文件时直接 skip, 完全不 spawn shell, 也就没扫描窗口.
//
// 本脚本 idempotent, 由 `pnpm prepare` 在 husky install 之后调用.

import { readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const huskyDir = join(projectRoot, ".husky");
const managedDir = join(huskyDir, "_");

// husky 9 运行时机制, 与具体 hook 名无关, 永远保留
const HUSKY_INTERNAL = new Set(["h", "husky.sh", ".gitignore"]);

function listFiles(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
  } catch (err) {
    if (err && err.code === "ENOENT") {
      return [];
    }
    throw err;
  }
}

// .husky/ 下用户实际定义的 hook 名 (排除 _ 目录本身)
const userHooks = new Set(listFiles(huskyDir));

// 扫 .husky/_/, 不在白名单里的空转 hook 全删
const managed = listFiles(managedDir);
const removed = [];
for (const name of managed) {
  if (HUSKY_INTERNAL.has(name)) {
    continue;
  }
  if (userHooks.has(name)) {
    continue;
  }
  rmSync(join(managedDir, name), { force: true });
  removed.push(name);
}

if (removed.length > 0) {
  console.log(
    `[husky-trim] removed ${removed.length} unused hook wrapper(s): ${removed.join(", ")}`
  );
} else {
  console.log("[husky-trim] no unused hook wrappers to trim");
}

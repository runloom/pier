// 兜底: pnpm 11 的 allowBuilds prompt 只对 install 时新检测到的 build script 触发。
// 若 electron 的 postinstall 之前因 ignored builds 没跑过, 后续 pnpm install
// (即使 allowBuilds: electron: true) 也不会补跑 → dist/Electron.app 缺失
// → `electron-vite dev` 报 "Error: Electron uninstall".
//
// 这里在每次 install 后检查 binary, 缺失时手动跑一次 install.js (幂等).

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const electronDir = path.join(root, "node_modules", "electron");

if (!existsSync(electronDir)) {
  process.exit(0);
}

const pathFile = path.join(electronDir, "path.txt");
// pnpm 11 ignored builds 场景下 path.txt 也缺失, 这时不能 short-circuit —
// install.js 会同时把 path.txt 和 dist/ 补回来.
if (existsSync(pathFile)) {
  const relativeBinary = readFileSync(pathFile, "utf8").trim();
  const binary = path.join(electronDir, "dist", relativeBinary);
  if (existsSync(binary)) {
    process.exit(0);
  }
}

console.log("[ensure-electron] Electron binary missing, running install.js...");
const result = spawnSync(process.execPath, ["install.js"], {
  cwd: electronDir,
  stdio: "inherit",
});
process.exit(result.status ?? 1);

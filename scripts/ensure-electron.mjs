// 兜底: pnpm 11 的 allowBuilds prompt 只对 install 时新检测到的 build script 触发。
// 若 electron 的 postinstall 之前因 ignored builds 没跑过, 后续 pnpm install
// (即使 allowBuilds: electron: true) 也不会补跑 → dist/Electron.app 缺失
// → `electron-vite dev` 报 "Error: Electron uninstall".
//
// 这里在每次 install 后检查 binary, 缺失时手动跑一次 install.js (幂等).
// electron 二进制下载走 GitHub release assets, 偶发 504 Gateway Time-out;
// 单次失败会让整个 install 红, 所以按退避重试几次, 每次重试前复查 binary
// (install.js 自身也幂等, 已有缓存时直接返回).

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const electronDir = path.join(root, "node_modules", "electron");
const INSTALL_ATTEMPTS = 3;
const INSTALL_RETRY_DELAY_MS = 3000;

if (!existsSync(electronDir)) {
  process.exit(0);
}

const pathFile = path.join(electronDir, "path.txt");

function electronBinaryPresent() {
  // pnpm 11 ignored builds 场景下 path.txt 也缺失, 这时不能 short-circuit —
  // install.js 会同时把 path.txt 和 dist/ 补回来.
  if (!existsSync(pathFile)) {
    return false;
  }
  const relativeBinary = readFileSync(pathFile, "utf8").trim();
  return existsSync(path.join(electronDir, "dist", relativeBinary));
}

if (electronBinaryPresent()) {
  process.exit(0);
}

for (let attempt = 1; attempt <= INSTALL_ATTEMPTS; attempt += 1) {
  console.log(
    `[ensure-electron] Electron binary missing, running install.js (attempt ${attempt}/${INSTALL_ATTEMPTS})...`
  );
  const { status } = spawnSync(process.execPath, ["install.js"], {
    cwd: electronDir,
    stdio: "inherit",
  });
  if (status === 0 || electronBinaryPresent()) {
    process.exit(0);
  }
  if (attempt < INSTALL_ATTEMPTS) {
    console.log(
      `[ensure-electron] install.js failed (exit ${status ?? "spawn error"}); retrying in ${INSTALL_RETRY_DELAY_MS}ms...`
    );
    await new Promise((resolve) => setTimeout(resolve, INSTALL_RETRY_DELAY_MS));
  }
}

console.log(
  `[ensure-electron] Electron binary still missing after ${INSTALL_ATTEMPTS} attempts`
);
process.exit(1);

// 多 worktree dev profile 编排 (照搬 loomdesk/scripts/dev-profile.js, 适配 pnpm/node/Pier).
// shebang 已移除: 文件作为 electron.vite.config.ts 的 import 被 esbuild bundle, 非首行 shebang 会触发语法错误.
// 所有 npm script 用 `node ./scripts/dev-profile.mjs <cmd>` 调用, 不依赖 shebang.
//
// 每个 worktree 一份 .pier-dev/profile.json (基于分支名+路径 hash 派生 profile name),
// 自动分配 devPort/hmrPort, 独立 Electron userData. 端口已占且 owner 不是自己 → 报错退出,
// 永远不杀别人的进程. runtime.json 用 PID 存活检测判端口归属.

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** @type {1} */
const PROFILE_VERSION = 1;
const PROFILE_DIR_NAME = ".pier-dev";
const PROFILE_FILE_NAME = "profile.json";
const RUNTIME_FILE_NAME = "runtime.json";
const BASE_DEV_PORT = 5173;
const PORT_SCAN_LIMIT = 100;

/**
 * @typedef {object} DevProfile
 * @property {1} version
 * @property {string} profile
 * @property {string} worktreeRoot
 * @property {number} devPort
 * @property {number} hmrPort
 * @property {string} host
 * @property {string} rendererUrl
 * @property {string} electronUserDataDir
 * @property {string} profileDir
 * @property {string} profileFile
 * @property {string} runtimeFile
 */

/**
 * @typedef {object} RuntimeManifest
 * @property {1} version
 * @property {string} profile
 * @property {string} worktreeRoot
 * @property {number} devPort
 * @property {number} hmrPort
 * @property {string} rendererUrl
 * @property {string} electronUserDataDir
 * @property {number} pid
 * @property {string} command
 * @property {string} startedAt
 */

/**
 * @param {string} input
 */
function shortHash(input) {
  return createHash("sha256").update(input).digest("hex").slice(0, 8);
}

/**
 * @param {string} value
 */
function sanitizeProfileName(value) {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return sanitized || "default";
}

/**
 * @param {string | undefined} value
 */
function parsePort(value) {
  if (!value) {
    return null;
  }
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n < 1024 || n > 65_535) {
    return null;
  }
  return n;
}
/**
 * @param {unknown} value
 */
function profilePort(value) {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1024 &&
    value <= 65_535
    ? value
    : null;
}

/**
 * @param {string[]} args
 * @param {string} cwd
 */
function runGit(args, cwd) {
  const res = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (res.status !== 0) {
    return null;
  }
  return res.stdout.trim();
}

/**
 * @param {string} cwd
 */
function resolveWorktreeRoot(cwd) {
  const root = runGit(["rev-parse", "--show-toplevel"], cwd);
  return path.resolve(root || cwd);
}

/**
 * @param {string} cwd
 */
function currentBranchName(cwd) {
  return runGit(["branch", "--show-current"], cwd) || path.basename(cwd);
}

/**
 * @param {string} cwd
 */
function listGitWorktrees(cwd) {
  const out = runGit(["worktree", "list", "--porcelain"], cwd);
  if (!out) {
    return [];
  }
  return out
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => path.resolve(line.slice("worktree ".length).trim()))
    .filter(Boolean);
}

/**
 * @template T
 * @param {string} file
 * @returns {T | null}
 */
function readJson(file) {
  if (!existsSync(file)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * @param {string} file
 * @param {unknown} value
 */
function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, "\t")}\n`, "utf8");
}

/**
 * @param {string} worktreeRoot
 */
function defaultProfileName(worktreeRoot) {
  const branch = currentBranchName(worktreeRoot);
  const base = sanitizeProfileName(branch || path.basename(worktreeRoot));
  return `${base}-${shortHash(worktreeRoot)}`;
}

/**
 * @param {string} profile
 */
function defaultElectronUserDataDir(profile) {
  if (process.platform === "darwin") {
    return path.join(
      homedir(),
      "Library",
      "Application Support",
      "Pier-dev",
      profile
    );
  }
  if (process.platform === "win32") {
    return path.join(
      process.env.APPDATA || path.join(homedir(), "AppData", "Roaming"),
      "Pier-dev",
      profile
    );
  }
  return path.join(
    process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config"),
    "Pier-dev",
    profile
  );
}

/**
 * @param {string} worktreeRoot
 * @param {string} currentProfileFile
 */
function reservedDevPorts(worktreeRoot, currentProfileFile) {
  const ports = new Set();
  for (const worktree of listGitWorktrees(worktreeRoot)) {
    const profileFile = path.join(
      worktree,
      PROFILE_DIR_NAME,
      PROFILE_FILE_NAME
    );
    if (path.resolve(profileFile) === path.resolve(currentProfileFile)) {
      continue;
    }
    const profile = readJson(profileFile);
    const devPort = profilePort(profile?.devPort);
    const hmrPort = profilePort(profile?.hmrPort);
    if (devPort) {
      ports.add(devPort);
    }
    if (hmrPort) {
      ports.add(hmrPort);
    }
  }
  return ports;
}

/**
 * @param {Set<number>} reserved
 */
function allocateDevPort(reserved) {
  for (
    let port = BASE_DEV_PORT;
    port < BASE_DEV_PORT + PORT_SCAN_LIMIT;
    port++
  ) {
    if (!(reserved.has(port) || reserved.has(port + 10))) {
      return port;
    }
  }
  return (
    BASE_DEV_PORT +
    (Number.parseInt(shortHash(process.cwd()).slice(0, 4), 16) % 1000)
  );
}

/**
 * @param {number} devPort
 * @param {Set<number>} reserved
 */
function allocateHmrPort(devPort, reserved) {
  const preferred = devPort + 10;
  if (preferred <= 65_535 && !reserved.has(preferred)) {
    return preferred;
  }
  for (
    let port = BASE_DEV_PORT;
    port < BASE_DEV_PORT + PORT_SCAN_LIMIT;
    port++
  ) {
    if (port !== devPort && !reserved.has(port)) {
      return port;
    }
  }
  return preferred;
}

/**
 * Resolve the current worktree dev profile. This is intentionally sync so Vite and
 * Playwright configs can use the same source of truth as Node scripts.
 *
 * @param {{ cwd?: string; env?: NodeJS.ProcessEnv; ensure?: boolean }} [options]
 * @returns {DevProfile}
 */
export function resolveDevProfile(options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const env = options.env || process.env;
  const ensure = options.ensure ?? true;
  const worktreeRoot = resolveWorktreeRoot(cwd);
  const profileDir = path.join(worktreeRoot, PROFILE_DIR_NAME);
  const profileFile = path.join(profileDir, PROFILE_FILE_NAME);
  const runtimeFile = path.join(profileDir, RUNTIME_FILE_NAME);
  const existing = readJson(profileFile);

  // profile name 每次从当前分支重新计算, 不从 existing 继承.
  // 切分支后 profile.json 残留旧分支名 → 旧名可能与另一个 worktree 的活跃 dev server
  // 重名 → Electron 连到错误实例. 端口 / userData 按 worktree 目录持久化, 不受影响.
  const profile = sanitizeProfileName(
    env.PIER_DEV_PROFILE || defaultProfileName(worktreeRoot)
  );
  const explicitDevPort = parsePort(env.PIER_DEV_PORT);
  const explicitHmrPort = parsePort(env.PIER_HMR_PORT);
  const reserved = reservedDevPorts(worktreeRoot, profileFile);
  const existingDevPort = profilePort(existing?.devPort);
  const canReuseExistingDevPort =
    !!existingDevPort && !reserved.has(existingDevPort);
  const devPort =
    explicitDevPort ||
    (canReuseExistingDevPort ? existingDevPort : allocateDevPort(reserved));
  const existingHmrPort = profilePort(existing?.hmrPort);
  const canReuseExistingHmrPort =
    canReuseExistingDevPort &&
    !!existingHmrPort &&
    !reserved.has(existingHmrPort);
  const hmrPort =
    explicitHmrPort ||
    (canReuseExistingHmrPort
      ? existingHmrPort
      : allocateHmrPort(devPort, reserved));
  const host = env.PIER_DEV_HOST || existing?.host || "127.0.0.1";
  const rendererUrl = `http://${host}:${devPort}`;
  // electronUserDataDir 按 worktree 持久化 (切分支不丢窗口布局等状态).
  // 仅首次无 existing 时从 profile name 派生.
  const electronUserDataDir =
    env.ELECTRON_USER_DATA_DIR ||
    existing?.electronUserDataDir ||
    defaultElectronUserDataDir(profile);

  /** @type {DevProfile} */
  const resolved = {
    version: PROFILE_VERSION,
    profile,
    worktreeRoot,
    devPort,
    hmrPort,
    host,
    rendererUrl,
    electronUserDataDir,
    profileDir,
    profileFile,
    runtimeFile,
  };

  if (ensure) {
    writeJson(profileFile, resolved);
    ensureLaunchJson(resolved);
  }

  return resolved;
}

/**
 * Sync `.claude/launch.json` to the current worktree's devPort so Claude Code's
 * preview_start finds the right server. The file is per-worktree (gitignored) —
 * each worktree owns its own copy.
 *
 * @param {DevProfile} profile
 */
function ensureLaunchJson(profile) {
  const launchFile = path.join(profile.worktreeRoot, ".claude", "launch.json");
  const existing = readJson(launchFile);
  const configurations = Array.isArray(existing?.configurations)
    ? existing.configurations
    : [];
  const devIdx = configurations.findIndex((c) => c?.name === "dev");
  const devConfig = {
    name: "dev",
    runtimeExecutable: "pnpm",
    runtimeArgs: ["dev"],
    port: profile.devPort,
  };
  if (devIdx >= 0) {
    if (configurations[devIdx].port === profile.devPort) {
      return;
    }
    configurations[devIdx] = { ...configurations[devIdx], ...devConfig };
  } else {
    configurations.push(devConfig);
  }
  writeJson(launchFile, {
    version: existing?.version || "0.0.1",
    configurations,
  });
}

/**
 * @param {NodeJS.ProcessEnv} [baseEnv]
 * @param {DevProfile} [profile]
 */
export function withDevProfileEnv(
  baseEnv = process.env,
  profile = resolveDevProfile({ env: baseEnv })
) {
  return {
    ...baseEnv,
    PIER_DEV_PROFILE: profile.profile,
    PIER_DEV_PORT: String(profile.devPort),
    PIER_HMR_PORT: String(profile.hmrPort),
    PIER_DEV_RUNTIME_FILE: profile.runtimeFile,
    ELECTRON_RENDERER_URL: profile.rendererUrl,
    ELECTRON_USER_DATA_DIR: profile.electronUserDataDir,
  };
}

/**
 * @param {number} pid
 */
function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} runtimeFile
 */
function readRuntime(runtimeFile) {
  return readJson(runtimeFile);
}

/**
 * @param {DevProfile} profile
 * @param {RuntimeManifest | null | undefined} runtime
 */
export function isRuntimeOwnedByProfile(profile, runtime) {
  const pid = typeof runtime?.pid === "number" ? runtime.pid : null;
  return (
    runtime?.profile === profile.profile &&
    runtime.devPort === profile.devPort &&
    runtime.hmrPort === profile.hmrPort &&
    runtime.rendererUrl === profile.rendererUrl &&
    typeof runtime.worktreeRoot === "string" &&
    path.resolve(runtime.worktreeRoot) === path.resolve(profile.worktreeRoot) &&
    !!pid &&
    isPidAlive(pid)
  );
}

/**
 * @param {DevProfile} profile
 * @param {number} pid
 * @param {string} command
 */
function writeRuntime(profile, pid, command) {
  writeJson(profile.runtimeFile, {
    version: PROFILE_VERSION,
    profile: profile.profile,
    worktreeRoot: profile.worktreeRoot,
    devPort: profile.devPort,
    hmrPort: profile.hmrPort,
    rendererUrl: profile.rendererUrl,
    electronUserDataDir: profile.electronUserDataDir,
    pid,
    command,
    startedAt: new Date().toISOString(),
  });
}

/**
 * @param {DevProfile} profile
 * @param {number} pid
 */
function cleanupRuntime(profile, pid) {
  const runtime = readRuntime(profile.runtimeFile);
  if (runtime?.pid === pid) {
    rmSync(profile.runtimeFile, { force: true });
  }
}

/**
 * @param {number} port
 * @param {string} [host]
 */
export async function isPortListening(port, host = "127.0.0.1") {
  try {
    const response = await fetch(`http://${host}:${port}`, {
      method: "GET",
      signal: AbortSignal.timeout(1500),
    });
    return response.ok || response.status >= 200;
  } catch {
    return false;
  }
}

async function predev() {
  const profile = resolveDevProfile();

  // native addon 守卫: 缺了直接报错, 而不是进 Electron 后 require 才炸 (panel 内只一行不易定位).
  const nativeAddon = path.join(
    profile.worktreeRoot,
    "native",
    "build",
    "Release",
    "ghostty_native.node"
  );
  if (!existsSync(nativeAddon)) {
    console.error(
      `[dev-profile] 缺 native addon: ${nativeAddon}\n` +
        "  这是终端 PTY 桥接的 swift+node-gyp 产物, 每个 worktree 必须各自编译.\n" +
        "  请先执行: pnpm setup:worktree (会自动跑 pnpm build:native)"
    );
    process.exit(1);
  }

  const runtime = readRuntime(profile.runtimeFile);
  if (runtime?.pid && !isPidAlive(runtime.pid)) {
    rmSync(profile.runtimeFile, { force: true });
  }

  if (!(await isPortListening(profile.devPort, profile.host))) {
    return;
  }

  const activeRuntime = readRuntime(profile.runtimeFile);
  if (isRuntimeOwnedByProfile(profile, activeRuntime)) {
    console.error(
      `[dev-profile] ${profile.profile} already has a dev server on ${profile.rendererUrl} (pid ${activeRuntime.pid}).`
    );
    console.error(
      "[dev-profile] Not killing it; stop that process first if you want to restart."
    );
  } else {
    console.error(
      `[dev-profile] Port ${profile.devPort} is already in use, but it is not owned by current profile ${profile.profile}.`
    );
    console.error(
      "[dev-profile] Not killing unknown processes. Set PIER_DEV_PORT to override if needed."
    );
  }
  process.exit(1);
}

/**
 * Forward SIGINT/SIGTERM to the child's process group, escalating to SIGKILL on
 * a second signal or a 3s watchdog. Children MUST be spawned with `detached:true`
 * so `child.pid === pgid` and `process.kill(-pid, sig)` reaches the whole tree.
 *
 * @param {import("node:child_process").ChildProcess} child
 */
function forwardSignals(child) {
  /** @type {NodeJS.Signals[]} */
  const signals = ["SIGINT", "SIGTERM"];
  let escalated = false;
  /** @type {NodeJS.Timeout | null} */
  let watchdog = null;
  /** @type {Map<NodeJS.Signals, () => void>} */
  const listeners = new Map();

  /** @param {NodeJS.Signals} sig */
  const killGroup = (sig) => {
    if (!child.pid) {
      return;
    }
    try {
      // detached:true → child is its own pgid; negative pid targets the group.
      process.kill(-child.pid, sig);
    } catch {
      // ESRCH (group already gone) or non-detached fallback — try the child directly.
      try {
        child.kill(sig);
      } catch {
        // already dead
      }
    }
  };

  const cleanup = () => {
    if (watchdog) {
      clearTimeout(watchdog);
      watchdog = null;
    }
    for (const [sig, fn] of listeners) {
      process.off(sig, fn);
    }
    listeners.clear();
  };
  child.once("close", cleanup);

  for (const sig of signals) {
    const onSignal = () => {
      if (escalated) {
        // Second signal: don't keep waiting on a wedged child — SIGKILL and bail.
        killGroup("SIGKILL");
        cleanup();
        process.exit(130);
      }
      escalated = true;
      // SIGTERM is what vite / electron-vite cleanly shut down on; SIGINT races
      // the tty-delivered SIGINT the child already saw and can dead-lock close().
      killGroup("SIGTERM");
      watchdog = setTimeout(() => {
        killGroup("SIGKILL");
      }, 3000);
      if (watchdog.unref) {
        watchdog.unref();
      }
    };
    listeners.set(sig, onSignal);
    process.on(sig, onSignal);
  }
}

/**
 * Wait for child process exit. Uses `close` (not `exit`) so all inherited stdio
 * is fully flushed before the promise resolves — prevents shutdown log lines from
 * racing past the shell prompt.
 *
 * @param {import("node:child_process").ChildProcess} child
 * @returns {Promise<number>}
 */
function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (signal === "SIGINT") {
        resolve(130);
      } else if (signal === "SIGTERM") {
        resolve(143);
      } else {
        resolve(code ?? 1);
      }
    });
  });
}

async function electronDev() {
  const profile = resolveDevProfile();
  const env = withDevProfileEnv(process.env, profile);
  console.log(`[dev-profile] ${profile.profile}: ${profile.rendererUrl}`);
  console.log(`[dev-profile] userData: ${profile.electronUserDataDir}`);

  if (await isPortListening(profile.devPort, profile.host)) {
    const activeRuntime = readRuntime(profile.runtimeFile);
    if (isRuntimeOwnedByProfile(profile, activeRuntime)) {
      console.error(
        `[dev-profile] ${profile.profile} already running on ${profile.rendererUrl} (pid ${activeRuntime.pid}).`
      );
      console.error("[dev-profile] Stop it first if you want to restart.");
    } else {
      console.error(
        `[dev-profile] Port ${profile.devPort} is already in use, but it is not owned by current profile ${profile.profile}.`
      );
      console.error(
        "[dev-profile] Not killing unknown processes. Stop that process or set PIER_DEV_PORT to override."
      );
    }
    process.exit(1);
  }

  // electron-vite 5.x 单进程: 自带 renderer vite dev server (按 electron.vite.config.ts
  // renderer.server 读 PIER_DEV_PORT/PIER_HMR_PORT) + main/preload build/watch + 启 Electron.
  const child = spawn("pnpm", ["exec", "electron-vite", "dev"], {
    cwd: profile.worktreeRoot,
    env,
    stdio: "inherit",
    // Own process group so forwardSignals can `kill -- -pid` the whole tree.
    detached: true,
  });
  if (child.pid) {
    writeRuntime(profile, child.pid, "electron-vite dev");
  }
  forwardSignals(child);
  const exitCode = await waitForExit(child);
  if (child.pid) {
    cleanupRuntime(profile, child.pid);
  }
  // SIGTERM (143) / SIGINT (130) = normal user quit (Cmd+Q / Ctrl+C).
  // Exit 0 so the shell prompt doesn't print "script exited with code 143".
  process.exit(exitCode === 143 || exitCode === 130 ? 0 : exitCode);
}

function describeRuntimeState(runtime) {
  if (!runtime?.pid) {
    return "not running";
  }
  return isPidAlive(runtime.pid)
    ? `running (pid ${runtime.pid})`
    : `stale (pid ${runtime.pid})`;
}

function printInfo() {
  const profile = resolveDevProfile();
  const runtime = readRuntime(profile.runtimeFile);
  const runtimeState = describeRuntimeState(runtime);
  console.log(
    JSON.stringify({ ...profile, runtime: runtimeState }, null, "\t")
  );
}

function printHelp() {
  console.log(
    "Usage: node ./scripts/dev-profile.mjs <command>\n\nCommands:\n  predev        Refuse unsafe dev-server starts; never kills unknown processes.\n  electron-dev  Run electron-vite dev with the current worktree profile.\n  info          Print the current worktree profile.\n"
  );
}

async function main() {
  const command = process.argv[2] || "info";
  if (command === "predev") {
    await predev();
    return;
  }
  if (command === "electron-dev") {
    await electronDev();
    return;
  }
  if (command === "info") {
    printInfo();
    return;
  }
  printHelp();
  process.exit(1);
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  main().catch((err) => {
    console.error(
      `[dev-profile] ${err instanceof Error ? err.message : String(err)}`
    );
    process.exit(1);
  });
}

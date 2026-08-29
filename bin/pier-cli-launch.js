import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { dirname, join } from "node:path";

export const LAUNCH_WAIT_MS = 15_000;
export const LAUNCH_POLL_MS = 200;
export const NO_RENDERER_WINDOW_MESSAGE = "no renderer window available";

export function isPackagedPierCli({
  argv1 = process.argv[1],
  env = process.env,
  execPath = process.execPath,
  platform = process.platform,
} = {}) {
  if (platform !== "darwin") {
    return false;
  }
  if (env.PIER_DEV_PROFILE) {
    return false;
  }
  const script = typeof argv1 === "string" ? argv1 : "";
  if (script.endsWith("/Contents/Resources/bin/pier.mjs")) {
    return true;
  }
  return (
    env.ELECTRON_RUN_AS_NODE === "1" &&
    typeof execPath === "string" &&
    execPath.endsWith("/MacOS/Pier")
  );
}

export function findWorktreeDevProfile(
  startDir,
  { existsSync: exists = existsSync, readFileSync: read = readFileSync } = {}
) {
  let dir = startDir;
  while (dir && dir !== dirname(dir)) {
    const file = join(dir, ".pier-dev", "profile.json");
    if (exists(file)) {
      let profile = {};
      try {
        const parsed = JSON.parse(read(file, "utf8"));
        if (parsed && typeof parsed === "object") {
          profile = parsed;
        }
      } catch {
        // Presence is enough to block production launch.
      }
      return { dir, file, profile };
    }
    dir = dirname(dir);
  }
  return null;
}

export function shouldOpenApplication({
  cwd = process.cwd(),
  env = process.env,
  hasDevProfile,
  packaged = isPackagedPierCli({ env }),
} = {}) {
  if (!packaged || env.PIER_DEV_PROFILE) {
    return false;
  }
  if (env.PIER_USER_DATA_DIR || env.ELECTRON_USER_DATA_DIR) {
    return false;
  }
  const blockedByProfile =
    hasDevProfile ?? Boolean(findWorktreeDevProfile(cwd));
  if (blockedByProfile) {
    return false;
  }
  if (env.PIER_CONTROL_SOCKET || env.PIER_CONTROL_SOCKET_PATH) {
    return false;
  }
  return true;
}

export function shouldWaitForControlSocket({
  canLaunch,
  env = process.env,
} = {}) {
  return (
    Boolean(canLaunch) ||
    Boolean(env.PIER_CONTROL_SOCKET) ||
    Boolean(env.PIER_CONTROL_SOCKET_PATH)
  );
}

export function isNoRendererWindowError(result) {
  if (result?.ok) {
    return false;
  }
  const message = result?.error?.message;
  return (
    result?.error?.code === "platform_unavailable" &&
    message === NO_RENDERER_WINDOW_MESSAGE
  );
}

export function openPierApp({ spawnFn = spawn } = {}) {
  spawnFn("open", ["-a", "Pier"], { detached: true, stdio: "ignore" }).unref();
}

export async function retryUntilRendererWindow({
  now = Date.now,
  pollMs = LAUNCH_POLL_MS,
  request,
  sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms)),
  timeoutMs = LAUNCH_WAIT_MS,
} = {}) {
  let result = await request();
  const deadline = now() + timeoutMs;
  while (isNoRendererWindowError(result) && now() < deadline) {
    await sleep(pollMs);
    result = await request();
  }
  return result;
}

export function waitForSocket(
  socketPath,
  {
    connectFn = createConnection,
    now = Date.now,
    pollMs = LAUNCH_POLL_MS,
    timeoutMs = LAUNCH_WAIT_MS,
  } = {}
) {
  const deadline = now() + timeoutMs;
  return new Promise((resolveWait, reject) => {
    const attempt = () => {
      const socket = connectFn(socketPath);
      const fail = () => {
        socket.destroy();
        if (now() >= deadline) {
          reject(new Error(`timed out connecting to Pier at ${socketPath}`));
          return;
        }
        setTimeout(attempt, pollMs);
      };
      socket.once("connect", () => {
        socket.destroy();
        resolveWait();
      });
      socket.once("error", fail);
    };
    attempt();
  });
}

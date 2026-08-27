import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const LAUNCH_ENV_FILE = "launch-env.json";
const DEV_PROFILE_DIR = ".pier-dev";
const DEV_RUNTIME_DIR = "electron-runtime";
const DEV_APP_NAME = "PierDev.app";

const LAUNCH_ENV_KEYS = [
  "ELECTRON_USER_DATA_DIR",
  "ELECTRON_RENDERER_URL",
  "PIER_DEV_PROFILE",
  "PIER_DEV_ELECTRON_SHELL",
  "NODE_ENV_ELECTRON_VITE",
  "PIER_DEV_PORT",
  "PIER_HMR_PORT",
  "PIER_DEV_RUNTIME_FILE",
] as const;

let hydrated = false;

export function isPierDevShellExecutable(execPath: string): boolean {
  const normalized = execPath.replaceAll("\\", "/");
  return (
    normalized.includes(
      `/${DEV_PROFILE_DIR}/${DEV_RUNTIME_DIR}/${DEV_APP_NAME}/`
    ) || normalized.endsWith(`/${DEV_APP_NAME}/Contents/MacOS/PierDev`)
  );
}

export function launchEnvFileFromPierDevExec(
  execPath: string
): string | undefined {
  if (!isPierDevShellExecutable(execPath)) {
    return;
  }
  // …/.pier-dev/electron-runtime/PierDev.app/Contents/MacOS/PierDev
  const macosDir = dirname(execPath);
  const contentsDir = dirname(macosDir);
  const appDir = dirname(contentsDir);
  const runtimeDir = dirname(appDir);
  const profileDir = dirname(runtimeDir);
  if (basename(profileDir) !== DEV_PROFILE_DIR) {
    return;
  }
  return join(profileDir, LAUNCH_ENV_FILE);
}

export function hydrateDevLaunchEnv(
  env: NodeJS.ProcessEnv = process.env,
  execPath: string = process.execPath
): void {
  if (hydrated) {
    return;
  }
  hydrated = true;
  if (!isPierDevShellExecutable(execPath)) {
    return;
  }
  const filePath = launchEnvFileFromPierDevExec(execPath);
  if (!filePath) {
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return;
  }
  if (parsed === null || typeof parsed !== "object") {
    return;
  }
  const record = parsed as Record<string, unknown>;
  for (const key of LAUNCH_ENV_KEYS) {
    if (env[key]) {
      continue;
    }
    const value = record[key];
    if (typeof value === "string" && value.length > 0) {
      env[key] = value;
    }
  }
}

export function resetDevLaunchEnvHydrationForTests(): void {
  hydrated = false;
}

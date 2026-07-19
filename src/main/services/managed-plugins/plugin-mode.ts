import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  PIER_PLUGIN_MODE_ENV,
  type PierPluginMode,
  type PluginWorkspaceConfigFile,
  type PluginWorkspaceRootConfig,
  resolvePierPluginMode,
} from "@shared/plugin-mode.ts";
import { app } from "electron";
import { isDevRuntime } from "../../runtime-mode.ts";

/**
 * File under the worktree `.pier-dev/` (or cwd) describing workspace plugin roots.
 * Example:
 * {
 *   "mode": "workspace",
 *   "roots": [
 *     { "id": "pier.grok", "path": "packages/plugin-grok" },
 *     { "id": "my.custom", "path": "../my-plugin" }
 *   ]
 * }
 */
export const PLUGIN_WORKSPACE_CONFIG_RELATIVE = join(
  ".pier-dev",
  "plugin-workspace.json"
);

export function readPluginWorkspaceConfigFile(
  cwd: string = process.cwd()
): PluginWorkspaceConfigFile | null {
  const path = join(cwd, PLUGIN_WORKSPACE_CONFIG_RELATIVE);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    const mode =
      record.mode === "workspace" || record.mode === "release"
        ? record.mode
        : undefined;
    const rootsRaw = record.roots;
    const roots: PluginWorkspaceRootConfig[] = [];
    if (Array.isArray(rootsRaw)) {
      for (const item of rootsRaw) {
        if (typeof item !== "object" || item === null) continue;
        const row = item as Record<string, unknown>;
        if (typeof row.id !== "string" || row.id.length === 0) continue;
        if (typeof row.path !== "string" || row.path.length === 0) continue;
        roots.push({ id: row.id, path: row.path });
      }
    }
    return {
      ...(mode ? { mode } : {}),
      ...(roots.length > 0 ? { roots } : {}),
    };
  } catch {
    return null;
  }
}

export function resolveWorkspaceRootAbsolute(
  cwd: string,
  rootPath: string
): string {
  return isAbsolute(rootPath) ? rootPath : resolve(cwd, rootPath);
}

interface WorktreeDevElectronRuntimeInput {
  actualExecPath: string;
  cwd: string;
  devProfile: string | undefined;
  devRuntime: boolean;
  electronExecPath: string | undefined;
}

export function isWorktreeDevElectronRuntime({
  actualExecPath,
  cwd,
  devProfile,
  devRuntime,
  electronExecPath,
}: WorktreeDevElectronRuntimeInput): boolean {
  if (!(devRuntime && devProfile && electronExecPath)) {
    return false;
  }
  if (resolve(actualExecPath) !== resolve(electronExecPath)) {
    return false;
  }

  const runtimeRoot = resolve(cwd, ".pier-dev", "electron-runtime");
  const relativeExecPath = relative(runtimeRoot, resolve(actualExecPath));
  return (
    relativeExecPath !== "" &&
    !relativeExecPath.startsWith("..") &&
    !isAbsolute(relativeExecPath)
  );
}

export function getPierPluginMode(cwd: string = process.cwd()): PierPluginMode {
  const config = readPluginWorkspaceConfigFile(cwd);
  const devRuntime = isDevRuntime();
  // The macOS dev profile copies and renames Electron.app under
  // `.pier-dev/electron-runtime`. Electron reports that copy as packaged even
  // though electron-vite is running the current worktree. Normalize only this
  // exact profile-owned runtime; real packaged distributions remain release.
  const isWorktreeDevRuntime = isWorktreeDevElectronRuntime({
    actualExecPath: process.execPath,
    cwd,
    devProfile: process.env.PIER_DEV_PROFILE,
    devRuntime,
    electronExecPath: process.env.ELECTRON_EXEC_PATH,
  });
  return resolvePierPluginMode({
    configMode: config?.mode ?? null,
    envMode: process.env[PIER_PLUGIN_MODE_ENV] ?? null,
    isDevRuntime: devRuntime,
    isPackagedApp: app.isPackaged && !isWorktreeDevRuntime,
  });
}

export function listConfiguredWorkspaceRoots(
  cwd: string = process.cwd()
): PluginWorkspaceRootConfig[] {
  return [...(readPluginWorkspaceConfigFile(cwd)?.roots ?? [])];
}

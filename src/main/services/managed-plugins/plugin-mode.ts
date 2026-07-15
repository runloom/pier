import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
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

export function getPierPluginMode(cwd: string = process.cwd()): PierPluginMode {
  const config = readPluginWorkspaceConfigFile(cwd);
  return resolvePierPluginMode({
    configMode: config?.mode ?? null,
    envMode: process.env[PIER_PLUGIN_MODE_ENV] ?? null,
    isDevRuntime: isDevRuntime(),
    isPackagedApp: app.isPackaged,
  });
}

export function listConfiguredWorkspaceRoots(
  cwd: string = process.cwd()
): PluginWorkspaceRootConfig[] {
  return [...(readPluginWorkspaceConfigFile(cwd)?.roots ?? [])];
}

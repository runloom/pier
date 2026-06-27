import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { app } from "electron";
import { BUILTIN_PLUGIN_SOURCES } from "../plugins/builtin-catalog.ts";
import type { PluginDiscoverySource } from "./plugin-service.ts";

type PluginDirent = Pick<Dirent, "isDirectory" | "name">;
type ReadDir = (
  path: string,
  options: { withFileTypes: true }
) => Promise<PluginDirent[]>;

export interface CreateDefaultPluginSourcesOptions {
  readDir?: ReadDir;
  userDataDir?: string;
}

function isMissingDirectoryError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

async function discoverLocalPluginSources(
  pluginsDir: string,
  readDir: ReadDir
): Promise<PluginDiscoverySource[]> {
  let entries: PluginDirent[];
  try {
    entries = await readDir(pluginsDir, { withFileTypes: true });
  } catch (error) {
    if (isMissingDirectoryError(error)) {
      return [];
    }
    throw error;
  }

  return entries
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => ({
      kind: "local" as const,
      path: join(pluginsDir, entry.name, "plugin.json"),
    }));
}

export async function createDefaultPluginSources({
  readDir = readdir,
  userDataDir = app.getPath("userData"),
}: CreateDefaultPluginSourcesOptions = {}): Promise<PluginDiscoverySource[]> {
  return [
    ...BUILTIN_PLUGIN_SOURCES,
    ...(await discoverLocalPluginSources(
      join(userDataDir, "plugins"),
      readDir
    )),
  ];
}

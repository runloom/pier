import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { MainPluginModule } from "@plugins/api/main.ts";
import { FILES_PLUGIN_LOCALES } from "@plugins/builtin/files/locales/index.ts";
import { filesMainPlugin } from "@plugins/builtin/files/main/index.ts";
import { FILES_PLUGIN_MANIFEST } from "@plugins/builtin/files/manifest.ts";
import { GIT_PLUGIN_LOCALES } from "@plugins/builtin/git/locales/index.ts";
import { gitMainPlugin } from "@plugins/builtin/git/main/index.ts";
import { GIT_PLUGIN_MANIFEST } from "@plugins/builtin/git/manifest.ts";
import { MEMORY_PLUGIN_LOCALES } from "@plugins/builtin/memory/locales/index.ts";
import { memoryMainPlugin } from "@plugins/builtin/memory/main/index.ts";
import { MEMORY_PLUGIN_MANIFEST } from "@plugins/builtin/memory/manifest.ts";
import type { PluginDiscoverySource } from "../services/plugin-service.ts";

export type BuiltinPluginSource = Extract<
  PluginDiscoverySource,
  { kind: "builtin" }
> & {
  baseDir: string;
  id: string;
  main: MainPluginModule;
};

type BuiltinPluginFolder = "files" | "git" | "memory";

function pluginPackageBaseDir(pluginId: BuiltinPluginFolder): string {
  const urlByPlugin = {
    files: new URL("../../plugins/builtin/files/", import.meta.url),
    git: new URL("../../plugins/builtin/git/", import.meta.url),
    memory: new URL("../../plugins/builtin/memory/", import.meta.url),
  } satisfies Record<BuiltinPluginFolder, URL>;
  const url = urlByPlugin[pluginId];
  if (url.protocol === "file:") {
    return fileURLToPath(url);
  }
  return resolve(process.cwd(), `src/plugins/builtin/${pluginId}`);
}

/**
 * Always-on product plugins only. Language modes and PATH language servers
 * are L0 (Files editor + main LSP bootstrap), not separate installable packs.
 */
export const BUILTIN_PLUGIN_SOURCES = [
  {
    baseDir: pluginPackageBaseDir("git"),
    defaultEnabled: true,
    id: GIT_PLUGIN_MANIFEST.id,
    kind: "builtin",
    locales: GIT_PLUGIN_LOCALES,
    main: gitMainPlugin,
    manifest: GIT_PLUGIN_MANIFEST,
  },
  {
    baseDir: pluginPackageBaseDir("files"),
    defaultEnabled: true,
    id: FILES_PLUGIN_MANIFEST.id,
    kind: "builtin",
    locales: FILES_PLUGIN_LOCALES,
    main: filesMainPlugin,
    manifest: FILES_PLUGIN_MANIFEST,
  },
  {
    baseDir: pluginPackageBaseDir("memory"),
    defaultEnabled: true,
    id: MEMORY_PLUGIN_MANIFEST.id,
    kind: "builtin",
    locales: MEMORY_PLUGIN_LOCALES,
    main: memoryMainPlugin,
    manifest: MEMORY_PLUGIN_MANIFEST,
  },
] satisfies readonly BuiltinPluginSource[];

export const BUILTIN_MAIN_PLUGIN_MODULES = BUILTIN_PLUGIN_SOURCES.map(
  (source) => source.main
);

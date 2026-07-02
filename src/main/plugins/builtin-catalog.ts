import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { MainPluginModule } from "@plugins/api/main.ts";
import { filesMainPlugin } from "@plugins/builtin/files/main/index.ts";
import { FILES_PLUGIN_MANIFEST } from "@plugins/builtin/files/manifest.ts";
import { GIT_PLUGIN_LOCALES } from "@plugins/builtin/git/locales/index.ts";
import { gitMainPlugin } from "@plugins/builtin/git/main/index.ts";
import { GIT_PLUGIN_MANIFEST } from "@plugins/builtin/git/manifest.ts";
import type { PluginDiscoverySource } from "../services/plugin-service.ts";

export type BuiltinPluginSource = Extract<
  PluginDiscoverySource,
  { kind: "builtin" }
> & {
  baseDir: string;
  id: string;
  main: MainPluginModule;
};

function pluginPackageBaseDir(pluginId: "files" | "git"): string {
  const urlByPlugin = {
    files: new URL("../../plugins/builtin/files/", import.meta.url),
    git: new URL("../../plugins/builtin/git/", import.meta.url),
  } satisfies Record<typeof pluginId, URL>;
  const url = urlByPlugin[pluginId];
  if (url.protocol === "file:") {
    return fileURLToPath(url);
  }
  return resolve(process.cwd(), `src/plugins/builtin/${pluginId}`);
}

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
    locales: {},
    main: filesMainPlugin,
    manifest: FILES_PLUGIN_MANIFEST,
  },
] satisfies readonly BuiltinPluginSource[];

export const BUILTIN_MAIN_PLUGIN_MODULES = BUILTIN_PLUGIN_SOURCES.map(
  (source) => source.main
) satisfies readonly MainPluginModule[];

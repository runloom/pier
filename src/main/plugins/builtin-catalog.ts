import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { MainPluginModule } from "@plugins/api/main.ts";
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

function pluginPackageBaseDir(): string {
  const url = new URL("../../plugins/builtin/git/", import.meta.url);
  if (url.protocol === "file:") {
    return fileURLToPath(url);
  }
  return resolve(process.cwd(), "src/plugins/builtin/git");
}

export const BUILTIN_PLUGIN_SOURCES = [
  {
    baseDir: pluginPackageBaseDir(),
    defaultEnabled: true,
    id: GIT_PLUGIN_MANIFEST.id,
    kind: "builtin",
    locales: GIT_PLUGIN_LOCALES,
    main: gitMainPlugin,
    manifest: GIT_PLUGIN_MANIFEST,
  },
] satisfies readonly BuiltinPluginSource[];

export const BUILTIN_MAIN_PLUGIN_MODULES = BUILTIN_PLUGIN_SOURCES.map(
  (source) => source.main
) satisfies readonly MainPluginModule[];

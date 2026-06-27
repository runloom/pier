import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { MainPluginModule } from "@plugins/api/main.ts";
import { WORKTREE_PLUGIN_LOCALES } from "@plugins/builtin/worktree/locales/index.ts";
import { worktreeMainPlugin } from "@plugins/builtin/worktree/main/index.ts";
import { WORKTREE_PLUGIN_MANIFEST } from "@plugins/builtin/worktree/manifest.ts";
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
  const url = new URL("../../plugins/builtin/worktree/", import.meta.url);
  if (url.protocol === "file:") {
    return fileURLToPath(url);
  }
  return resolve(process.cwd(), "src/plugins/builtin/worktree");
}

export const BUILTIN_PLUGIN_SOURCES = [
  {
    baseDir: pluginPackageBaseDir(),
    defaultEnabled: true,
    id: WORKTREE_PLUGIN_MANIFEST.id,
    kind: "builtin",
    locales: WORKTREE_PLUGIN_LOCALES,
    main: worktreeMainPlugin,
    manifest: WORKTREE_PLUGIN_MANIFEST,
  },
] satisfies readonly BuiltinPluginSource[];

export const BUILTIN_MAIN_PLUGIN_MODULES = BUILTIN_PLUGIN_SOURCES.map(
  (source) => source.main
) satisfies readonly MainPluginModule[];

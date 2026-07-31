import type { ExternalRendererPluginModule } from "@pier/plugin-api/renderer";

export interface LoadExternalRendererModuleOptions {
  expectedPluginId: string;
  rendererEntryUrl: string;
}

export type ExternalRendererModuleImporter = (url: string) => Promise<unknown>;

function dynamicImportExternalRenderer(url: string): Promise<unknown> {
  return import(/* @vite-ignore */ url);
}

/**
 * 只负责加载并校验 renderer 模块。激活、超时、代次和销毁全部归 runtime；
 * 动态 import 无法真正取消，因此 loader 绝不能产生注册副作用。
 */
export function createExternalRendererModuleLoader(
  importModule: ExternalRendererModuleImporter = dynamicImportExternalRenderer
) {
  return async function loadExternalRendererModuleWithImporter(
    options: LoadExternalRendererModuleOptions
  ): Promise<ExternalRendererPluginModule> {
    const mod = await importModule(options.rendererEntryUrl);
    if (!mod || typeof mod !== "object" || !("plugin" in mod)) {
      throw new Error("renderer module missing `plugin` export");
    }
    const pluginExport: unknown = mod.plugin;
    if (
      !pluginExport ||
      typeof pluginExport !== "object" ||
      !("id" in pluginExport) ||
      !("activate" in pluginExport) ||
      typeof pluginExport.id !== "string" ||
      typeof pluginExport.activate !== "function"
    ) {
      throw new Error("renderer plugin export invalid");
    }
    if (pluginExport.id !== options.expectedPluginId) {
      throw new Error(
        `renderer plugin id mismatch: expected ${options.expectedPluginId}, got ${pluginExport.id}`
      );
    }
    return pluginExport as ExternalRendererPluginModule;
  };
}

export const loadExternalRendererModule = createExternalRendererModuleLoader();

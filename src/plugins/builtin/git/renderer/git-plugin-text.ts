import type { RendererPluginContext } from "@plugins/api/renderer.ts";

/** 走插件 i18n 拿 `ui.*` 命名空间下的翻译。key 未定义时返回 fallback。 */
export function pluginText(
  context: RendererPluginContext,
  key: string,
  fallback: string,
  values?: Record<string, number | string>
): string {
  return context.i18n.t(`ui.${key}`, values, fallback);
}

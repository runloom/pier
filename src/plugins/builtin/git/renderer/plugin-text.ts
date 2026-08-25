import type { RendererPluginContext } from "@plugins/api/renderer.ts";

/** 走插件 i18n 拿 `ui.*` 命名空间下的翻译。key 未定义时返回 fallback。 */
export function pluginText(
  context: RendererPluginContext,
  key: string,
  fallback: string,
  values?: Record<string, number | string>,
  locale?: string
): string {
  return context.i18n.t(`ui.${key}`, values, fallback, locale);
}

/**
 * Shared factory for git review file/dir collision labels.
 * Tree, CodeView, demand, and comment nav must use the same function so
 * displayPath natural sort stays aligned under every locale.
 */
export function createReviewCollidingFileLabel(
  context: RendererPluginContext,
  language?: string
): (name: string) => string {
  return (name: string) =>
    pluginText(
      context,
      "reviewFilePathCollision",
      "File change · {{name}}",
      language === undefined ? { name } : { language, name },
      language
    );
}

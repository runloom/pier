import type { RendererPluginContext } from "@plugins/api/renderer.ts";

export type FilesTranslate = (key: string, fallback?: string) => string;

export function createFilesTranslate(
  context: Pick<RendererPluginContext, "i18n"> | undefined
): FilesTranslate {
  return (key, fallback) =>
    context?.i18n.t(key, undefined, fallback) ?? fallback ?? key;
}

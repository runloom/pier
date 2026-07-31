import type {
  RendererPluginContext,
  RendererPluginMessageValues,
} from "@plugins/api/renderer.ts";

export type FilesTranslate = (
  key: string,
  fallback?: string,
  values?: RendererPluginMessageValues
) => string;

export function createFilesTranslate(
  context: Pick<RendererPluginContext, "i18n"> | undefined
): FilesTranslate {
  return (key, fallback, values) =>
    context?.i18n.t(key, values, fallback) ?? fallback ?? key;
}

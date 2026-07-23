import type {
  RendererPluginAction,
  RendererPluginActionInvocation,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import {
  FILES_MARKDOWN_MEASURE_COMFORTABLE_COMMAND_ID,
  FILES_MARKDOWN_MEASURE_WIDE_COMMAND_ID,
} from "../manifest.ts";
import { createFilesTranslate, type FilesTranslate } from "./files-i18n.ts";
import {
  FILES_MARKDOWN_PREVIEW_SURFACE,
  readMarkdownMeasureMode,
  writeMarkdownMeasureMode,
} from "./markdown-preview-preferences.ts";

function previewAction(action: {
  group: string;
  handler: RendererPluginAction["handler"];
  id: string;
  menuHidden?: (invocation?: RendererPluginActionInvocation) => boolean;
  sortOrder: number;
  title: () => string;
}): RendererPluginAction {
  return {
    category: "file",
    handler: action.handler,
    id: action.id,
    metadata: {
      group: action.group,
      sortOrder: action.sortOrder,
      ...(action.menuHidden ? { menuHidden: action.menuHidden } : {}),
    },
    surfaces: [FILES_MARKDOWN_PREVIEW_SURFACE],
    title: action.title,
  };
}

export function createFilesMarkdownPreviewActions(
  context: RendererPluginContext
): RendererPluginAction[] {
  const t: FilesTranslate = createFilesTranslate(context);

  return [
    previewAction({
      group: "1_reading",
      id: FILES_MARKDOWN_MEASURE_COMFORTABLE_COMMAND_ID,
      sortOrder: 1,
      title: () =>
        t("filePanel.markdown.measure.comfortable", "Comfortable reading"),
      menuHidden: () => readMarkdownMeasureMode() === "comfortable",
      handler: () => {
        writeMarkdownMeasureMode("comfortable");
      },
    }),
    previewAction({
      group: "1_reading",
      id: FILES_MARKDOWN_MEASURE_WIDE_COMMAND_ID,
      sortOrder: 2,
      title: () => t("filePanel.markdown.measure.wide", "Wide reading"),
      menuHidden: () => readMarkdownMeasureMode() === "wide",
      handler: () => {
        writeMarkdownMeasureMode("wide");
      },
    }),
  ];
}

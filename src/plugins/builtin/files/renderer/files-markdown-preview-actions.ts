import type {
  RendererPluginAction,
  RendererPluginActionInvocation,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import {
  FILES_MARKDOWN_APPEARANCE_AUTO_COMMAND_ID,
  FILES_MARKDOWN_APPEARANCE_DARK_COMMAND_ID,
  FILES_MARKDOWN_APPEARANCE_LIGHT_COMMAND_ID,
  FILES_MARKDOWN_MEASURE_COMFORTABLE_COMMAND_ID,
  FILES_MARKDOWN_MEASURE_WIDE_COMMAND_ID,
} from "../manifest.ts";
import { createFilesTranslate, type FilesTranslate } from "./files-i18n.ts";
import {
  FILES_MARKDOWN_PREVIEW_SURFACE,
  type MarkdownReadingAppearance,
  readMarkdownMeasureMode,
  readMarkdownReadingAppearance,
  writeMarkdownMeasureMode,
  writeMarkdownReadingAppearance,
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

function appearanceAction(options: {
  appearance: MarkdownReadingAppearance;
  id: string;
  sortOrder: number;
  t: FilesTranslate;
  titleKey: string;
  titleFallback: string;
}): RendererPluginAction {
  return previewAction({
    group: "2_appearance",
    id: options.id,
    sortOrder: options.sortOrder,
    title: () => options.t(options.titleKey, options.titleFallback),
    menuHidden: () => readMarkdownReadingAppearance() === options.appearance,
    handler: () => {
      writeMarkdownReadingAppearance(options.appearance);
    },
  });
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
    appearanceAction({
      appearance: "auto",
      id: FILES_MARKDOWN_APPEARANCE_AUTO_COMMAND_ID,
      sortOrder: 1,
      t,
      titleKey: "filePanel.markdown.appearance.auto",
      titleFallback: "Match app appearance",
    }),
    appearanceAction({
      appearance: "light",
      id: FILES_MARKDOWN_APPEARANCE_LIGHT_COMMAND_ID,
      sortOrder: 2,
      t,
      titleKey: "filePanel.markdown.appearance.light",
      titleFallback: "Light reading",
    }),
    appearanceAction({
      appearance: "dark",
      id: FILES_MARKDOWN_APPEARANCE_DARK_COMMAND_ID,
      sortOrder: 3,
      t,
      titleKey: "filePanel.markdown.appearance.dark",
      titleFallback: "Dark reading",
    }),
  ];
}

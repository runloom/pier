import type {
  RendererPluginAction,
  RendererPluginActionInvocation,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import {
  FILES_MARKDOWN_APPEARANCE_AUTO_COMMAND_ID,
  FILES_MARKDOWN_APPEARANCE_DARK_COMMAND_ID,
  FILES_MARKDOWN_APPEARANCE_LIGHT_COMMAND_ID,
  FILES_MARKDOWN_JUMP_TO_SOURCE_COMMAND_ID,
  FILES_MARKDOWN_MEASURE_COMFORTABLE_COMMAND_ID,
  FILES_MARKDOWN_MEASURE_WIDE_COMMAND_ID,
} from "../../manifest.ts";
import { createFilesTranslate, type FilesTranslate } from "../i18n.ts";
import { FILES_CANVAS_PREVIEW_SURFACE } from "../preview/canvas-preview-surface.ts";
import {
  FILES_MARKDOWN_PREVIEW_SURFACE,
  type MarkdownReadingAppearance,
  readMarkdownMeasureMode,
  readMarkdownReadingAppearance,
  writeMarkdownMeasureMode,
  writeMarkdownReadingAppearance,
} from "./preview-preferences.ts";

function previewAction(action: {
  group: string;
  handler: RendererPluginAction["handler"];
  id: string;
  menuHidden?: (invocation?: RendererPluginActionInvocation) => boolean;
  sortOrder: number;
  surfaces?: readonly string[];
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
    surfaces: [...(action.surfaces ?? [FILES_MARKDOWN_PREVIEW_SURFACE])],
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

/** 面板控制器切面（结构型，避免 markdown/ 反向依赖 editor/ 的完整控制器）。 */
export interface MarkdownPreviewJumpController {
  revealOffset(
    editorSessionId: string,
    offset: number,
    documentId?: string
  ): void;
  setPanelMode(panelId: string, mode: "source"): void;
}

/** 右键菜单「跳转到源码」的目标载荷（popup metadata 契约）。 */
function jumpTarget(invocation?: RendererPluginActionInvocation): {
  documentId: string | undefined;
  editorSessionId: string;
  panelId: string;
  sourceOffset: number;
} | null {
  const metadata = invocation?.metadata;
  const panelId = invocation?.sourcePanelId;
  const sourceOffset = metadata?.sourceOffset;
  const editorSessionId = metadata?.editorSessionId;
  if (
    !panelId ||
    typeof sourceOffset !== "number" ||
    !Number.isFinite(sourceOffset) ||
    sourceOffset < 0 ||
    typeof editorSessionId !== "string" ||
    editorSessionId.length === 0
  ) {
    return null;
  }
  const documentId = metadata?.documentId;
  return {
    documentId: typeof documentId === "string" ? documentId : undefined,
    editorSessionId,
    panelId,
    sourceOffset,
  };
}

export function createFilesMarkdownPreviewActions(
  context: RendererPluginContext,
  controller: MarkdownPreviewJumpController
): RendererPluginAction[] {
  const t: FilesTranslate = createFilesTranslate(context);

  return [
    previewAction({
      // 字典序分段：排在 0_edit（复制/全选）之后、1_reading 偏好之前。
      group: "0_jump",
      id: FILES_MARKDOWN_JUMP_TO_SOURCE_COMMAND_ID,
      sortOrder: 1,
      title: () => t("filePanel.markdown.jumpToSource", "Jump to source"),
      menuHidden: (invocation) => jumpTarget(invocation) === null,
      handler: (invocation) => {
        const target = jumpTarget(invocation);
        if (!target) return;
        controller.setPanelMode(target.panelId, "source");
        controller.revealOffset(
          target.editorSessionId,
          target.sourceOffset,
          target.documentId
        );
      },
    }),
    previewAction({
      group: "1_reading",
      id: FILES_MARKDOWN_MEASURE_COMFORTABLE_COMMAND_ID,
      sortOrder: 1,
      surfaces: [FILES_MARKDOWN_PREVIEW_SURFACE, FILES_CANVAS_PREVIEW_SURFACE],
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
      surfaces: [FILES_MARKDOWN_PREVIEW_SURFACE, FILES_CANVAS_PREVIEW_SURFACE],
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

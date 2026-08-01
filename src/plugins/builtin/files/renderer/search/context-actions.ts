import type {
  RendererPluginAction,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import type { FileContentQueryItem } from "@shared/contracts/file/query.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { z } from "zod";
import {
  FILES_SEARCH_COPY_MATCH_COMMAND_ID,
  FILES_SEARCH_COPY_PATH_COMMAND_ID,
  FILES_SEARCH_COPY_RELATIVE_PATH_COMMAND_ID,
  FILES_SEARCH_OPEN_HIT_COMMAND_ID,
  FILES_SEARCH_PANEL_ID,
  FILES_SEARCH_REVEAL_COMMAND_ID,
} from "../../manifest.ts";
import type { FileEditorController } from "../editor/controller.ts";
import { createFilesTranslate } from "../i18n.ts";
import {
  joinAbsolutePath,
  pluginAction,
  relativeToProjectRoot,
  writeClipboardText,
} from "../tree/action-utils.ts";
import { openContentSearchHit } from "./open.ts";

export const FILES_SEARCH_RESULT_SURFACE = "files/search-result";

const searchHitMetadataSchema = z.object({
  line: z.number().int().positive(),
  matchByteEnd: z.number().int().min(0),
  matchByteStart: z.number().int().min(0),
  matchCharEnd: z.number().int().min(0),
  matchCharStart: z.number().int().min(0),
  path: z.string().min(1),
  preview: z.string(),
  previewMatchEnd: z.number().int().min(0),
  previewMatchStart: z.number().int().min(0),
  projectRoot: z.string().min(1).optional(),
  root: z.string().min(1),
});

function parseSearchHit(
  invocation: { metadata?: unknown } | undefined
): (FileContentQueryItem & { root: string; projectRoot?: string }) | null {
  const parsed = searchHitMetadataSchema.safeParse(invocation?.metadata);
  if (!parsed.success) {
    return null;
  }
  const data = parsed.data;
  return {
    line: data.line,
    matchByteEnd: data.matchByteEnd,
    matchByteStart: data.matchByteStart,
    matchCharEnd: data.matchCharEnd,
    matchCharStart: data.matchCharStart,
    path: data.path,
    preview: data.preview,
    previewMatchEnd: data.previewMatchEnd,
    previewMatchStart: data.previewMatchStart,
    root: data.root,
    ...(data.projectRoot ? { projectRoot: data.projectRoot } : {}),
  };
}

export function createFilesSearchResultActions(
  context: RendererPluginContext,
  controller: FileEditorController
): RendererPluginAction[] {
  const t = createFilesTranslate(context);
  return [
    pluginAction({
      id: FILES_SEARCH_OPEN_HIT_COMMAND_ID,
      category: "file",
      metadata: { group: "1_open", sortOrder: 1 },
      surfaces: [FILES_SEARCH_RESULT_SURFACE],
      title: () => t("filePanel.contentSearch.action.open", "Open"),
      handler: (invocation) => {
        const hit = parseSearchHit(invocation);
        if (!hit) {
          return;
        }
        const panelContext =
          invocation?.sourcePanelContext ?? context.panels.getActiveContext();
        openContentSearchHit({
          context,
          controller,
          hit,
          panelContext,
          root: hit.root,
          ...(invocation?.sourcePanelGroupId
            ? { targetGroupId: invocation.sourcePanelGroupId }
            : {}),
        });
      },
    }),
    pluginAction({
      id: FILES_SEARCH_COPY_PATH_COMMAND_ID,
      category: "file",
      metadata: { group: "6_path", sortOrder: 1 },
      surfaces: [FILES_SEARCH_RESULT_SURFACE],
      title: () => t("filePanel.tree.action.copyPath", "Copy Path"),
      handler: async (invocation) => {
        const hit = parseSearchHit(invocation);
        if (!hit) {
          return;
        }
        try {
          await writeClipboardText(joinAbsolutePath(hit.root, hit.path));
          context.notifications.success(
            t("filePanel.tree.pathCopied", "Path copied")
          );
        } catch (error) {
          await context.dialogs.alert({
            body: error instanceof Error ? error.message : String(error),
            title: t("filePanel.tree.copyFailed", "Copy failed"),
          });
        }
      },
    }),
    pluginAction({
      id: FILES_SEARCH_COPY_RELATIVE_PATH_COMMAND_ID,
      category: "file",
      metadata: { group: "6_path", sortOrder: 2 },
      surfaces: [FILES_SEARCH_RESULT_SURFACE],
      title: () =>
        t("filePanel.tree.action.copyRelativePath", "Copy Relative Path"),
      handler: async (invocation) => {
        const hit = parseSearchHit(invocation);
        if (!hit) {
          return;
        }
        try {
          await writeClipboardText(
            relativeToProjectRoot(hit.root, hit.path, hit.projectRoot)
          );
          context.notifications.success(
            t("filePanel.tree.pathCopied", "Path copied")
          );
        } catch (error) {
          await context.dialogs.alert({
            body: error instanceof Error ? error.message : String(error),
            title: t("filePanel.tree.copyFailed", "Copy failed"),
          });
        }
      },
    }),
    pluginAction({
      id: FILES_SEARCH_COPY_MATCH_COMMAND_ID,
      category: "file",
      metadata: { group: "6_path", sortOrder: 3 },
      surfaces: [FILES_SEARCH_RESULT_SURFACE],
      title: () =>
        t("filePanel.contentSearch.action.copyMatch", "Copy Match Line"),
      handler: async (invocation) => {
        const hit = parseSearchHit(invocation);
        if (!hit) {
          return;
        }
        try {
          await writeClipboardText(hit.preview);
          context.notifications.success(
            t("filePanel.contentSearch.matchCopied", "Match line copied")
          );
        } catch (error) {
          await context.dialogs.alert({
            body: error instanceof Error ? error.message : String(error),
            title: t("filePanel.tree.copyFailed", "Copy failed"),
          });
        }
      },
    }),
    pluginAction({
      id: FILES_SEARCH_REVEAL_COMMAND_ID,
      category: "file",
      metadata: { group: "6_path", sortOrder: 4 },
      surfaces: [FILES_SEARCH_RESULT_SURFACE],
      title: () => t("filePanel.tree.action.reveal", "Reveal in Finder"),
      handler: async (invocation) => {
        const hit = parseSearchHit(invocation);
        if (!hit) {
          return;
        }
        try {
          await context.files.reveal({ path: hit.path, root: hit.root });
        } catch (error) {
          await context.dialogs.alert({
            body: error instanceof Error ? error.message : String(error),
            title: t("filePanel.tree.revealFailed", "Unable to reveal item"),
          });
        }
      },
    }),
  ];
}

export function popupSearchResultContextMenu(
  context: RendererPluginContext,
  input: {
    hit: FileContentQueryItem;
    panelContext?: PanelContext | null;
    point: { x: number; y: number };
    projectRoot?: string;
    root: string;
    sourcePanelGroupId?: string;
    sourcePanelId?: string;
  }
): Promise<void> {
  return context.contextMenu.popup(FILES_SEARCH_RESULT_SURFACE, input.point, {
    metadata: {
      line: input.hit.line,
      matchByteEnd: input.hit.matchByteEnd,
      matchByteStart: input.hit.matchByteStart,
      matchCharEnd: input.hit.matchCharEnd,
      matchCharStart: input.hit.matchCharStart,
      path: input.hit.path,
      preview: input.hit.preview,
      previewMatchEnd: input.hit.previewMatchEnd,
      previewMatchStart: input.hit.previewMatchStart,
      root: input.root,
      ...(input.projectRoot ? { projectRoot: input.projectRoot } : {}),
    },
    sourcePanelComponent: FILES_SEARCH_PANEL_ID,
    ...(input.panelContext ? { sourcePanelContext: input.panelContext } : {}),
    ...(input.sourcePanelGroupId
      ? { sourcePanelGroupId: input.sourcePanelGroupId }
      : {}),
    ...(input.sourcePanelId ? { sourcePanelId: input.sourcePanelId } : {}),
  });
}

import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { FileEntry } from "@shared/contracts/file.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { useCallback } from "react";
import { FILES_FILE_PANEL_ID } from "../../manifest.ts";
import type { FilesDocumentPanelSource } from "../document/types.ts";
import {
  parseFilesDocumentPanelSource,
  sameFilesDocumentPanelSource,
} from "../document/types.ts";
import { createFileFilePanelInstanceId } from "./id.ts";
import { sourceTitle } from "./source.ts";

export function useFilesGroupNav({
  context,
  groupId,
  panelContext,
}: {
  context: RendererPluginContext;
  groupId: string;
  panelContext: PanelContext | undefined;
}): {
  handleOpenFileFromTree: (
    entry: FileEntry,
    options?: { pinned?: boolean }
  ) => void;
} {
  const openSourceInGroup = useCallback(
    (source: FilesDocumentPanelSource, options: { pinned: boolean }) => {
      const existingInstance = context.panels
        .listInstances(FILES_FILE_PANEL_ID)
        .find(
          (instance) =>
            instance.groupId === groupId &&
            sameFilesDocumentPanelSource(
              parseFilesDocumentPanelSource(instance.params),
              source
            )
        );
      const existingSource = parseFilesDocumentPanelSource(
        existingInstance?.params
      );
      const existingParams = existingInstance?.params
        ? { ...existingInstance.params }
        : null;
      const params = existingParams
        ? {
            ...existingParams,
            ...(options.pinned ? { pinned: true } : {}),
          }
        : {
            pinned: options.pinned,
            source,
          };

      context.panels.openInstance({
        componentId: FILES_FILE_PANEL_ID,
        ...(!existingInstance && panelContext ? { context: panelContext } : {}),
        dropUnpinnedInstances: existingInstance ? false : !options.pinned,
        instanceId:
          existingInstance?.id ?? createFileFilePanelInstanceId(source),
        params,
        targetGroupId: groupId,
        title: sourceTitle(existingSource ?? source),
      });
    },
    [context, groupId, panelContext]
  );

  const handleOpenFileFromTree = useCallback(
    (entry: FileEntry, options?: { pinned?: boolean }) => {
      const nextSource: FilesDocumentPanelSource = {
        kind: "disk",
        path: entry.path,
        root: entry.root,
      };
      const pinned = options?.pinned === true;
      openSourceInGroup(nextSource, { pinned });
    },
    [openSourceInGroup]
  );

  return {
    handleOpenFileFromTree,
  };
}

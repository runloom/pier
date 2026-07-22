import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { FileEntry } from "@shared/contracts/file.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { FILES_FILE_PANEL_ID } from "../manifest.ts";
import { createFileFilePanelInstanceId } from "./file-panel-id.ts";
import { sourceTitle } from "./file-panel-source.ts";
import type { FilesDocumentPanelSource } from "./files-document-types.ts";
import {
  parseFilesDocumentPanelSource,
  sameFilesDocumentPanelSource,
} from "./files-document-types.ts";
import {
  filesNavBack,
  filesNavForward,
  getFilesNavState,
  pushFilesNavEntry,
  subscribeFilesNavHistory,
} from "./files-nav-history.ts";

export function useFilesGroupNav({
  context,
  groupId,
  panelContext,
  selectedSource,
}: {
  context: RendererPluginContext;
  groupId: string;
  panelContext: PanelContext | undefined;
  selectedSource: FilesDocumentPanelSource | null;
}): {
  canBack: boolean;
  canForward: boolean;
  handleNavBack: () => void;
  handleNavForward: () => void;
  handleOpenFileFromTree: (
    entry: FileEntry,
    options?: { pinned?: boolean }
  ) => void;
  openSourceInGroup: (
    source: FilesDocumentPanelSource,
    options: { pinned: boolean }
  ) => void;
} {
  const navSubscribe = useCallback(
    (listener: () => void) => subscribeFilesNavHistory(groupId, listener),
    [groupId]
  );
  const navSnapshot = useCallback(
    () => JSON.stringify(getFilesNavState(groupId)),
    [groupId]
  );
  useSyncExternalStore(navSubscribe, navSnapshot, navSnapshot);
  const { canBack, canForward } = getFilesNavState(groupId);

  useEffect(() => {
    if (selectedSource) {
      pushFilesNavEntry(groupId, selectedSource);
    }
  }, [groupId, selectedSource]);

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

  const openNavSource = useCallback(
    (source: FilesDocumentPanelSource | null) => {
      if (!source) {
        return;
      }
      openSourceInGroup(source, { pinned: false });
    },
    [openSourceInGroup]
  );

  const handleNavBack = useCallback(() => {
    openNavSource(filesNavBack(groupId));
  }, [groupId, openNavSource]);
  const handleNavForward = useCallback(() => {
    openNavSource(filesNavForward(groupId));
  }, [groupId, openNavSource]);

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
    canBack,
    canForward,
    handleNavBack,
    handleNavForward,
    handleOpenFileFromTree,
    openSourceInGroup,
  };
}

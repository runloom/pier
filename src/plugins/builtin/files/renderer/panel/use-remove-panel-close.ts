import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { useEffect } from "react";
import { FILES_FILE_PANEL_ID } from "../../manifest.ts";
import type { FilesDocumentPanelSource } from "../document/types.ts";
import type { FileEditorController } from "../editor/controller.ts";
import { noteFilesHangBreadcrumb } from "../hang-breadcrumb.ts";
import { hasOtherOpenFilesSourceInstance } from "./instance-utils.ts";

/**
 * dockview onDidRemovePanel → controller.closePanel + hang trail.
 * Split from panel/index.tsx (file-size cap).
 */
export function useFilesPanelRemoveClose(args: {
  containerApi:
    | {
        onDidRemovePanel?: (listener: (panel: { id?: string }) => void) => {
          dispose?: () => void;
        };
      }
    | undefined;
  controller: FileEditorController;
  panelId: string | undefined;
  runtimeContext: RendererPluginContext | undefined;
  stableSource: FilesDocumentPanelSource | null;
}): void {
  const { containerApi, controller, panelId, runtimeContext, stableSource } =
    args;

  useEffect(() => {
    if (!(panelId && containerApi?.onDidRemovePanel)) {
      return;
    }
    const disposable = containerApi.onDidRemovePanel((panel) => {
      if (panel?.id === panelId && stableSource) {
        const path =
          stableSource.kind === "disk" ? stableSource.path : stableSource.name;
        noteFilesHangBreadcrumb({
          kind: "files-doc",
          phase: "start",
          detail: "onDidRemovePanel",
          panelId,
          path,
          activePanelComponent: FILES_FILE_PANEL_ID,
        });
        controller.closePanel({
          hasOtherOpenInstance: hasOtherOpenFilesSourceInstance({
            context: runtimeContext,
            panelId,
            source: stableSource,
          }),
          panelId,
          source: stableSource,
        });
        noteFilesHangBreadcrumb({
          kind: "files-doc",
          phase: "end",
          detail: "closePanel-done",
          panelId,
          path,
        });
      }
    });
    return () => {
      disposable?.dispose?.();
    };
  }, [containerApi, controller, panelId, runtimeContext, stableSource]);
}

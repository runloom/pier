import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { PierDockviewGroupHandle } from "@shared/contracts/dockview.ts";
import { useLayoutEffect } from "react";
import type { FileEditorController } from "./file-editor-controller.ts";
import {
  claimFilesGroupView,
  releaseFilesGroupView,
} from "./files-group-view-host.tsx";
import type { FilesWatchHub } from "./files-watch-hub.ts";

export function useFilesGroupViewClaim({
  controller,
  group,
  ownerId,
  panelApiId,
  prefersSharedGroupView,
  runtimeContext,
  runtimeWatchHub,
}: {
  controller: FileEditorController;
  group: PierDockviewGroupHandle | null | undefined;
  ownerId: string | undefined;
  panelApiId: string | undefined;
  prefersSharedGroupView: boolean;
  runtimeContext: RendererPluginContext | undefined;
  runtimeWatchHub: FilesWatchHub;
}): void {
  useLayoutEffect(() => {
    if (
      !(
        prefersSharedGroupView &&
        group &&
        panelApiId &&
        ownerId &&
        runtimeContext
      )
    ) {
      return;
    }
    const groupId = group.id;
    let cancelled = false;
    let retryHandle: number | null = null;
    let attempts = 0;
    const tryClaim = () => {
      if (cancelled) {
        return;
      }
      const claimed = claimFilesGroupView({
        context: runtimeContext,
        controller,
        group,
        ownerId,
        watchHub: runtimeWatchHub,
      });
      if (claimed || attempts >= 10) {
        if (!claimed) {
          console.error(
            "[files] group view claim failed after retries:",
            groupId
          );
        }
        return;
      }
      attempts += 1;
      retryHandle = requestAnimationFrame(tryClaim);
    };
    tryClaim();
    return () => {
      cancelled = true;
      if (retryHandle !== null) {
        cancelAnimationFrame(retryHandle);
      }
      releaseFilesGroupView({ context: runtimeContext, groupId, ownerId });
    };
  }, [
    controller,
    group,
    ownerId,
    panelApiId,
    prefersSharedGroupView,
    runtimeContext,
    runtimeWatchHub,
  ]);
}

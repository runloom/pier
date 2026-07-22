import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { PierDockviewGroupHandle } from "@shared/contracts/dockview.ts";
import { useCallback, useEffect, useMemo } from "react";
import { FILES_FILE_PANEL_ID } from "../manifest.ts";
import type { FileEditorController } from "./file-editor-controller.ts";
import { createFileFilePanelInstanceId } from "./file-panel-id.ts";
import type { FilePanelRuntimeProps } from "./file-panel-types.ts";
import {
  type FileSaveAsResult,
  recoverDocumentSaveAs,
  saveDocumentAs,
} from "./file-save-as-state-machine.ts";
import type { FileSaveFeedback } from "./file-save-feedback.ts";
import type { FilesDocumentPanelSource } from "./files-document-types.ts";
import { createFilesTranslate } from "./files-i18n.ts";
import { replaceFilesNavSource } from "./files-nav-history.ts";
import { hasOtherOpenFilesSourceInstance } from "./files-panel-instance-utils.ts";

export function useFilePanelSaveAs(input: {
  controller: FileEditorController;
  group: PierDockviewGroupHandle | null;
  props: Pick<FilePanelRuntimeProps, "api" | "params">;
  runtimeContext: RendererPluginContext | undefined;
  stableSource: FilesDocumentPanelSource | null;
}): void {
  const { controller, group, props, runtimeContext, stableSource } = input;
  const t = useMemo(
    () => createFilesTranslate(runtimeContext),
    [runtimeContext]
  );
  const commitBinding = useCallback(
    async (saved: Extract<FileSaveAsResult, { kind: "saved" }>) => {
      const panelId = props.api?.id;
      if (!(stableSource && panelId && runtimeContext)) {
        throw new Error("Save As panel binding is no longer available");
      }
      const sourceDocumentId = controller.documentId(stableSource);
      controller.recordPanelSaveAsDocument(panelId, saved.documentId);
      if (
        stableSource.kind === saved.source.kind &&
        stableSource.root === saved.source.root &&
        stableSource.path === saved.source.path
      ) {
        return;
      }
      if (group?.id) {
        replaceFilesNavSource(group.id, stableSource, saved.source);
      }
      const hasOtherSourcePanel = hasOtherOpenFilesSourceInstance({
        context: runtimeContext,
        panelId,
        source: stableSource,
      });
      runtimeContext.panels.openInstance({
        componentId: FILES_FILE_PANEL_ID,
        context: saved.target.context,
        instanceId: createFileFilePanelInstanceId(saved.source),
        params: { pinned: true, source: saved.source },
        ...(group?.id ? { targetGroupId: group.id } : {}),
        title:
          saved.source.path.split("/").filter(Boolean).at(-1) ??
          saved.source.path,
      });
      props.api.close();
      await runtimeContext.panels.flushLayout();
      if (!hasOtherSourcePanel) {
        controller.discardDocument(sourceDocumentId);
      }
    },
    [controller, group?.id, props.api, runtimeContext, stableSource]
  );

  const saveAs = useCallback(
    async (feedback: FileSaveFeedback) => {
      const panelId = props.api?.id;
      const panelContext = props.params?.context;
      if (!(stableSource && panelId && panelContext && runtimeContext)) {
        return "noop" as const;
      }
      const result = await saveDocumentAs({
        context: runtimeContext,
        documentId: controller.documentId(stableSource),
        initiator: {
          ...(group?.id ? { groupId: group.id } : {}),
          panelId,
        },
        feedback,
        onCommitted: commitBinding,
        panelContext,
      });
      if (result.kind !== "saved") {
        return result.kind === "failed"
          ? ("failed" as const)
          : ("cancelled" as const);
      }
      return "saved" as const;
    },
    [
      controller,
      commitBinding,
      group?.id,
      props.api?.id,
      props.params?.context,
      runtimeContext,
      stableSource,
    ]
  );

  useEffect(() => {
    if (!(stableSource && runtimeContext)) {
      return;
    }
    const documentId = controller.documentId(stableSource);
    let cancelled = false;
    controller
      .initialize()
      .then(async () => {
        await recoverDocumentSaveAs({
          context: runtimeContext,
          documentId,
          ...(props.api?.id ? { panelId: props.api.id } : {}),
          onCommitted: async (saved) => {
            if (cancelled) {
              throw new Error("Save As recovery panel was closed");
            }
            await commitBinding(saved);
          },
        });
      })
      .catch(async (error: unknown) => {
        if (!cancelled) {
          console.error("[files] Save As recovery failed:", error);
          await runtimeContext.dialogs.alert({
            body: error instanceof Error ? error.message : String(error),
            title: t(
              "filePanel.saveAs.recoveryFailed",
              "Unable to resume the interrupted Save As operation"
            ),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    commitBinding,
    controller,
    props.api?.id,
    runtimeContext,
    stableSource,
    t,
  ]);

  useEffect(() => {
    const panelId = props.api?.id;
    if (!(panelId && stableSource)) {
      return;
    }
    return controller.registerPanelSaveAsHandler(panelId, saveAs);
  }, [controller, props.api?.id, saveAs, stableSource]);
}

import { useCallback } from "react";
import type { FilesDocument, FileViewMode } from "../document/types.ts";
import type { FileEditorController } from "../editor/controller.ts";
import { noteFilesHangBreadcrumb } from "../hang-breadcrumb.ts";
import type { FilesTranslate } from "../i18n.ts";

interface DiskConflictDialogs {
  alert: (input: { body: string; title: string }) => Promise<unknown>;
}

/**
 * Actions for open-document disk conflict Empty / compare chrome
 * (load / keep / compare). Kept out of body.tsx for the file-size cap.
 */
export function useDiskConflictActions(input: {
  controller: FileEditorController;
  dialogs: DiskConflictDialogs | undefined;
  document: FilesDocument | null;
  mode: FileViewMode;
  onModeChange?: ((mode: FileViewMode) => void) | undefined;
  panelId: string | undefined;
  t: FilesTranslate;
}): {
  handleCompareDiskConflict: () => void;
  handleDismissDiskConflict: () => void;
  handleLoadDiskVersion: () => void;
} {
  const { controller, dialogs, document, mode, onModeChange, panelId, t } =
    input;

  const handleLoadDiskVersion = useCallback(() => {
    if (document?.source.kind !== "disk") {
      return;
    }
    const documentId = document.id;
    const language = document.language;
    const path = document.source.path;
    noteFilesHangBreadcrumb({
      kind: "files-conflict",
      phase: "start",
      detail: "load-disk",
      path,
      dirty: document.dirty,
      diskConflict: true,
      mode,
    });
    const run = async () => {
      try {
        await controller.reloadDocumentFromDisk(documentId, {
          forceAdopt: true,
        });
        noteFilesHangBreadcrumb({
          kind: "files-conflict",
          phase: "end",
          detail: "load-disk-ok",
          path,
        });
        if (mode === "diff" && onModeChange) {
          onModeChange(
            language === "markdown" || language === "canvas"
              ? "preview"
              : "source"
          );
        }
      } catch (error) {
        noteFilesHangBreadcrumb({
          kind: "files-conflict",
          phase: "end",
          detail: "load-disk-failed",
          path,
        });
        const body =
          error instanceof Error
            ? error.message
            : t(
                "filePanel.conflict.loadDiskFailed",
                "Unable to load the disk version of this file."
              );
        try {
          await dialogs?.alert({
            body,
            title: t(
              "filePanel.conflict.loadDiskFailedTitle",
              "Couldn’t load disk version"
            ),
          });
        } catch {
          // dialog failure is non-fatal
        }
      }
    };
    run().catch(() => undefined);
  }, [controller, dialogs, document, mode, onModeChange, t]);

  const handleDismissDiskConflict = useCallback(() => {
    if (!document) {
      return;
    }
    const path =
      document.source.kind === "disk" ? document.source.path : document.name;
    noteFilesHangBreadcrumb({
      kind: "files-conflict",
      phase: "start",
      detail: "keep-local",
      path,
      dirty: document.dirty,
      diskConflict: true,
      mode,
    });
    controller.dismissDocumentDiskConflict(document.id);
    if (mode === "diff" && onModeChange) {
      onModeChange("source");
    }
    noteFilesHangBreadcrumb({
      kind: "files-conflict",
      phase: "end",
      detail: "keep-local-done",
      path,
    });
  }, [controller, document, mode, onModeChange]);

  const handleCompareDiskConflict = useCallback(() => {
    noteFilesHangBreadcrumb({
      kind: "files-conflict",
      phase: "start",
      detail: "compare",
      path:
        document?.source.kind === "disk"
          ? document.source.path
          : document?.name,
      mode,
    });
    if (panelId) {
      controller.setPanelMode(panelId, "diff");
      return;
    }
    onModeChange?.("diff");
  }, [controller, document, mode, onModeChange, panelId]);

  return {
    handleCompareDiskConflict,
    handleDismissDiskConflict,
    handleLoadDiskVersion,
  };
}

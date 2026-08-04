import { useCallback } from "react";
import type { FilesDocument, FileViewMode } from "../document/types.ts";
import type { FileEditorController } from "../editor/controller.ts";
import type { FilesTranslate } from "../i18n.ts";

interface DiskConflictDialogs {
  alert: (input: { body: string; title: string }) => Promise<unknown>;
}

/**
 * Banner actions for open-document disk conflict (load / keep / compare).
 * Kept out of body.tsx so the panel shell stays under the file-size cap.
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
    const run = async () => {
      try {
        await controller.reloadDocumentFromDisk(documentId, {
          forceAdopt: true,
        });
        if (mode === "diff" && onModeChange) {
          onModeChange(
            language === "markdown" || language === "canvas"
              ? "preview"
              : "source"
          );
        }
      } catch (error) {
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
    controller.dismissDocumentDiskConflict(document.id);
    if (mode === "diff" && onModeChange) {
      onModeChange("source");
    }
  }, [controller, document, mode, onModeChange]);

  const handleCompareDiskConflict = useCallback(() => {
    if (panelId) {
      controller.setPanelMode(panelId, "diff");
      return;
    }
    onModeChange?.("diff");
  }, [controller, onModeChange, panelId]);

  return {
    handleCompareDiskConflict,
    handleDismissDiskConflict,
    handleLoadDiskVersion,
  };
}

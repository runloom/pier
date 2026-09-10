import { Button } from "@pier/ui/button.tsx";
import { type ReactElement, type ReactNode, useCallback } from "react";
import type { FilesDocument } from "../../document/types.ts";
import type { FileEditorController } from "../../editor/controller.ts";
import type { FilesTranslate } from "../../i18n.ts";
import { FilesMutationSuspendedError } from "../../mutation/gate.ts";

export function fileDocumentCanRestoreBySave(document: FilesDocument): boolean {
  return (
    document.deletedOnDisk &&
    document.source.kind === "disk" &&
    document.capabilities.includes("save") &&
    !document.readOnly
  );
}

function FileDeletedOnDiskBar({
  controller,
  document,
  panelId,
  t,
}: {
  controller: FileEditorController;
  document: FilesDocument;
  panelId: string | undefined;
  t: FilesTranslate;
}): ReactElement | null {
  const handleSave = useCallback(async () => {
    try {
      await controller.runMutation(() =>
        controller.settleDocument(document.id, panelId, "failure")
      );
    } catch (error) {
      if (!(error instanceof FilesMutationSuspendedError)) {
        throw error;
      }
    }
  }, [controller, document.id, panelId]);

  if (!(document.deletedOnDisk && document.source.kind === "disk")) {
    return null;
  }

  const canSave = fileDocumentCanRestoreBySave(document);
  return (
    <div
      className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-4 py-3"
      data-slot="file-deleted-on-disk-chrome"
      data-testid="file-deleted-on-disk-chrome"
    >
      <div className="min-w-0 text-left">
        <p className="font-medium text-sm">
          {t("filePanel.deleted.bannerTitle", "This file was deleted")}
        </p>
        <p className="text-muted-foreground text-xs">
          {t(
            "filePanel.deleted.bannerBody",
            "Save to restore it in the original location."
          )}
        </p>
      </div>
      {canSave ? (
        <Button onClick={handleSave} type="button" variant="default">
          {t("filePanel.deleted.saveToRestore", "Save to Restore")}
        </Button>
      ) : null}
    </div>
  );
}

export function FileDeletedOnDiskChrome({
  children,
  controller,
  document,
  panelId,
  t,
}: {
  children: ReactNode;
  controller: FileEditorController;
  document: FilesDocument;
  panelId: string | undefined;
  t: FilesTranslate;
}): ReactElement {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <FileDeletedOnDiskBar
        controller={controller}
        document={document}
        panelId={panelId}
        t={t}
      />
      {children}
    </div>
  );
}

export { FileDeletedOnDiskBar };

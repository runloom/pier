import { Alert, AlertDescription, AlertTitle } from "@pier/ui/alert.tsx";
import { Button } from "@pier/ui/button.tsx";
import type { FilesDocument } from "../document/types.ts";
import type { FilesTranslate } from "../i18n.ts";

/**
 * Open-document disk conflict chrome: keep local / load disk / compare.
 * Shown above the editor/preview when disk changed under a protected buffer.
 */
export function FileDiskConflictBanner({
  canCompare,
  document,
  onCompare,
  onDismiss,
  onLoadDisk,
  t,
}: {
  canCompare: boolean;
  document: FilesDocument;
  onCompare: () => void;
  onDismiss: () => void;
  onLoadDisk: () => void;
  t: FilesTranslate;
}) {
  return (
    <div
      className="shrink-0 border-b px-4 py-3"
      data-slot="file-disk-conflict-banner"
      data-testid="file-disk-conflict-banner"
    >
      <Alert variant="warning">
        <AlertTitle>
          {t("filePanel.conflict.bannerTitle", "File changed on disk")}
        </AlertTitle>
        <AlertDescription>
          <p>
            {t(
              "filePanel.conflict.bannerBody",
              "This file was modified outside Pier. Keep your edits, load the disk version, or compare."
            )}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              onClick={onLoadDisk}
              size="sm"
              type="button"
              variant="default"
            >
              {t("filePanel.conflict.loadDiskLabel", "Load disk version")}
            </Button>
            <Button
              onClick={onDismiss}
              size="sm"
              type="button"
              variant="outline"
            >
              {t("filePanel.conflict.keepLocalLabel", "Keep my edits")}
            </Button>
            {canCompare ? (
              <Button
                onClick={onCompare}
                size="sm"
                type="button"
                variant="outline"
              >
                {t("filePanel.conflict.compareLabel", "Compare")}
              </Button>
            ) : null}
          </div>
          <p className="mt-2 font-mono text-muted-foreground text-xs">
            {document.name}
          </p>
        </AlertDescription>
      </Alert>
    </div>
  );
}

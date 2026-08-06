import { Button } from "@pier/ui/button.tsx";
import { RefreshCw } from "lucide-react";
import type { FilesTranslate } from "../i18n.ts";
import { requestCanvasReload, useCanvasChrome } from "./canvas-chrome-store.ts";

/**
 * Canvas Reload icon button, beside the preview/source toggle. Icon-only
 * ghost (`size="icon-xs"`) matching `DocumentStatusDot` / view-toggle buttons.
 *
 * Canvas `kind` (composition/docs/kit) is agent metadata for the future
 * Library surface — it is not shown in the file toolbar.
 */
export function CanvasReloadButton(props: {
  moduleId: string;
  t: FilesTranslate;
}) {
  const chrome = useCanvasChrome(props.moduleId);
  if (!chrome.isActive) {
    return null;
  }
  return (
    <Button
      aria-label={props.t("filePanel.canvas.reload", "Reload")}
      disabled={chrome.isBusy}
      onClick={() => requestCanvasReload(props.moduleId)}
      size="icon-xs"
      title={props.t("filePanel.canvas.reload", "Reload")}
      type="button"
      variant="ghost"
    >
      <RefreshCw data-icon="inline-start" />
    </Button>
  );
}

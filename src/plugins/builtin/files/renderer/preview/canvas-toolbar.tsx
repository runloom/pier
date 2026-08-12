import { Button } from "@pier/ui/button.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "@pier/ui/tooltip.tsx";
import { RefreshCw } from "lucide-react";
import type { FilesTranslate } from "../i18n.ts";
import { requestCanvasReload, useCanvasChrome } from "./canvas-chrome-store.ts";

/**
 * Canvas Reload icon button. In the file toolbar order (canvas preview):
 * annotate → reload → switch-to-source. Icon-only ghost (`size="icon-xs"`).
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
  const label = props.t("filePanel.canvas.reload", "Reload");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          disabled={chrome.isBusy}
          onClick={() => requestCanvasReload(props.moduleId)}
          size="icon-xs"
          type="button"
          variant="ghost"
        >
          <RefreshCw data-icon="inline-start" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

import { Button } from "@pier/ui/button.tsx";
import { useMinSpinVisual } from "@pier/ui/hooks/use-min-spin.ts";
import { Tooltip, TooltipContent, TooltipTrigger } from "@pier/ui/tooltip.tsx";
import { cn } from "@pier/ui/utils.ts";
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
  // 视觉下限：快速重载至少让用户看到按钮响应；不延迟内容与禁用态。
  const spin = useMinSpinVisual(chrome.isBusy);
  if (!chrome.isActive) {
    return null;
  }
  const label = props.t("filePanel.canvas.reload", "Reload");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-busy={chrome.isBusy || undefined}
          aria-label={label}
          disabled={chrome.isBusy}
          onClick={() => requestCanvasReload(props.moduleId)}
          size="icon-xs"
          type="button"
          variant="ghost"
        >
          <RefreshCw
            className={cn(spin && "animate-spin")}
            data-icon="inline-start"
          />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * After host open with preferPreview, force preview mode (Markdown / Canvas).
 * Optional canvas node reveal is applied via requestCanvasAnchorReveal.
 */
import { onFilesDiskPathOpened } from "@plugins/api/files-disk-path-opened.ts";
import { seedFilesPanelView } from "../panel/transfer-state.ts";
import { requestCanvasAnchorReveal } from "../preview/canvas-anchor-reveal.ts";

export function registerFilesDiskOpenPreviewPrefer(): () => void {
  return onFilesDiskPathOpened((event) => {
    if (event.preferPreview !== true) {
      return;
    }
    seedFilesPanelView({
      panelId: event.instanceId,
      view: { mode: "preview" },
    });
    if (event.canvasRevealAnchor) {
      requestCanvasAnchorReveal(event.path, event.canvasRevealAnchor);
    }
  });
}

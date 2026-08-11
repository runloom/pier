/**
 * After host open with preferPreview, force Markdown preview mode.
 */
import { onFilesDiskPathOpened } from "@plugins/api/files-disk-path-opened.ts";
import { seedFilesPanelView } from "../panel/transfer-state.ts";

export function registerFilesDiskOpenPreviewPrefer(): () => void {
  return onFilesDiskPathOpened((event) => {
    if (event.preferPreview !== true) {
      return;
    }
    seedFilesPanelView({
      panelId: event.instanceId,
      view: { mode: "preview" },
    });
  });
}

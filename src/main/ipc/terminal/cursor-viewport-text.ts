import { findAppWindowForActivityWindowId } from "../../windows/identity.ts";
import { setCursorViewportReader } from "../foreground-activity.ts";
import type { NativeAddon } from "./native-addon.ts";
import { toNativePanelKey } from "./panel-id.ts";

/** FA windowId 是 Electron id 数字串；内部 id 只作回退。 */
export function bindCursorViewportReader(addon: NativeAddon | null): void {
  if (!addon?.readViewportText) {
    return;
  }
  const readViewportText = addon.readViewportText.bind(addon);
  setCursorViewportReader((panelId, windowId) => {
    const win = findAppWindowForActivityWindowId(windowId);
    if (!win || win.isDestroyed()) {
      return null;
    }
    return readViewportText(toNativePanelKey(win, panelId));
  });
}

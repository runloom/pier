import { PIER_BROADCAST } from "@shared/ipc-channels.ts";
import type { BaseWindow, WebContentsView } from "electron";

export function installMacAppViewGeometry(
  host: BaseWindow,
  appView: WebContentsView
): void {
  const resizeAppView = () => {
    const [width = 0, height = 0] = host.getContentSize();
    appView.setBounds({ x: 0, y: 0, width, height });
  };
  const sendLayoutPulse = (reason: "resize" | "zoom") => {
    if (!appView.webContents.isDestroyed()) {
      appView.webContents.send(PIER_BROADCAST.WINDOW_LAYOUT_PULSE, {
        reason,
      });
    }
  };
  resizeAppView();
  host.on("resize", () => {
    resizeAppView();
    sendLayoutPulse("resize");
  });
  host.on("resized", () => sendLayoutPulse("resize"));
  host.on("maximize", () => sendLayoutPulse("zoom"));
  host.on("unmaximize", () => sendLayoutPulse("zoom"));
  host.on("enter-full-screen", () => sendLayoutPulse("zoom"));
  host.on("leave-full-screen", () => sendLayoutPulse("zoom"));
}

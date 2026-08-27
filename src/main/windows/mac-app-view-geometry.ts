import { PIER_BROADCAST } from "@shared/ipc-channels.ts";
import type { BaseWindow, WebContentsView } from "electron";
import { setCursorViewportResizePollPaused } from "../services/agents/integrations/transcript/cursor-viewport-poll-gate.ts";

export function installMacAppViewGeometry(
  host: BaseWindow,
  appView: WebContentsView
): void {
  const windowId = host.id;
  const resizeAppView = () => {
    const [width = 0, height = 0] = host.getContentSize();
    appView.setBounds({ x: 0, y: 0, width, height });
  };
  const sendLayoutPulse = (
    reason: "resize" | "zoom",
    phase?: "active" | "end"
  ) => {
    if (reason === "resize") {
      setCursorViewportResizePollPaused(windowId, phase === "active");
    } else {
      // maximize / fullscreen 只发 zoom，不发 resized。
      setCursorViewportResizePollPaused(windowId, false);
    }
    if (!appView.webContents.isDestroyed()) {
      appView.webContents.send(PIER_BROADCAST.WINDOW_LAYOUT_PULSE, {
        reason,
        ...(phase ? { phase } : {}),
      });
    }
  };
  resizeAppView();
  host.on("resize", () => {
    resizeAppView();
    sendLayoutPulse("resize", "active");
  });
  host.on("resized", () => sendLayoutPulse("resize", "end"));
  host.on("maximize", () => sendLayoutPulse("zoom"));
  host.on("unmaximize", () => sendLayoutPulse("zoom"));
  host.on("enter-full-screen", () => sendLayoutPulse("zoom"));
  host.on("leave-full-screen", () => sendLayoutPulse("zoom"));
  host.on("closed", () => setCursorViewportResizePollPaused(windowId, false));
}

import { getTerminalAddon } from "../ipc/terminal/index.ts";
import {
  armDetaching,
  scheduleDisarmDetaching,
} from "../services/agents/window-detaching-guard.ts";
import { skipPanelIdsForHostTeardown } from "../services/host-teardown-skip.ts";
import { detachAgentsForWindowSync } from "../state/terminal-session-state.ts";
import type { AppWindow } from "./app-window.ts";
import { findWindowContext } from "./identity.ts";

/** Tear down one live window during app quit (no close-intercept path). */
export function destroyAppWindowForQuit(window: AppWindow): void {
  if (window.isDestroyed()) {
    return;
  }
  const context = findWindowContext(window);
  const detachingKeys =
    context == null
      ? null
      : {
          electronWindowId: context.electronWindowId ?? String(window.id),
          recordId: context.recordId,
        };
  if (detachingKeys) {
    armDetaching(detachingKeys);
    detachAgentsForWindowSync(detachingKeys.recordId, {
      skipPanelIds: skipPanelIdsForHostTeardown(
        detachingKeys.recordId,
        detachingKeys.electronWindowId
      ),
    });
  }
  try {
    getTerminalAddon()?.detachWindow(window.getNativeWindowHandle());
  } catch {
    // ignore: app 正在退出
  }
  if (window.appView && !window.webContents.isDestroyed()) {
    window.webContents.close();
  }
  window.destroy();
  if (detachingKeys) {
    scheduleDisarmDetaching(detachingKeys);
  }
}

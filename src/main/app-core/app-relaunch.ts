import type { ManagedPluginInstallService } from "../services/managed-plugins/install-service.ts";

/**
 * Dev-mode `app.relaunch` = **soft restart**:
 *   1. Advance the managed-plugin restart state
 *      (`simulateRestartForTests` clears `pendingRestart`, drops
 *      `effectiveAtStartup` for uninstalled entries, refreshes the
 *      runtime snapshot).
 *   2. Reload every renderer webContents so the UI picks up (1).
 *
 * Real `app.relaunch()` fights `electron-vite dev` — the vite dev server
 * shuts down when the electron process quits and the spawned electron
 * boots into a dead URL (white screen). Plugin main runtimes stay loaded
 * until `pnpm dev` is rerun; the renderer surfaces a toast to that effect.
 *
 * NOTE: pier windows are `BaseWindow` + `WebContentsView`, not
 * `BrowserWindow`. `BrowserWindow.getAllWindows()` returns []; the
 * custom windowManager is the source of truth.
 */
export async function performDevSoftRelaunch(
  managedPlugins: ManagedPluginInstallService
): Promise<void> {
  const { windowManager } = await import("../windows/window-manager.ts");
  await managedPlugins.simulateRestartForTests();
  for (const win of windowManager.getAll()) {
    if (!win.isDestroyed()) {
      win.webContents.reload();
    }
  }
}

/** Prod-mode `app.relaunch` = actual OS-level app relaunch. */
export async function performProdRelaunch(): Promise<void> {
  const { app } = await import("electron");
  app.relaunch();
  app.quit();
}

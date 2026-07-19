import type { ManagedPluginInstallService } from "../services/managed-plugins/install-service.ts";

let intentionalRelaunchArmed = false;

/** True while a deliberate app.relaunch is in flight (skip quit confirm). */
export function isIntentionalRelaunchArmed(): boolean {
  return intentionalRelaunchArmed;
}

export function armIntentionalRelaunch(): void {
  intentionalRelaunchArmed = true;
}

/** Clear after a failed relaunch quit so ordinary quit keeps confirmation. */
export function disarmIntentionalRelaunch(): void {
  intentionalRelaunchArmed = false;
}

/** Test-only reset. */
export function resetIntentionalRelaunchForTests(): void {
  intentionalRelaunchArmed = false;
}

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

/**
 * Prod-mode `app.relaunch`.
 *
 * 只 arm 退出确认旁路并请求退出；真正的 `app.relaunch()` 由 quit
 * proceed 路径在 flush 成功后调用（见 main `proceedToQuit`），避免
 * flush 失败后仍排队重启、或旁路标志永久粘住。
 */
export async function performProdRelaunch(): Promise<void> {
  const { app } = await import("electron");
  armIntentionalRelaunch();
  app.quit();
}

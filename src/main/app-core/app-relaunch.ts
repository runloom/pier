import type { ManagedPluginInstallService } from "../services/managed-plugins/install-service.ts";

export type IntentionalQuitAction = "quitAndInstall" | "relaunch";

let intentionalQuitAction: IntentionalQuitAction | null = null;

/** True while a deliberate relaunch / quitAndInstall is in flight (skip quit confirm). */
export function isIntentionalRelaunchArmed(): boolean {
  return intentionalQuitAction !== null;
}

export function armIntentionalRelaunch(): void {
  intentionalQuitAction = "relaunch";
}

export function armIntentionalQuitAndInstall(): void {
  intentionalQuitAction = "quitAndInstall";
}

/** Clear after a failed relaunch/install quit so ordinary quit keeps confirmation. */
export function disarmIntentionalRelaunch(): void {
  intentionalQuitAction = null;
}

/** Test-only reset. */
export function resetIntentionalRelaunchForTests(): void {
  intentionalQuitAction = null;
}

/**
 * Read and clear the armed intentional quit action.
 * Called from proceedToQuit after flush succeeds so layout is durable first.
 */
export function consumeIntentionalQuitAction(): IntentionalQuitAction | null {
  const action = intentionalQuitAction;
  intentionalQuitAction = null;
  return action;
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

/**
 * Prod-mode update install.
 *
 * 与 relaunch 同路径：先 arm + `app.quit()`，让 `before-quit` 跑
 * `prepareClose` / `flushLayout` / window-record 落盘；真正的
 * `autoUpdater.quitAndInstall()` 只在 flush 成功后的 proceed 里调用。
 * 直接调 updater 会跳过布局 flush，更新后工作区回到默认布局。
 */
export async function performProdQuitAndInstall(): Promise<void> {
  const { app } = await import("electron");
  armIntentionalQuitAndInstall();
  app.quit();
}

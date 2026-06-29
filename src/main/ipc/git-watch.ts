import { DEFAULT_CAPABILITIES_BY_CLIENT_KIND } from "@shared/contracts/permissions.ts";
import { PIER, PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { type IpcMainInvokeEvent, ipcMain, type WebContents } from "electron";
import { appCore } from "../app-core/app-core.ts";
import { windowManager } from "../windows/window-manager.ts";

/**
 * git 变更监听 IPC:
 * - PIER.GIT_WATCH_START → 启动订阅,把变更经 PIER_BROADCAST.GIT_CHANGED 推回该 BrowserWindow
 * - PIER.GIT_WATCH_STOP → 停止订阅
 *
 * 设计要点:
 * - 按 (webContentsId, gitRoot) 引用计数:同 wc 同 gitRoot 多次 start 只算一份订阅
 * - webContents 销毁时自动 unsubscribe 全部订阅(防泄漏)
 * - WeakSet hookedWebContents 守护 `destroyed` 监听器**每 wc 只注册一次**
 *   (避免同 wc 订阅多 gitRoot / start-stop-start 累积多个 destroyed listener
 *    触发 Node MaxListenersExceededWarning)
 * - capability 校验:sender 对应 client 必须有 `git:read` 才能订阅
 *   (与命令链路同等待遇,防 watch 绕过权限系统)
 */
export function registerGitWatchIpc(): void {
  const subscriptions = new Map<string, () => void>();
  const hookedWebContents = new WeakSet<WebContents>();

  function key(webContentsId: number, gitRoot: string): string {
    return `${webContentsId}::${gitRoot}`;
  }

  function ensureClientHasGitRead(wc: WebContents): boolean {
    const window = windowManager.fromWebContents(wc);
    if (!window) {
      return false;
    }
    const windowId = windowManager.findInternalIdByWindow(window);
    if (!windowId) {
      return false;
    }
    const clientId = `desktop-renderer:${windowId}`;
    let client = appCore.clients.heartbeat(clientId);
    if (!client) {
      const now = Date.now();
      appCore.clients.register({
        capabilities: DEFAULT_CAPABILITIES_BY_CLIENT_KIND["desktop-renderer"],
        createdAt: now,
        id: clientId,
        kind: "desktop-renderer",
        lastSeenAt: now,
      });
      client = appCore.clients.heartbeat(clientId);
    }
    return client?.capabilities.includes("git:read") === true;
  }

  function hookDestroyOnce(wc: WebContents): void {
    if (hookedWebContents.has(wc)) {
      return;
    }
    hookedWebContents.add(wc);
    wc.once("destroyed", () => {
      const prefix = `${wc.id}::`;
      for (const [storedKey, dispose] of subscriptions.entries()) {
        if (storedKey.startsWith(prefix)) {
          dispose();
          subscriptions.delete(storedKey);
        }
      }
    });
  }

  ipcMain.handle(
    PIER.GIT_WATCH_START,
    (event: IpcMainInvokeEvent, gitRoot: unknown) => {
      if (typeof gitRoot !== "string" || gitRoot.length === 0) {
        return false;
      }
      const wc = event.sender;
      if (!ensureClientHasGitRead(wc)) {
        return false;
      }
      const subKey = key(wc.id, gitRoot);
      if (subscriptions.has(subKey)) {
        return true;
      }
      const unsubscribe = appCore.services.gitWatch.watch(
        gitRoot,
        (changeEvent) => {
          if (!wc.isDestroyed()) {
            wc.send(PIER_BROADCAST.GIT_CHANGED, changeEvent);
          }
        }
      );
      subscriptions.set(subKey, unsubscribe);
      hookDestroyOnce(wc);
      return true;
    }
  );

  ipcMain.handle(
    PIER.GIT_WATCH_STOP,
    (event: IpcMainInvokeEvent, gitRoot: unknown) => {
      if (typeof gitRoot !== "string" || gitRoot.length === 0) {
        return false;
      }
      const subKey = key(event.sender.id, gitRoot);
      const unsubscribe = subscriptions.get(subKey);
      if (unsubscribe) {
        unsubscribe();
        subscriptions.delete(subKey);
      }
      return true;
    }
  );
}

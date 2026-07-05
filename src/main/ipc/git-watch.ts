import { DEFAULT_CAPABILITIES_BY_CLIENT_KIND } from "@shared/contracts/permissions.ts";
import { PIER, PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { type IpcMainInvokeEvent, ipcMain, type WebContents } from "electron";
import { appCore } from "../app-core/app-core.ts";
import { windowManager } from "../windows/window-manager.ts";
import { createGitWatchSubscriptions } from "./git-watch-subscriptions.ts";

/**
 * git 变更监听 IPC:
 * - PIER.GIT_WATCH_START → 启动订阅,把变更经 PIER_BROADCAST.GIT_CHANGED 推回该 BrowserWindow
 * - PIER.GIT_WATCH_STOP → 停止订阅
 *
 * 设计要点:
 * - 按 (webContentsId, gitRoot) 引用计数(git-watch-subscriptions):同 wc 同 gitRoot
 *   多个消费方共享一份底层订阅,最后一个 stop 才销毁——单个面板 unmount 不得杀死
 *   其余面板共享的订阅(否则它们的 git 状态永久冻结)
 * - webContents 销毁或跨文档导航(reload)时自动 unsubscribe 全部订阅(防泄漏):
 *   reload 后旧 renderer 的 stop 永远不会到达,不清零则计数虚增、底层 watcher 常驻
 * - WeakSet hookedWebContents 守护 `destroyed` 监听器**每 wc 只注册一次**
 *   (避免同 wc 订阅多 gitRoot / start-stop-start 累积多个 destroyed listener
 *    触发 Node MaxListenersExceededWarning)
 * - capability 校验:sender 对应 client 必须有 `git:read` 才能订阅
 *   (与命令链路同等待遇,防 watch 绕过权限系统)
 */
export function registerGitWatchIpc(): void {
  const subscriptions = createGitWatchSubscriptions();
  const hookedWebContents = new WeakSet<WebContents>();

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

  function hookLifecycleOnce(wc: WebContents): void {
    if (hookedWebContents.has(wc)) {
      return;
    }
    hookedWebContents.add(wc);
    wc.once("destroyed", () => {
      subscriptions.dropAll(wc.id);
    });
    // did-navigate 只在主 frame 跨文档导航(含 reload)提交时触发;
    // 新文档 preload 的 START 严格晚于 commit 送达,清零无竞态
    wc.on("did-navigate", () => {
      subscriptions.dropAll(wc.id);
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
      subscriptions.start(wc.id, gitRoot, () =>
        appCore.services.gitWatch.watch(gitRoot, (changeEvent) => {
          if (!wc.isDestroyed()) {
            wc.send(PIER_BROADCAST.GIT_CHANGED, changeEvent);
          }
        })
      );
      hookLifecycleOnce(wc);
      return true;
    }
  );

  ipcMain.handle(
    PIER.GIT_WATCH_STOP,
    (event: IpcMainInvokeEvent, gitRoot: unknown) => {
      if (typeof gitRoot !== "string" || gitRoot.length === 0) {
        return false;
      }
      subscriptions.stop(event.sender.id, gitRoot);
      return true;
    }
  );
}

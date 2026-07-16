import { randomUUID } from "node:crypto";
import { gitReviewRootPathSchema } from "@shared/contracts/git-review.ts";
import {
  type GitWatchLease,
  gitWatchStopRequestSchema,
} from "@shared/contracts/git-watch.ts";
import { DEFAULT_CAPABILITIES_BY_CLIENT_KIND } from "@shared/contracts/permissions.ts";
import { PIER, PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { type IpcMainInvokeEvent, ipcMain, type WebContents } from "electron";
import { appCore } from "../app-core/app-core.ts";
import { windowManager } from "../windows/window-manager.ts";
import { resolveCanonicalGitWatchRoot } from "./git-watch-root.ts";
import {
  createGitWatchSubscriptions,
  GIT_WATCH_MAX_REFERENCES_PER_ROOT,
} from "./git-watch-subscriptions.ts";
import { isTrustedMainFrame } from "./trusted-main-frame.ts";

const GIT_WATCH_MAX_PENDING_ROOTS_PER_WEB_CONTENTS = 16;
const GIT_WATCH_MAX_PENDING_ROOTS = 64;

interface PendingRootResolution {
  readonly controller: AbortController;
  readonly promise: Promise<string | null>;
  reservations: number;
}

interface SharedRootProbe {
  readonly promise: Promise<string | null>;
}

/**
 * git 变更监听 IPC:
 * - PIER.GIT_WATCH_START → 启动订阅,把变更经 PIER_BROADCAST.GIT_CHANGED 推回该 BrowserWindow
 * - PIER.GIT_WATCH_STOP → 停止订阅
 *
 * 设计要点:
 * - 按 (webContentsId, gitRoot) 引用计数(git-watch-subscriptions):同 wc 同 gitRoot
 *   多个消费方共享一份底层订阅,最后一个 stop 才销毁——单个面板 unmount 不得杀死
 *   其余面板共享的订阅(否则它们的 git 状态永久冻结)
 * - webContents 崩溃、销毁或跨文档导航(reload)时自动 unsubscribe 全部订阅(防泄漏):
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
  const pendingRootResolutions = new WeakMap<
    WebContents,
    Map<string, PendingRootResolution>
  >();
  // 底层 canonical 探测不归某一 renderer 文档所有。导航只取消旧文档 waiter；
  // 同一 wc/rawRoot 的真实探测在结算前始终复用并只占一个配额槽。
  const sharedRootProbes = new WeakMap<
    WebContents,
    Map<string, SharedRootProbe>
  >();
  const leasesByWebContents = new Map<number, Map<string, string>>();
  let pendingRootCount = 0;

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
    const release = () => {
      const pending = pendingRootResolutions.get(wc);
      // 当前文档先与旧 waiter 表脱离；新 preload 会建立独立 waiter，底层探测
      // 则跨导航共享，避免每次 reload 重复占用全局槽位。
      pendingRootResolutions.delete(wc);
      for (const resolution of pending?.values() ?? []) {
        resolution.controller.abort();
      }
      leasesByWebContents.delete(wc.id);
      subscriptions.dropAll(wc.id);
    };
    wc.once("destroyed", release);
    // did-navigate 只在主 frame 跨文档导航(含 reload)提交时触发;
    // 新文档 preload 的 START 严格晚于 commit 送达,清零无竞态
    wc.on("did-navigate", release);
    wc.on("render-process-gone", release);
  }

  async function canonicalRootFor(
    wc: WebContents,
    rawRoot: unknown
  ): Promise<string | null> {
    const parsed = gitReviewRootPathSchema.safeParse(rawRoot);
    if (!parsed.success) {
      return null;
    }
    let pending = pendingRootResolutions.get(wc);
    const existing = pending?.get(parsed.data);
    if (existing) {
      if (existing.reservations >= GIT_WATCH_MAX_REFERENCES_PER_ROOT) {
        return null;
      }
      existing.reservations += 1;
      return existing.promise.finally(() => {
        existing.reservations -= 1;
      });
    }
    if ((pending?.size ?? 0) >= GIT_WATCH_MAX_PENDING_ROOTS_PER_WEB_CONTENTS) {
      return null;
    }
    if (
      pendingRootCount >= GIT_WATCH_MAX_PENDING_ROOTS &&
      !sharedRootProbes.get(wc)?.has(parsed.data)
    ) {
      return null;
    }
    if (!pending) {
      pending = new Map();
      pendingRootResolutions.set(wc, pending);
    }
    let probes = sharedRootProbes.get(wc);
    let sharedProbe = probes?.get(parsed.data);
    if (!sharedProbe) {
      if (
        (probes?.size ?? 0) >= GIT_WATCH_MAX_PENDING_ROOTS_PER_WEB_CONTENTS ||
        pendingRootCount >= GIT_WATCH_MAX_PENDING_ROOTS
      ) {
        return null;
      }
      if (!probes) {
        probes = new Map();
        sharedRootProbes.set(wc, probes);
      }
      const probeMap = probes;
      pendingRootCount += 1;
      const rawOperations = new Set<Promise<void>>();
      const sharedPromise = resolveCanonicalGitWatchRoot(
        parsed.data,
        undefined,
        (operation) => rawOperations.add(operation)
      ).catch(() => null);
      sharedProbe = { promise: sharedPromise };
      probeMap.set(parsed.data, sharedProbe);
      sharedPromise
        .then(() => Promise.allSettled([...rawOperations]))
        .then(() => {
          pendingRootCount -= 1;
          if (probeMap.get(parsed.data) === sharedProbe) {
            probeMap.delete(parsed.data);
          }
          // WeakMap 的空 value 随 wc 自然回收；这里不捕获 wc，避免永久卡住的
          // raw 文件系统 Promise 通过结算闭包反向保活已销毁的 WebContents。
        })
        .catch(() => undefined);
    }
    const controller = new AbortController();
    const promise = new Promise<string | null>((resolve) => {
      const finish = (root: string | null): void => {
        controller.signal.removeEventListener("abort", abort);
        resolve(controller.signal.aborted || wc.isDestroyed() ? null : root);
      };
      const abort = (): void => finish(null);
      controller.signal.addEventListener("abort", abort, { once: true });
      sharedProbe.promise.then(finish, () => finish(null));
    });
    const resolution: PendingRootResolution = {
      controller,
      promise,
      reservations: 1,
    };
    pending.set(parsed.data, resolution);
    promise
      .then(() => {
        const current = pendingRootResolutions.get(wc);
        if (current?.get(parsed.data)?.controller === controller) {
          current.delete(parsed.data);
        }
        if (current?.size === 0) {
          pendingRootResolutions.delete(wc);
        }
      })
      .catch(() => undefined);
    return promise.finally(() => {
      resolution.reservations -= 1;
    });
  }

  function createLease(wcId: number, gitRoot: string): GitWatchLease {
    const leaseId = randomUUID();
    let leases = leasesByWebContents.get(wcId);
    if (!leases) {
      leases = new Map();
      leasesByWebContents.set(wcId, leases);
    }
    leases.set(leaseId, gitRoot);
    return { gitRoot, leaseId };
  }

  function releaseLease(wcId: number, rawRequest: unknown): boolean {
    const request = gitWatchStopRequestSchema.safeParse(rawRequest);
    if (!request.success) {
      return false;
    }
    const leases = leasesByWebContents.get(wcId);
    const gitRoot = leases?.get(request.data.leaseId);
    if (!(leases && gitRoot)) {
      return false;
    }
    if (!subscriptions.stop(wcId, gitRoot)) {
      return false;
    }
    leases.delete(request.data.leaseId);
    if (leases.size === 0) {
      leasesByWebContents.delete(wcId);
    }
    return true;
  }

  ipcMain.handle(
    PIER.GIT_WATCH_START,
    async (event: IpcMainInvokeEvent, rawRoot: unknown) => {
      if (!isTrustedMainFrame(event)) {
        return false;
      }
      const wc = event.sender;
      if (!ensureClientHasGitRead(wc)) {
        return false;
      }
      hookLifecycleOnce(wc);
      const gitRoot = await canonicalRootFor(wc, rawRoot);
      if (!gitRoot) {
        return false;
      }
      const started = subscriptions.start(wc.id, gitRoot, () =>
        appCore.services.gitWatch.watch(gitRoot, (changeEvent) => {
          if (!wc.isDestroyed()) {
            wc.send(PIER_BROADCAST.GIT_CHANGED, changeEvent);
          }
        })
      );
      return started ? createLease(wc.id, gitRoot) : false;
    }
  );

  ipcMain.handle(
    PIER.GIT_WATCH_STOP,
    (event: IpcMainInvokeEvent, request: unknown) => {
      if (!isTrustedMainFrame(event)) {
        return false;
      }
      return releaseLease(event.sender.id, request);
    }
  );
}

import type { FileWatchEvent } from "@shared/contracts/file-watch.ts";
import { PIER, PIER_BROADCAST } from "@shared/ipc-channels.ts";
import type { IpcRenderer, IpcRendererEvent } from "electron";

const INITIAL_RETRY_DELAY_MS = 250;
const MAX_RETRY_DELAY_MS = 5000;
const TRAILING_SLASHES_PATTERN = /\/+$/;

function normalizeRoot(root: string): string {
  return root.replace(TRAILING_SLASHES_PATTERN, "");
}

/** 保持订阅直到成功或调用方释放；短暂 IPC/服务故障不会让会话失去监听。 */
export function subscribeFileWatch(input: {
  excludes?: readonly string[];
  ipcRenderer: Pick<IpcRenderer, "invoke" | "off" | "on">;
  listener(event: FileWatchEvent): void;
  root: string;
}): () => void {
  const { excludes, ipcRenderer, listener, root } = input;
  const expectedRoot = normalizeRoot(root);
  let active = true;
  let retryAttempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let started = false;
  const handler = (_event: IpcRendererEvent, payload: FileWatchEvent): void => {
    if (normalizeRoot(payload.root) === expectedRoot) listener(payload);
  };
  ipcRenderer.on(PIER_BROADCAST.FILE_CHANGED, handler);

  const stopStartedWatch = (): void => {
    ipcRenderer.invoke(PIER.FILE_WATCH_STOP, root).catch(() => undefined);
  };
  const start = async (): Promise<void> => {
    if (!active || started) return;
    let ok = false;
    try {
      ok =
        (await ipcRenderer.invoke(
          PIER.FILE_WATCH_START,
          excludes?.length ? { excludes: [...excludes], root } : root
        )) === true;
    } catch {
      // 短暂启动故障走下方退避重试，监听生命周期仍由调用方控制。
    }
    if (!active) {
      if (ok) stopStartedWatch();
      return;
    }
    if (ok) {
      started = true;
      return;
    }
    const delay = Math.min(
      INITIAL_RETRY_DELAY_MS * 2 ** retryAttempt,
      MAX_RETRY_DELAY_MS
    );
    retryAttempt = Math.min(retryAttempt + 1, 5);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      start().catch(() => undefined);
    }, delay);
  };
  start().catch(() => undefined);

  return () => {
    if (!active) return;
    active = false;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    ipcRenderer.off(PIER_BROADCAST.FILE_CHANGED, handler);
    if (started) stopStartedWatch();
  };
}

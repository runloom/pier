/**
 * IPC 桥接 + 多窗口广播.
 * - read: invoke, 返回当前 state (首次会从磁盘读)
 * - record: send (fire-and-forget), 内存写 + 异步落盘 + 广播
 * - clear: invoke, 重置 + 落盘 + 广播
 *
 * 串行化: 用一个 promise 链让 record/clear 顺序执行, 避免 lockfile 抢占.
 */
import {
  EMPTY_MRU_STATE,
  type MruState,
} from "@shared/contracts/command-palette-mru.ts";
import { BrowserWindow, type IpcMain } from "electron";
import {
  readMruState,
  recordUse,
  writeMruState,
} from "../state/command-palette-mru.ts";

const CHANNEL_READ = "pier:command-palette-mru:read";
const CHANNEL_RECORD = "pier:command-palette-mru:record";
const CHANNEL_CLEAR = "pier:command-palette-mru:clear";
const CHANNEL_CHANGED = "pier:command-palette-mru:changed";

let memo: MruState | null = null;
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  // 吞掉错误避免毒化 queue, 但保留链
  queue = next.catch(() => undefined);
  return next;
}

async function ensureLoaded(): Promise<MruState> {
  if (memo) {
    return memo;
  }
  memo = await readMruState();
  return memo;
}

function broadcast(state: MruState): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(CHANNEL_CHANGED, state);
    }
  }
}

export function registerCommandPaletteMruIpc(ipcMain: IpcMain): void {
  ipcMain.handle(CHANNEL_READ, async () => ensureLoaded());

  ipcMain.on(CHANNEL_RECORD, (_event, actionId: string) => {
    if (typeof actionId !== "string" || actionId.length === 0) {
      return;
    }
    enqueue(async () => {
      const current = await ensureLoaded();
      const next = recordUse(current, actionId, Date.now());
      memo = next;
      try {
        await writeMruState(next);
      } catch (err) {
        console.error("[command-palette-mru] 落盘失败:", err);
      }
      broadcast(next);
    });
  });

  ipcMain.handle(CHANNEL_CLEAR, async () =>
    enqueue(async () => {
      memo = EMPTY_MRU_STATE;
      try {
        await writeMruState(EMPTY_MRU_STATE);
      } catch (err) {
        console.error("[command-palette-mru] 清空落盘失败:", err);
      }
      broadcast(EMPTY_MRU_STATE);
      return EMPTY_MRU_STATE;
    })
  );
}

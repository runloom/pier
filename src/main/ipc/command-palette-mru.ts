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
let memoPromise: Promise<MruState> | null = null;
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  // 吞掉错误避免毒化 queue, 但保留链
  queue = next.catch(() => undefined);
  return next;
}

function ensureLoaded(): Promise<MruState> {
  if (memo) {
    return Promise.resolve(memo);
  }
  if (memoPromise) {
    return memoPromise;
  }
  memoPromise = readMruState()
    .then((s) => {
      memo = s;
      return s;
    })
    .finally(() => {
      memoPromise = null;
    });
  return memoPromise;
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
    // #6: 拒绝异常长的 actionId, 避免 disk-fill 攻击面.
    if (
      typeof actionId !== "string" ||
      actionId.length === 0 ||
      actionId.length > 128
    ) {
      return;
    }
    enqueue(async () => {
      const prev = await ensureLoaded();
      const next = recordUse(prev, actionId, Date.now());
      try {
        await writeMruState(next);
      } catch (err) {
        console.error("[command-palette-mru] record 落盘失败, memo 不变:", err);
        // #1: 落盘失败不更新 memo, 不 broadcast. 渲染器本地乐观状态在下次 read / broadcast 修复.
        return;
      }
      memo = next;
      broadcast(next);
    });
  });

  ipcMain.handle(CHANNEL_CLEAR, async () =>
    enqueue(async () => {
      await ensureLoaded(); // 让磁盘读完成, 避免后续 read 与本 clear 抢
      try {
        await writeMruState(EMPTY_MRU_STATE);
      } catch (err) {
        console.error("[command-palette-mru] 清空落盘失败:", err);
        // #2: 让 invoke 抛错, 渲染器 catch 后能本地兜底.
        throw err;
      }
      memo = EMPTY_MRU_STATE;
      broadcast(EMPTY_MRU_STATE);
      return EMPTY_MRU_STATE;
    })
  );
}

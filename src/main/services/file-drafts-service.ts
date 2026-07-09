import { join } from "node:path";
import type { FileDraftsListResult } from "@shared/contracts/file.ts";
import {
  type DebouncedJsonStore,
  debouncedJsonStore,
} from "../state/debounced-store.ts";

/**
 * hot-exit 草稿存储(userData/file-drafts.json)。
 * renderer 侧脏文档(disk + untitled)的序列化快照挂在这里,
 * 崩溃/重载后重开文件时恢复为 dirty 态。
 * localStorage 不可靠(随 webContents 清缓存丢失),故落 userData。
 */
export interface FileDraftsService {
  delete(key: string): Promise<void>;
  flush(): Promise<void>;
  list(): Promise<FileDraftsListResult>;
  set(key: string, value: string): Promise<void>;
}

const MAX_DRAFT_VALUE_BYTES = 2 * 1024 * 1024;
const MAX_DRAFT_ENTRIES = 200;

export function createFileDraftsService(options: {
  userDataDir: string;
}): FileDraftsService {
  const store: DebouncedJsonStore<FileDraftsListResult> = debouncedJsonStore({
    defaults: {},
    filePath: join(options.userDataDir, "file-drafts.json"),
  });
  let ready: Promise<unknown> | null = null;

  function ensureInit(): Promise<unknown> {
    ready ??= store.init();
    return ready;
  }

  return {
    async delete(key) {
      await ensureInit();
      store.mutate((state) => {
        if (!(key in state)) {
          return state;
        }
        const { [key]: _removed, ...rest } = state;
        return rest;
      });
    },
    async flush() {
      await ensureInit();
      await store.flush();
    },
    async list() {
      await ensureInit();
      return store.get();
    },
    async set(key, value) {
      if (Buffer.byteLength(value, "utf8") > MAX_DRAFT_VALUE_BYTES) {
        // 超大草稿直接拒绝落盘:hot-exit 是兜底不是备份系统,
        // 巨型缓冲会拖慢每次 flush 且极少是用户想要的。
        return;
      }
      await ensureInit();
      store.mutate((state) => {
        const next = { ...state, [key]: value };
        const keys = Object.keys(next);
        if (keys.length > MAX_DRAFT_ENTRIES) {
          // 简单 FIFO 淘汰:草稿键含创建顺序无保障,删最早枚举的多余项。
          for (const staleKey of keys.slice(
            0,
            keys.length - MAX_DRAFT_ENTRIES
          )) {
            delete next[staleKey];
          }
        }
        return next;
      });
    },
  };
}

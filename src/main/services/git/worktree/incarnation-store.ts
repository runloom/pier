/**
 * Worktree incarnation 持久化（repo 主根下 .pier/worktree-incarnations.json）。
 * create 必须 mint 新 id；list 对已有路径 ensure；remove 后 forget。
 * 磁盘不可写时降级为进程内 Map，避免 list/create 因路径假造失败。
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export interface WorktreeIncarnationStore {
  ensure(worktreePath: string): Promise<string>;
  forget(worktreePath: string): Promise<void>;
  /** 始终新发，覆盖同路径旧 id（用于 create/rebuild） */
  mint(worktreePath: string): Promise<string>;
}

interface StoreFile {
  byPath: Record<string, string>;
  version: 1;
}

/** 进程内兜底：同 mainPath 共享，磁盘失败时仍满足 mint/ensure 语义 */
const memoryByMain = new Map<string, Record<string, string>>();

function storePath(mainPath: string): string {
  return join(resolve(mainPath), ".pier", "worktree-incarnations.json");
}

function keyOf(path: string): string {
  return resolve(path);
}

async function loadDisk(mainPath: string): Promise<StoreFile | null> {
  try {
    const raw = await readFile(storePath(mainPath), "utf8");
    const parsed = JSON.parse(raw) as StoreFile;
    if (
      parsed &&
      parsed.version === 1 &&
      parsed.byPath &&
      typeof parsed.byPath === "object"
    ) {
      return parsed;
    }
  } catch {
    /* missing */
  }
  return null;
}

async function saveDisk(mainPath: string, data: StoreFile): Promise<boolean> {
  try {
    const file = storePath(mainPath);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    return true;
  } catch {
    return false;
  }
}

function memoryMap(mainPath: string): Record<string, string> {
  const root = resolve(mainPath);
  let map = memoryByMain.get(root);
  if (!map) {
    map = {};
    memoryByMain.set(root, map);
  }
  return map;
}

export function createWorktreeIncarnationStore(options?: {
  load?: (mainPath: string) => Promise<StoreFile>;
  save?: (mainPath: string, data: StoreFile) => Promise<void>;
  uuid?: () => string;
}): (mainPath: string) => WorktreeIncarnationStore {
  const customLoad = options?.load;
  const customSave = options?.save;
  const uuid = options?.uuid ?? (() => randomUUID());

  return (mainPath: string): WorktreeIncarnationStore => {
    const root = resolve(mainPath);
    // 同 mainPath 串行 RMW，避免并行 list/create/remove 丢键
    let chain: Promise<unknown> = Promise.resolve();
    function serialize<T>(fn: () => Promise<T>): Promise<T> {
      const run = chain.then(fn, fn);
      chain = run.then(
        () => undefined,
        () => undefined
      );
      return run;
    }

    async function readMap(): Promise<Record<string, string>> {
      if (customLoad) {
        const data = await customLoad(root);
        return { ...data.byPath };
      }
      const disk = await loadDisk(root);
      if (disk) {
        // 磁盘优先合并进进程缓存；始终返回拷贝，避免 mint/write 与 live map 别名互相清空。
        const mem = memoryMap(root);
        Object.assign(mem, disk.byPath);
        return { ...mem };
      }
      return { ...memoryMap(root) };
    }

    async function writeMap(byPath: Record<string, string>): Promise<void> {
      const snapshot = { ...byPath };
      const mem = memoryMap(root);
      for (const k of Object.keys(mem)) {
        delete mem[k];
      }
      Object.assign(mem, snapshot);
      const data: StoreFile = { version: 1, byPath: snapshot };
      if (customSave) {
        await customSave(root, data);
        return;
      }
      await saveDisk(root, data);
    }

    return {
      ensure(worktreePath) {
        return serialize(async () => {
          const byPath = await readMap();
          const key = keyOf(worktreePath);
          const existing = byPath[key];
          if (existing && existing.length > 0) {
            return existing;
          }
          const id = uuid();
          byPath[key] = id;
          await writeMap(byPath);
          return id;
        });
      },
      mint(worktreePath) {
        return serialize(async () => {
          const byPath = await readMap();
          const key = keyOf(worktreePath);
          const id = uuid();
          byPath[key] = id;
          await writeMap(byPath);
          return id;
        });
      },
      forget(worktreePath) {
        return serialize(async () => {
          const byPath = await readMap();
          const key = keyOf(worktreePath);
          if (!(key in byPath)) {
            return;
          }
          delete byPath[key];
          await writeMap(byPath);
        });
      },
    };
  };
}

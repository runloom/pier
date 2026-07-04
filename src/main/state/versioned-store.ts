/**
 * 版本化 JSON store — 兼容 DebouncedJsonStore 接口。
 *
 * 启动时：读磁盘 → 检测 version → 顺序跑迁移链 → schema 校验 → 写回。
 * 迁移失败时备份原文件后回退到 defaults。
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import writeFileAtomic from "write-file-atomic";
import type { z } from "zod";
import type { DebouncedJsonStore } from "./debounced-store.ts";

/** 单步迁移：from → to，transform 原始数据。 */
export interface Migration {
  from: number;
  migrate: (data: unknown) => unknown;
  to: number;
}

/** versionedJsonStore 构造参数。 */
export interface VersionedStoreOpts<T> {
  currentVersion: number;
  debounceMs?: number;
  defaults: T;
  filePath: string;
  migrations: readonly Migration[];
  schema: z.ZodType<T>;
}

/**
 * 创建一个带版本迁移能力的 JSON store。
 *
 * 返回值完全兼容 DebouncedJsonStore<T> 接口；
 * init() 阶段额外处理 version 检测与迁移链。
 */
export function versionedJsonStore<T>(
  opts: VersionedStoreOpts<T>
): DebouncedJsonStore<T> {
  let state: T | undefined;
  let dirty = false;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let initPromise: Promise<T> | null = null;
  let writeQueue: Promise<void> = Promise.resolve();
  const debounceMs = opts.debounceMs ?? 500;

  // ── debounced write 机制（与 debounced-store 同构）──────────────

  function scheduleFlush(): void {
    dirty = true;
    if (!flushTimer) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        doFlush().catch((err) => {
          console.error("[versioned-store] flush failed:", err);
        });
      }, debounceMs);
    }
  }

  async function doFlush(): Promise<void> {
    if (!dirty) {
      await writeQueue;
      return;
    }
    const content = `${JSON.stringify(state, null, 2)}\n`;
    dirty = false;
    try {
      await enqueueWrite(content);
    } catch (err) {
      dirty = true;
      throw err;
    }
  }

  function enqueueWrite(content: string): Promise<void> {
    const write = writeQueue
      .catch(() => undefined)
      .then(async () => {
        await mkdir(dirname(opts.filePath), { recursive: true });
        await writeFileAtomic(opts.filePath, content);
      });
    writeQueue = write;
    return write;
  }

  // ── 版本检测 ──────────────────────────────────────────────────

  function detectVersion(raw: unknown): number {
    if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
      const v = (raw as Record<string, unknown>).version;
      if (typeof v === "number") {
        return v;
      }
    }
    return 0;
  }

  // ── 迁移链 ────────────────────────────────────────────────────

  function runMigrations(raw: unknown, fromVersion: number): unknown {
    const applicable = opts.migrations
      .filter((m) => m.from >= fromVersion && m.to <= opts.currentVersion)
      .sort((a, b) => a.from - b.from);

    let data = raw;
    for (const m of applicable) {
      data = m.migrate(data);
    }

    // 迁移完成后打上 currentVersion 戳
    if (typeof data === "object" && data !== null && !Array.isArray(data)) {
      (data as Record<string, unknown>).version = opts.currentVersion;
    }

    return data;
  }

  // ── 备份 + 回退 ───────────────────────────────────────────────

  async function backupAndReset(
    detectedVersion: number,
    error: unknown
  ): Promise<T> {
    console.error("[versioned-store] migration failed:", error);
    try {
      const backupPath = `${opts.filePath}.backup-v${detectedVersion}`;
      if (existsSync(opts.filePath)) {
        await mkdir(dirname(backupPath), { recursive: true });
        const raw = await readFile(opts.filePath, "utf-8");
        await writeFileAtomic(backupPath, raw);
      }
    } catch {
      // 尽力备份，失败也不阻塞
    }
    state = structuredClone(opts.defaults);
    scheduleFlush();
    return state;
  }

  // ── 公共接口 ──────────────────────────────────────────────────

  async function init(): Promise<T> {
    if (state !== undefined) {
      return state;
    }
    if (initPromise) {
      return initPromise;
    }

    initPromise = (async () => {
      // 无文件 → defaults + 写入
      if (!existsSync(opts.filePath)) {
        state = structuredClone(opts.defaults);
        scheduleFlush();
        return state;
      }

      let rawText: string;
      try {
        rawText = await readFile(opts.filePath, "utf-8");
      } catch {
        state = structuredClone(opts.defaults);
        scheduleFlush();
        return state;
      }

      let rawJson: unknown;
      try {
        rawJson = JSON.parse(rawText);
      } catch (err) {
        return backupAndReset(0, err);
      }

      const detectedVersion = detectVersion(rawJson);

      // 已是当前版本 → 仅校验
      if (detectedVersion === opts.currentVersion) {
        try {
          state = opts.schema.parse(rawJson);
          return state;
        } catch (err) {
          return backupAndReset(detectedVersion, err);
        }
      }

      // 需要迁移
      try {
        const migrated = runMigrations(rawJson, detectedVersion);
        state = opts.schema.parse(migrated);
        scheduleFlush();
        return state;
      } catch (err) {
        return backupAndReset(detectedVersion, err);
      }
    })();

    try {
      return await initPromise;
    } finally {
      initPromise = null;
    }
  }

  function get(): T {
    if (state === undefined) {
      throw new Error("versionedJsonStore: init() must be called before get()");
    }
    return state;
  }

  function mutate(fn: (current: T) => T): T {
    const current = get();
    state = fn(current);
    scheduleFlush();
    return state;
  }

  function replace(newState: T): T {
    state = newState;
    scheduleFlush();
    return state;
  }

  async function flush(): Promise<void> {
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    while (dirty) {
      await doFlush();
    }
    await writeQueue;
  }

  async function clear(): Promise<void> {
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    dirty = false;
    await writeQueue.catch(() => undefined);
    state = structuredClone(opts.defaults);
    try {
      await unlink(opts.filePath);
    } catch {
      // 文件不存在 — 已清除
    }
  }

  return { init, get, mutate, replace, flush, clear };
}

/**
 * In-memory JSON state + debounced atomic write.
 *
 * Replaces the proper-lockfile + writeFileAtomic pattern for userData files
 * that are only written from the Electron main process.
 *
 * - Reads from disk once on init, thereafter serves from memory.
 * - mutate() applies a synchronous mutation and schedules a debounced flush.
 * - replace() overwrites the full state and schedules a debounced flush.
 * - flush() forces an immediate write (e.g. before app quit).
 * - clear() resets to defaults and deletes the file.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import writeFileAtomic from "write-file-atomic";

/** Typed handle returned by debouncedJsonStore. */
export interface DebouncedJsonStore<T> {
  /** Reset to defaults and delete the file. */
  clear(): Promise<void>;
  /** Force immediate write — cancels pending debounce. */
  flush(): Promise<void>;
  /** Current in-memory state. Throws if init() not called. */
  get(): T;
  /** Load state from disk (or defaults). Must be called once before mutate/replace. */
  init(): Promise<T>;
  /** Apply mutation to state, schedule debounced write. Returns new state. */
  mutate(fn: (state: T) => T): T;
  /** Replace full state, schedule debounced write. Returns new state. */
  replace(state: T): T;
}

export function debouncedJsonStore<T>(opts: {
  filePath: string;
  defaults: T;
  debounceMs?: number;
}): DebouncedJsonStore<T> {
  let state: T | undefined;
  let dirty = false;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const debounceMs = opts.debounceMs ?? 500;

  function scheduleFlush(): void {
    dirty = true;
    if (!flushTimer) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        doFlush();
      }, debounceMs);
    }
  }

  async function doFlush(): Promise<void> {
    if (!dirty) {
      return;
    }
    dirty = false;
    await doWrite();
  }

  async function doWrite(): Promise<void> {
    await mkdir(dirname(opts.filePath), { recursive: true });
    await writeFileAtomic(opts.filePath, `${JSON.stringify(state, null, 2)}\n`);
  }

  async function init(): Promise<T> {
    if (state !== undefined) {
      return state;
    }
    if (existsSync(opts.filePath)) {
      try {
        const raw = await readFile(opts.filePath, "utf-8");
        state = JSON.parse(raw) as T;
        return state;
      } catch {
        // Corrupt file — fall through to defaults
      }
    }
    state = structuredClone(opts.defaults);
    return state;
  }

  function get(): T {
    if (state === undefined) {
      throw new Error("debouncedJsonStore: init() must be called before get()");
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
    await doFlush();
  }

  async function clear(): Promise<void> {
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    dirty = false;
    state = structuredClone(opts.defaults);
    try {
      await unlink(opts.filePath);
    } catch {
      // File didn't exist — already cleared
    }
  }

  return { init, get, mutate, replace, flush, clear };
}

import {
  accessSync,
  constants,
  type FSWatcher,
  watch as fsWatch,
} from "node:fs";
import { relative, resolve, sep } from "node:path";
import type {
  FileWatchChange,
  FileWatchChangeKind,
  FileWatchEvent,
} from "@shared/contracts/file-watch.ts";

const DEFAULT_DEBOUNCE_MS = 250;
const DEFAULT_MAX_WAIT_MS = 1000;
const DEFAULT_POLL_MS = 5000;

const NOISE_SEGMENTS = new Set([
  ".git",
  "node_modules",
  ".DS_Store",
  "dist",
  "dist-electron",
  ".next",
  "coverage",
]);

export type FsWatchFn = (
  target: string,
  options: { recursive: boolean },
  listener: (eventType: string, filename: string | Buffer | null) => void
) => FSWatcher;

export interface CreateFileWatchServiceOptions {
  debounceMs?: number;
  fsWatch?: FsWatchFn;
  maxWaitMs?: number;
  pollMs?: number;
}

export interface FileWatchService {
  dispose(): void;
  watch(
    root: string,
    listener: (event: FileWatchEvent) => void,
    options?: { excludes?: readonly string[] }
  ): () => void;
}

interface RootEntry {
  /** 额外排除段(全订阅方并集);命中即丢事件。 */
  extraExcludes: Set<string>;
  firstPendingAt: number | null;
  listeners: Set<(event: FileWatchEvent) => void>;
  pending: Map<string, FileWatchChangeKind>;
  pollTimer: ReturnType<typeof setInterval> | null;
  timer: ReturnType<typeof setTimeout> | null;
  watcher: FSWatcher | null;
}

function toRootRelativePosix(
  root: string,
  filename: string,
  extraExcludes?: ReadonlySet<string>
): string | null {
  const absolute = resolve(root, filename);
  const rel = relative(root, absolute);
  if (
    rel === ".." ||
    rel.startsWith(`..${sep}`) ||
    rel.startsWith("..\\") ||
    absolute === resolve(root)
  ) {
    return null;
  }
  const posix = rel.split(sep).join("/");
  if (posix.length === 0) {
    return null;
  }
  const segments = posix.split("/");
  if (
    segments.some(
      (segment) =>
        NOISE_SEGMENTS.has(segment) || extraExcludes?.has(segment) === true
    )
  ) {
    return null;
  }
  return posix;
}

function mapEventType(
  root: string,
  path: string,
  eventType: string
): FileWatchChangeKind {
  const absolute = resolve(root, path);
  let exists = false;
  try {
    accessSync(absolute, constants.F_OK);
    exists = true;
  } catch {
    exists = false;
  }
  if (eventType === "rename") {
    return exists ? "created" : "deleted";
  }
  return exists ? "changed" : "deleted";
}

export function createFileWatchService(
  options: CreateFileWatchServiceOptions = {}
): FileWatchService {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const watchFn = options.fsWatch ?? fsWatch;
  const roots = new Map<string, RootEntry>();

  function flush(root: string, entry: RootEntry): void {
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    entry.firstPendingAt = null;
    if (entry.pending.size === 0) {
      return;
    }
    const changes: FileWatchChange[] = [...entry.pending.entries()].map(
      ([path, kind]) => ({ kind, path })
    );
    entry.pending.clear();
    const event: FileWatchEvent = { changes, root };
    for (const listener of entry.listeners) {
      listener(event);
    }
  }

  function scheduleFlush(root: string, entry: RootEntry): void {
    const now = Date.now();
    entry.firstPendingAt ??= now;
    const waited = now - entry.firstPendingAt;
    const delay =
      waited >= maxWaitMs ? 0 : Math.min(debounceMs, maxWaitMs - waited);
    if (entry.timer) {
      clearTimeout(entry.timer);
    }
    entry.timer = setTimeout(() => {
      flush(root, entry);
    }, delay);
  }

  function enqueue(
    root: string,
    entry: RootEntry,
    path: string,
    kind: FileWatchChangeKind
  ): void {
    entry.pending.set(path, kind);
    scheduleFlush(root, entry);
  }

  function startPollFallback(root: string, entry: RootEntry): void {
    if (entry.pollTimer) {
      return;
    }
    entry.pollTimer = setInterval(() => {
      // Polling fallback cannot invent precise path ops; emit a sentinel
      // changed event on "." so renderer can reload expanded roots.
      enqueue(root, entry, ".", "changed");
    }, pollMs);
  }

  function ensureWatcher(root: string, entry: RootEntry): void {
    if (entry.watcher) {
      return;
    }
    try {
      entry.watcher = watchFn(
        root,
        { recursive: true },
        (eventType, filename) => {
          if (filename == null) {
            return;
          }
          const name =
            typeof filename === "string" ? filename : String(filename);
          const path = toRootRelativePosix(root, name, entry.extraExcludes);
          if (!path) {
            return;
          }
          enqueue(root, entry, path, mapEventType(root, path, eventType));
        }
      );
      entry.watcher.on("error", () => {
        try {
          entry.watcher?.close();
        } catch {
          // ignore close errors during recovery
        }
        entry.watcher = null;
        startPollFallback(root, entry);
      });
    } catch {
      entry.watcher = null;
    }
    // 轮询只做兜底:fs.watch 正常时绝不发 "." 哨兵,否则 renderer 会每个
    // 周期无差别 reload root + 重读所有打开文档。
    if (!entry.watcher) {
      startPollFallback(root, entry);
    }
  }

  return {
    dispose() {
      for (const [root, entry] of roots) {
        if (entry.timer) {
          clearTimeout(entry.timer);
        }
        if (entry.pollTimer) {
          clearInterval(entry.pollTimer);
        }
        try {
          entry.watcher?.close();
        } catch {
          // ignore
        }
        roots.delete(root);
      }
    },
    watch(root, listener, options) {
      const resolvedRoot = resolve(root);
      let entry = roots.get(resolvedRoot);
      if (!entry) {
        entry = {
          extraExcludes: new Set(),
          firstPendingAt: null,
          listeners: new Set(),
          pending: new Map(),
          pollTimer: null,
          timer: null,
          watcher: null,
        };
        roots.set(resolvedRoot, entry);
        ensureWatcher(resolvedRoot, entry);
      }
      for (const exclude of options?.excludes ?? []) {
        if (exclude.length > 0 && !exclude.includes("/")) {
          entry.extraExcludes.add(exclude);
        }
      }
      entry.listeners.add(listener);
      return () => {
        const current = roots.get(resolvedRoot);
        if (!current) {
          return;
        }
        current.listeners.delete(listener);
        if (current.listeners.size > 0) {
          return;
        }
        if (current.timer) {
          clearTimeout(current.timer);
        }
        if (current.pollTimer) {
          clearInterval(current.pollTimer);
        }
        try {
          current.watcher?.close();
        } catch {
          // ignore
        }
        roots.delete(resolvedRoot);
      };
    },
  };
}

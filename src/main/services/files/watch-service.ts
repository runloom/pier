import { type FSWatcher, watch as fsWatch } from "node:fs";
import { access } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import type {
  FileWatchChange,
  FileWatchChangeKind,
  FileWatchEvent,
} from "@shared/contracts/file/watch.ts";
import { createLogger } from "@shared/logger.ts";

const log = createLogger("files.watch");

const DEFAULT_DEBOUNCE_MS = 250;
const DEFAULT_MAX_WAIT_MS = 1000;
const DEFAULT_POLL_MS = 5000;
/**
 * 兜底轮询退避上限。fs.watch 常驻失败时（递归 watch 建不起来、或运行中 error），
 * 每个轮询周期都会发一次 `.` 哨兵，renderer 收到就整树重载 —— 条目多的根上这是
 * 每周期一次的 O(全部条目) 同步工作。退避把无上限的持续开销压成低位心跳。
 */
export const FILE_WATCH_POLL_BACKOFF_MAX_MS = 60_000;
/** 一批 flush 里并行探测路径存在性的上限；批量 checkout / 安装不得挤满 libuv 线程池。 */
export const FILE_WATCH_PROBE_CONCURRENCY = 16;

const NOISE_SEGMENTS = new Set([
  ".git",
  "node_modules",
  ".DS_Store",
  "dist",
  "dist-electron",
  ".next",
  "coverage",
]);

/**
 * fs.watch 失败后重新尝试建立 watcher 的间隔。失败时轮询在退避中继续兜底；
 * 恢复成功后停轮询，避免 `.` 哨兵长期主导 renderer 的重载节奏。
 */
export const FILE_WATCH_RETRY_MS = 30_000;

export type FsWatchFn = (
  target: string,
  options: { recursive: boolean },
  listener: (eventType: string, filename: string | Buffer | null) => void
) => FSWatcher;

export type FileWatchPathExists = (absolutePath: string) => Promise<boolean>;

export interface CreateFileWatchServiceOptions {
  debounceMs?: number;
  fsWatch?: FsWatchFn;
  maxWaitMs?: number;
  /** 测试 seam；生产用异步 access，禁止在 fs.watch 回调里 sync stat。 */
  pathExists?: FileWatchPathExists;
  /** 首次轮询间隔；失败后按 2 倍退避，封顶 {@link FILE_WATCH_POLL_BACKOFF_MAX_MS}。 */
  pollMs?: number;
  /** 轮询期间重试建立 fs.watch 的间隔。 */
  retryMs?: number;
}

export interface FileWatchService {
  dispose(): void;
  watch(
    root: string,
    listener: (event: FileWatchEvent) => void,
    options?: { excludes?: readonly string[] }
  ): () => void;
}

interface RootListener {
  /** Client-provided root string; events are re-rooted so preload filters match. */
  clientRoot: string;
  listener: (event: FileWatchEvent) => void;
}

interface RootEntry {
  /** 额外排除段(全订阅方并集);命中即丢事件。 */
  extraExcludes: Set<string>;
  firstPendingAt: number | null;
  flushing: boolean;
  listeners: Set<RootListener>;
  /** path → 最近一次 fs.watch eventType（rename / change）。分类推迟到 flush。 */
  pending: Map<string, string>;
  /** 当前退避下的轮询间隔；首次用 pollMs，之后逐次翻倍。 */
  pollIntervalMs: number;
  pollTimer: ReturnType<typeof setTimeout> | null;
  resolvedRoot: string;
  /** 轮询期间重试建立 fs.watch 的定时器。 */
  retryTimer: ReturnType<typeof setTimeout> | null;
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

async function defaultPathExists(absolutePath: string): Promise<boolean> {
  try {
    await access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

async function mapEventType(
  root: string,
  path: string,
  eventType: string,
  pathExists: FileWatchPathExists
): Promise<FileWatchChangeKind> {
  if (path === ".") {
    return "changed";
  }
  const exists = await pathExists(resolve(root, path));
  if (eventType === "rename") {
    return exists ? "created" : "deleted";
  }
  return exists ? "changed" : "deleted";
}

/** 按入队顺序分类一批 pending 事件，同时在途探测不超过 FILE_WATCH_PROBE_CONCURRENCY。 */
async function classifyPending(
  root: string,
  snapshot: readonly (readonly [path: string, eventType: string])[],
  pathExists: FileWatchPathExists
): Promise<FileWatchChange[]> {
  const changes = new Array<FileWatchChange>(snapshot.length);
  let cursor = 0;
  await Promise.all(
    Array.from(
      { length: Math.min(FILE_WATCH_PROBE_CONCURRENCY, snapshot.length) },
      async () => {
        while (cursor < snapshot.length) {
          const index = cursor;
          cursor += 1;
          const item = snapshot[index];
          if (!item) {
            return;
          }
          const [path, eventType] = item;
          changes[index] = {
            kind: await mapEventType(root, path, eventType, pathExists),
            path,
          };
        }
      }
    )
  );
  return changes;
}

export function createFileWatchService(
  options: CreateFileWatchServiceOptions = {}
): FileWatchService {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const retryMs = options.retryMs ?? FILE_WATCH_RETRY_MS;
  const watchFn = options.fsWatch ?? fsWatch;
  const pathExists = options.pathExists ?? defaultPathExists;
  const roots = new Map<string, RootEntry>();

  async function flush(entry: RootEntry): Promise<void> {
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    if (entry.pending.size === 0) {
      entry.firstPendingAt = null;
      return;
    }
    if (entry.flushing) {
      // 在途 flush 结束后由其 finally 重新排程；保留 firstPendingAt，
      // 否则持续写入期间 maxWait 会被每次到期的 debounce 重置而永不兜底。
      return;
    }
    entry.firstPendingAt = null;
    entry.flushing = true;
    const snapshot = [...entry.pending.entries()];
    entry.pending.clear();
    try {
      const changes = await classifyPending(
        entry.resolvedRoot,
        snapshot,
        pathExists
      );
      if (entry.listeners.size === 0) {
        return;
      }
      // Emit with each subscriber's original root string. Main resolves paths for
      // fs.watch only; renderer preload filters by the root it subscribed with
      // (often realpath'd projectRoot). Using resolvedRoot here silently dropped
      // every event when the two strings differed (trailing form, etc.).
      for (const entryListener of entry.listeners) {
        entryListener.listener({ changes, root: entryListener.clientRoot });
      }
    } finally {
      entry.flushing = false;
      if (entry.pending.size > 0 && entry.listeners.size > 0) {
        scheduleFlush(entry);
      }
    }
  }

  function scheduleFlush(entry: RootEntry): void {
    const now = Date.now();
    entry.firstPendingAt ??= now;
    const waited = now - entry.firstPendingAt;
    const delay =
      waited >= maxWaitMs ? 0 : Math.min(debounceMs, maxWaitMs - waited);
    if (entry.timer) {
      clearTimeout(entry.timer);
    }
    entry.timer = setTimeout(() => {
      flush(entry).catch(() => undefined);
    }, delay);
  }

  function enqueue(entry: RootEntry, path: string, eventType: string): void {
    entry.pending.set(path, eventType);
    scheduleFlush(entry);
  }

  /** 在退避中重启一次轮询；间隔逐次翻倍到上限。 */
  function scheduleNextPoll(entry: RootEntry): void {
    if (entry.listeners.size === 0) {
      return;
    }
    entry.pollTimer = setTimeout(() => {
      entry.pollTimer = null;
      if (entry.listeners.size === 0) {
        return;
      }
      // Polling fallback cannot invent precise path ops; emit a sentinel
      // changed event on "." so renderer can reload expanded roots.
      enqueue(entry, ".", "change");
      entry.pollIntervalMs = Math.min(
        entry.pollIntervalMs * 2,
        FILE_WATCH_POLL_BACKOFF_MAX_MS
      );
      scheduleNextPoll(entry);
    }, entry.pollIntervalMs);
  }

  function startPollFallback(root: string, entry: RootEntry): void {
    if (entry.listeners.size === 0) {
      return;
    }
    if (entry.pollTimer !== null || entry.retryTimer !== null) {
      return;
    }
    log.warn("fs-watch-unavailable; falling back to polling", {
      pollMs: entry.pollIntervalMs,
      retryMs,
      root,
    });
    scheduleNextPoll(entry);
    // fs.watch 可能只是暂时失败（句柄耗尽、FSEvents 资源紧张）。持续重试，
    // 成功即停轮询 —— 否则 `.` 哨兵会长期以最高频率主导 renderer 重载。
    entry.retryTimer = setTimeout(function retryWatcher(): void {
      entry.retryTimer = null;
      if (entry.listeners.size === 0) {
        return;
      }
      if (ensureWatcher(root, entry)) {
        stopPollFallback(entry);
        // 下次失败重新从首档开始，不继承上一轮已经涨到的退避档位。
        entry.pollIntervalMs = pollMs;
        log.info("fs-watch-recovered; polling stopped", { root });
        return;
      }
      entry.retryTimer = setTimeout(retryWatcher, retryMs);
    }, retryMs);
  }

  function stopPollFallback(entry: RootEntry): void {
    if (entry.pollTimer !== null) {
      clearTimeout(entry.pollTimer);
      entry.pollTimer = null;
    }
    if (entry.retryTimer !== null) {
      clearTimeout(entry.retryTimer);
      entry.retryTimer = null;
    }
  }

  /** 建立（或重建）递归 watcher；返回是否成功。 */
  function ensureWatcher(root: string, entry: RootEntry): boolean {
    if (entry.watcher) {
      return true;
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
          enqueue(entry, path, eventType);
        }
      );
      entry.watcher.on("error", (error: unknown) => {
        log.warn("fs-watch-error; falling back to polling", {
          message: error instanceof Error ? error.message : String(error),
          root,
        });
        try {
          entry.watcher?.close();
        } catch {
          // ignore close errors during recovery
        }
        entry.watcher = null;
        startPollFallback(root, entry);
      });
      return true;
    } catch (error) {
      log.warn("fs-watch-start-failed; falling back to polling", {
        message: error instanceof Error ? error.message : String(error),
        root,
      });
      entry.watcher = null;
      return false;
    }
  }

  return {
    dispose() {
      for (const [root, entry] of roots) {
        if (entry.timer) {
          clearTimeout(entry.timer);
        }
        stopPollFallback(entry);
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
          flushing: false,
          listeners: new Set(),
          pending: new Map(),
          pollIntervalMs: pollMs,
          pollTimer: null,
          resolvedRoot,
          retryTimer: null,
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
      const rootListener: RootListener = { clientRoot: root, listener };
      entry.listeners.add(rootListener);
      // 订阅建立后才启动兜底轮询：enqueue 需要至少一个 listener 才有意义。
      if (
        !entry.watcher &&
        entry.pollTimer === null &&
        entry.retryTimer === null
      ) {
        startPollFallback(resolvedRoot, entry);
      }
      return () => {
        const current = roots.get(resolvedRoot);
        if (!current) {
          return;
        }
        current.listeners.delete(rootListener);
        if (current.listeners.size > 0) {
          return;
        }
        if (current.timer) {
          clearTimeout(current.timer);
        }
        stopPollFallback(current);
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

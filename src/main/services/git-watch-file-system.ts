import type { Stats } from "node:fs";
import { access, lstat, readFile, realpath } from "node:fs/promises";

const FILE_SYSTEM_PROBE_TIMEOUT_MS = 1500;
const MAX_PENDING_FILE_SYSTEM_PROBES = 1024;
const MAX_PENDING_STAT_ROOTS = 128;
const MAX_ACTIVE_STAT_PROBES = 32;

type StatProbe = (
  path: string
) => Promise<{ readonly mtimeMs: number; readonly size: number }>;

interface ProbeContext {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export interface WatchFileSystemProbe<T> {
  readonly result: Promise<T>;
  /** 不受调用方 abort/timeout 影响，只在真实底层 Promise 结算后完成。 */
  readonly settled: Promise<void>;
}

const accessProbes = new Map<string, Promise<unknown>>();
const lstatProbes = new Map<string, Promise<unknown>>();
const readFileProbes = new Map<string, Promise<unknown>>();
const realpathProbes = new Map<string, Promise<unknown>>();
const statBatchesByProbe = new WeakMap<
  StatProbe,
  Map<string, Promise<unknown>>
>();
const activeStatProbes = new Set<Promise<unknown>>();

class ProbeUnavailableError extends Error {}

function trackSharedProbe<T>(
  pending: Map<string, Promise<unknown>>,
  key: string,
  operation: () => Promise<T>,
  capacity: number
): Promise<T> {
  const existing = pending.get(key);
  if (existing) {
    return existing as Promise<T>;
  }
  if (pending.size >= capacity) {
    throw new ProbeUnavailableError();
  }
  const raw = Promise.resolve().then(operation);
  pending.set(key, raw);
  const release = () => {
    if (pending.get(key) === raw) {
      pending.delete(key);
    }
  };
  raw.then(release, release).catch(() => undefined);
  return raw;
}

function trackExclusiveProbe<T>(
  pending: Map<string, Promise<unknown>>,
  key: string,
  operation: () => Promise<T>,
  capacity: number
): Promise<T> {
  if (pending.has(key) || pending.size >= capacity) {
    throw new ProbeUnavailableError();
  }
  return trackSharedProbe(pending, key, operation, capacity);
}

async function waitForProbe<T>(
  raw: Promise<T>,
  { signal, timeoutMs = FILE_SYSTEM_PROBE_TIMEOUT_MS }: ProbeContext
): Promise<T> {
  if (signal?.aborted) {
    throw new ProbeUnavailableError();
  }
  let timeout: NodeJS.Timeout | undefined;
  let removeAbortListener = (): void => undefined;
  const interrupted = new Promise<never>((_resolve, reject) => {
    const interrupt = () => reject(new ProbeUnavailableError());
    if (signal) {
      signal.addEventListener("abort", interrupt, { once: true });
      removeAbortListener = () =>
        signal.removeEventListener("abort", interrupt);
    }
    timeout = setTimeout(interrupt, timeoutMs);
  });
  try {
    return await Promise.race([raw, interrupted]);
  } finally {
    clearTimeout(timeout);
    removeAbortListener();
  }
}

async function runProbe<T>(
  pending: Map<string, Promise<unknown>>,
  key: string,
  operation: () => Promise<T>,
  context: ProbeContext
): Promise<T> {
  if (context.signal?.aborted) {
    throw new ProbeUnavailableError();
  }
  const raw = trackSharedProbe(
    pending,
    key,
    operation,
    MAX_PENDING_FILE_SYSTEM_PROBES
  );
  return await waitForProbe(raw, context);
}

function createProbe<T>(
  pending: Map<string, Promise<unknown>>,
  key: string,
  operation: () => Promise<T>,
  context: ProbeContext
): WatchFileSystemProbe<T> {
  if (context.signal?.aborted) {
    const result = Promise.reject<T>(new ProbeUnavailableError());
    result.catch(() => undefined);
    return { result, settled: Promise.resolve() };
  }
  const raw = trackSharedProbe(
    pending,
    key,
    operation,
    MAX_PENDING_FILE_SYSTEM_PROBES
  );
  return {
    result: waitForProbe(raw, context),
    settled: raw.then(
      () => undefined,
      () => undefined
    ),
  };
}

/** 跨仓库共享的原始 stat 上限；调用方超时不释放底层槽位，直到真实 Promise 结算。 */
export function runChangedFileStatProbe<T>(
  operation: () => Promise<T>
): Promise<T> | null {
  if (activeStatProbes.size >= MAX_ACTIVE_STAT_PROBES) {
    return null;
  }
  const raw = Promise.resolve().then(operation);
  activeStatProbes.add(raw);
  const release = () => activeStatProbes.delete(raw);
  raw.then(release, release).catch(() => undefined);
  return raw;
}

export function watchAccess(
  path: string,
  context: ProbeContext = {}
): Promise<void> {
  return runProbe(accessProbes, path, () => access(path), context);
}

export function watchLstat(
  path: string,
  context: ProbeContext = {}
): Promise<Stats> {
  return runProbe(lstatProbes, path, () => lstat(path), context);
}

export function watchReadText(
  path: string,
  context: ProbeContext = {}
): Promise<string> {
  return runProbe(
    readFileProbes,
    path,
    // 原始 Promise 按路径跨调用方共享，不能由首个调用方的 signal 所有；
    // 每个调用方只在 waitForProbe 中独立取消，底层读取真实结算后才释放共享槽位。
    () => readFile(path, { encoding: "utf8" }),
    context
  );
}

export async function watchRealpath(
  path: string,
  context: ProbeContext = {}
): Promise<string> {
  return await watchRealpathProbe(path, context).result;
}

export function watchRealpathProbe(
  path: string,
  context: ProbeContext = {}
): WatchFileSystemProbe<string> {
  return createProbe(realpathProbes, path, () => realpath(path), context);
}

/**
 * 同一 Git 根上一批迟到 stat 未结算时不再派发新批次；故障文件系统下跨轮次
 * 仍只保留最初的 16 个底层调用。不同注入 stat 函数隔离，便于黑盒验证。
 */
export async function runChangedFileStatBatch(
  gitRoot: string,
  stat: StatProbe,
  operation: () => Promise<void>,
  context: ProbeContext = {}
): Promise<"completed" | "unavailable"> {
  if (context.signal?.aborted) {
    return "unavailable";
  }
  let pending = statBatchesByProbe.get(stat);
  if (!pending) {
    pending = new Map();
    statBatchesByProbe.set(stat, pending);
  }
  try {
    const raw = trackExclusiveProbe(
      pending,
      gitRoot,
      operation,
      MAX_PENDING_STAT_ROOTS
    );
    await waitForProbe(raw, context);
    return "completed";
  } catch {
    return "unavailable";
  }
}

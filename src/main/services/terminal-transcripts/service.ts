import { createReadStream, createWriteStream } from "node:fs";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip, gunzipSync } from "node:zlib";
import { TranscriptSegmentWriter } from "./writer.ts";

export const TRANSCRIPT_GLOBAL_QUOTA_BYTES = 512 * 1024 * 1024;
export const TRANSCRIPT_QUOTA_SWEEP_INTERVAL_MS = 10 * 60_000;

export interface TerminalTranscriptsServiceOptions {
  globalQuotaBytes?: number;
  logger?: { warn(...values: unknown[]): void };
  maxQueueBytes?: number;
  maxSegmentBytes?: number;
  rootDir: string;
  sweepIntervalMs?: number;
}

export interface TerminalTranscriptLifecycleInfo {
  bytes: number;
  id: string;
  lastModifiedMs: number;
  live: boolean;
}

const SEGMENT_RE = /^\d{6}\.log(?:\.gz)?$/u;

/** lifecycle 目录名：剥路径分隔符，并拒绝 `.` / `..` 逃逸根目录。 */
export function sanitizeTranscriptLifecycleId(lifecycleId: string): string {
  const cleaned = lifecycleId.replace(/[^A-Za-z0-9._-]/gu, "_");
  if (cleaned === "" || cleaned === "." || cleaned === "..") {
    return `_${cleaned || "empty"}`;
  }
  return cleaned;
}

/**
 * 终端 transcript 分段落盘服务（历史三层化的 Tier 2）：
 * - 每个 lifecycle 一个目录，段文件 append-only，封段后 gzip；
 * - 全局磁盘配额 + LRU（按目录 mtime）淘汰非活体 lifecycle；
 * - 读路径按段倒序取尾部（历史查看 / 任务输出 replay 用）。
 */
export function createTerminalTranscriptsService(
  options: TerminalTranscriptsServiceOptions
) {
  const rootDir = options.rootDir;
  const quotaBytes = options.globalQuotaBytes ?? TRANSCRIPT_GLOBAL_QUOTA_BYTES;
  const writers = new Map<string, TranscriptSegmentWriter>();
  const nativeLive = new Set<string>();
  let sweepTimer: ReturnType<typeof setInterval> | null = null;
  let disposed = false;

  function dirFor(lifecycleId: string): string {
    return join(rootDir, sanitizeTranscriptLifecycleId(lifecycleId));
  }

  function markNativeLive(lifecycleId: string): void {
    if (disposed || lifecycleId.length === 0) {
      return;
    }
    nativeLive.add(sanitizeTranscriptLifecycleId(lifecycleId));
  }

  function unmarkNativeLive(lifecycleId: string): void {
    nativeLive.delete(sanitizeTranscriptLifecycleId(lifecycleId));
  }

  function append(lifecycleId: string, text: string): void {
    if (disposed) {
      return;
    }
    const key = sanitizeTranscriptLifecycleId(lifecycleId);
    let writer = writers.get(key);
    if (!writer) {
      writer = new TranscriptSegmentWriter({
        dir: join(rootDir, key),
        ...(options.logger ? { logger: options.logger } : {}),
        ...(options.maxQueueBytes === undefined
          ? {}
          : { maxQueueBytes: options.maxQueueBytes }),
        ...(options.maxSegmentBytes === undefined
          ? {}
          : { maxSegmentBytes: options.maxSegmentBytes }),
      });
      writers.set(key, writer);
    }
    writer.append(text);
  }

  async function seal(lifecycleId: string): Promise<void> {
    const key = sanitizeTranscriptLifecycleId(lifecycleId);
    const writer = writers.get(key);
    if (!writer) {
      return;
    }
    writers.delete(key);
    await writer.seal();
  }

  async function listSegmentFiles(lifecycleId: string): Promise<string[]> {
    const dir = dirFor(lifecycleId);
    try {
      const entries = await readdir(dir);
      return entries.filter((name) => SEGMENT_RE.test(name)).sort();
    } catch {
      return [];
    }
  }

  async function readSegmentText(
    lifecycleId: string,
    name: string
  ): Promise<string> {
    const raw = await readFile(join(dirFor(lifecycleId), name));
    if (name.endsWith(".gz")) {
      return gunzipSync(raw).toString("utf8");
    }
    return raw.toString("utf8");
  }

  /**
   * 从末段向前拼接，最多 maxBytes（UTF-8 未压缩字节）。
   * `truncated` 按未压缩体积判定，不能用 gzip 磁盘大小。
   */
  async function readTail(
    lifecycleId: string,
    maxBytes: number
  ): Promise<{
    text: string;
    totalUncompressedBytes: number;
    truncated: boolean;
  }> {
    const segments = await listSegmentFiles(lifecycleId);
    const parts: string[] = [];
    let total = 0;
    let oldestReadIndex = segments.length;
    for (let index = segments.length - 1; index >= 0; index -= 1) {
      const name = segments[index];
      if (!name) {
        continue;
      }
      let text: string;
      try {
        text = await readSegmentText(lifecycleId, name);
      } catch {
        continue;
      }
      parts.unshift(text);
      total += Buffer.byteLength(text, "utf8");
      oldestReadIndex = index;
      if (total >= maxBytes) {
        break;
      }
    }
    let joined = parts.join("");
    const uncompressedRead = Buffer.byteLength(joined, "utf8");
    while (Buffer.byteLength(joined, "utf8") > maxBytes && joined.length > 0) {
      const overshootChars = Math.max(
        1,
        Math.floor((Buffer.byteLength(joined, "utf8") - maxBytes) / 4)
      );
      joined = joined.slice(overshootChars);
    }
    return {
      text: joined,
      totalUncompressedBytes: uncompressedRead,
      truncated: oldestReadIndex > 0 || uncompressedRead > maxBytes,
    };
  }

  async function readTailText(
    lifecycleId: string,
    maxBytes: number
  ): Promise<string> {
    return (await readTail(lifecycleId, maxBytes)).text;
  }

  async function listLifecycles(): Promise<TerminalTranscriptLifecycleInfo[]> {
    let entries: string[];
    try {
      entries = await readdir(rootDir);
    } catch {
      return [];
    }
    const infos: TerminalTranscriptLifecycleInfo[] = [];
    for (const id of entries) {
      const dir = join(rootDir, id);
      try {
        const dirStat = await stat(dir);
        if (!dirStat.isDirectory()) {
          continue;
        }
        let bytes = 0;
        let lastModifiedMs = dirStat.mtimeMs;
        for (const name of await readdir(dir)) {
          if (!SEGMENT_RE.test(name)) {
            continue;
          }
          const fileStat = await stat(join(dir, name));
          bytes += fileStat.size;
          lastModifiedMs = Math.max(lastModifiedMs, fileStat.mtimeMs);
        }
        infos.push({
          bytes,
          id,
          lastModifiedMs,
          live: writers.has(id) || nativeLive.has(id),
        });
      } catch {
        // 目录并发删除等竞态：跳过。
      }
    }
    return infos;
  }

  /**
   * 冷段压缩：native tap 写的原始段不自压缩（写端保持最小）；这里把
   * 「非本进程活体、且不是目录内最后一段」的 .log 压成 .gz。最后一段
   * 可能仍被 native 追加，跳过。
   */
  async function compressColdSegments(): Promise<void> {
    for (const info of await listLifecycles()) {
      if (info.live) {
        continue;
      }
      const dir = join(rootDir, info.id);
      let names: string[];
      try {
        names = (await readdir(dir))
          .filter((name) => SEGMENT_RE.test(name))
          .sort();
      } catch {
        continue;
      }
      const last = names.at(-1);
      for (const name of names) {
        if (name === last || name.endsWith(".gz")) {
          continue;
        }
        const rawPath = join(dir, name);
        try {
          await pipeline(
            createReadStream(rawPath),
            createGzip(),
            createWriteStream(`${rawPath}.gz`)
          );
          await rm(rawPath, { force: true });
        } catch (error) {
          await rm(`${rawPath}.gz`, { force: true }).catch(() => undefined);
          options.logger?.warn(
            "[terminal-transcripts] cold segment gzip failed",
            { error, rawPath }
          );
        }
      }
    }
  }

  /** 超配额时按 mtime 从旧到新删除非活体 lifecycle 目录。 */
  async function enforceQuota(): Promise<void> {
    const infos = await listLifecycles();
    let total = infos.reduce((sum, info) => sum + info.bytes, 0);
    if (total <= quotaBytes) {
      return;
    }
    const victims = infos
      .filter((info) => !info.live)
      .sort((left, right) => left.lastModifiedMs - right.lastModifiedMs);
    for (const victim of victims) {
      if (total <= quotaBytes) {
        break;
      }
      try {
        await rm(join(rootDir, victim.id), { force: true, recursive: true });
        total -= victim.bytes;
      } catch (error) {
        options.logger?.warn("[terminal-transcripts] quota eviction failed", {
          error,
          lifecycleId: victim.id,
        });
      }
    }
  }

  function start(): void {
    if (sweepTimer || disposed) {
      return;
    }
    sweepTimer = setInterval(() => {
      compressColdSegments()
        .then(() => enforceQuota())
        .catch(() => undefined);
    }, options.sweepIntervalMs ?? TRANSCRIPT_QUOTA_SWEEP_INTERVAL_MS);
    sweepTimer.unref?.();
  }

  async function dispose(): Promise<void> {
    disposed = true;
    if (sweepTimer) {
      clearInterval(sweepTimer);
      sweepTimer = null;
    }
    const sealing = [...writers.values()].map((writer) => writer.seal());
    writers.clear();
    nativeLive.clear();
    await Promise.all(sealing);
  }

  return {
    append,
    compressColdSegments,
    dispose,
    enforceQuota,
    listLifecycles,
    listSegmentFiles,
    markNativeLive,
    readSegmentText,
    readTail,
    readTailText,
    rootDir,
    seal,
    start,
    unmarkNativeLive,
  };
}

export type TerminalTranscriptsService = ReturnType<
  typeof createTerminalTranscriptsService
>;

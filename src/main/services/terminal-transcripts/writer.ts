import { createReadStream, createWriteStream } from "node:fs";
import { type FileHandle, mkdir, open, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";

export const TRANSCRIPT_SEGMENT_MAX_BYTES = 8 * 1024 * 1024;
export const TRANSCRIPT_QUEUE_MAX_BYTES = 4 * 1024 * 1024;
/** 队列溢出丢弃时写入的标记（供历史查看器识别缺口）。 */
export const TRANSCRIPT_DROP_MARKER_PREFIX = "\n[pier] transcript gap: ";

export interface TranscriptSegmentWriterOptions {
  dir: string;
  logger?: { warn(...values: unknown[]): void };
  maxQueueBytes?: number;
  maxSegmentBytes?: number;
}

function segmentName(index: number): string {
  return `${String(index).padStart(6, "0")}.log`;
}

const SEGMENT_INDEX_RE = /^(\d{6})\.log(?:\.gz)?$/u;

async function highestExistingSegmentIndex(dir: string): Promise<number> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return 0;
  }
  let highest = 0;
  for (const name of names) {
    const match = SEGMENT_INDEX_RE.exec(name);
    if (!match) {
      continue;
    }
    const index = Number.parseInt(match[1] ?? "", 10);
    if (Number.isFinite(index)) {
      highest = Math.max(highest, index);
    }
  }
  return highest;
}

/**
 * 单 lifecycle 的分段转录写入器：append-only、纵向切段、封段后 gzip。
 *
 * 有界性约束（治理测试锁定）：
 * - 内存队列上限 `maxQueueBytes`，溢出丢弃整段积压并写缺口标记，
 *   append 调用方（输出热路径）永不阻塞、永不失败；
 * - 单段上限 `maxSegmentBytes`，超限轮转；旧段 gzip 后删除原始文件。
 */
export class TranscriptSegmentWriter {
  readonly #dir: string;
  readonly #maxQueueBytes: number;
  readonly #maxSegmentBytes: number;
  readonly #logger: { warn(...values: unknown[]): void } | undefined;
  #queue: string[] = [];
  #queuedBytes = 0;
  #droppedBytes = 0;
  #flushing = false;
  #closed = false;
  #handle: FileHandle | null = null;
  #segmentIndex = 0;
  #segmentBytes = 0;
  #pending: Promise<void> = Promise.resolve();

  constructor(options: TranscriptSegmentWriterOptions) {
    this.#dir = options.dir;
    this.#maxQueueBytes = options.maxQueueBytes ?? TRANSCRIPT_QUEUE_MAX_BYTES;
    this.#maxSegmentBytes =
      options.maxSegmentBytes ?? TRANSCRIPT_SEGMENT_MAX_BYTES;
    this.#logger = options.logger;
  }

  get queuedBytes(): number {
    return this.#queuedBytes;
  }

  get droppedBytes(): number {
    return this.#droppedBytes;
  }

  /** 输出热路径：只入队并调度异步刷盘，永不阻塞、永不抛错。 */
  append(text: string): void {
    if (this.#closed || text.length === 0) {
      return;
    }
    const bytes = Buffer.byteLength(text, "utf8");
    if (this.#queuedBytes + bytes > this.#maxQueueBytes) {
      // 磁盘跟不上：丢弃全部积压，写缺口标记；宁丢历史不背压输出源。
      const dropped = this.#queuedBytes + bytes;
      this.#droppedBytes += dropped;
      this.#queue = [
        `${TRANSCRIPT_DROP_MARKER_PREFIX}${dropped} bytes dropped\n`,
      ];
      this.#queuedBytes = Buffer.byteLength(this.#queue[0] ?? "", "utf8");
      this.#logger?.warn("[terminal-transcripts] queue overflow", {
        dir: this.#dir,
        droppedBytes: dropped,
      });
    } else {
      this.#queue.push(text);
      this.#queuedBytes += bytes;
    }
    this.#scheduleFlush();
  }

  /** 刷完队列、封当前段并 gzip。之后 append 变 no-op。 */
  seal(): Promise<void> {
    if (this.#closed) {
      return this.#pending;
    }
    this.#closed = true;
    this.#pending = this.#pending.then(async () => {
      await this.#drainQueue();
      await this.#sealCurrentSegment();
    });
    return this.#pending;
  }

  #scheduleFlush(): void {
    if (this.#flushing || this.#closed) {
      return;
    }
    this.#flushing = true;
    this.#pending = this.#pending
      .then(() => this.#drainQueue())
      .catch((error: unknown) => {
        this.#logger?.warn("[terminal-transcripts] flush failed", {
          dir: this.#dir,
          error,
        });
      })
      .finally(() => {
        this.#flushing = false;
        if (this.#queuedBytes > 0 && !this.#closed) {
          this.#scheduleFlush();
        }
      });
  }

  async #drainQueue(): Promise<void> {
    while (this.#queue.length > 0) {
      const batch = this.#queue;
      this.#queue = [];
      this.#queuedBytes = 0;
      const text = batch.join("");
      const bytes = Buffer.from(text, "utf8");
      let offset = 0;
      while (offset < bytes.byteLength) {
        const handle = await this.#ensureHandle();
        const room = this.#maxSegmentBytes - this.#segmentBytes;
        const take = Math.min(room, bytes.byteLength - offset);
        await handle.write(bytes.subarray(offset, offset + take));
        this.#segmentBytes += take;
        offset += take;
        if (this.#segmentBytes >= this.#maxSegmentBytes) {
          await this.#sealCurrentSegment();
        }
      }
    }
  }

  async #ensureHandle(): Promise<FileHandle> {
    if (this.#handle) {
      return this.#handle;
    }
    await mkdir(this.#dir, { recursive: true });
    if (this.#segmentIndex === 0) {
      // 进程重启后续写：从已有最大段号之后开新段，避免把下一轮 8MB
      // 追加进已经封满（或即将超限）的 000001.log。
      this.#segmentIndex = await highestExistingSegmentIndex(this.#dir);
    }
    this.#segmentIndex += 1;
    this.#segmentBytes = 0;
    this.#handle = await open(
      join(this.#dir, segmentName(this.#segmentIndex)),
      "a"
    );
    return this.#handle;
  }

  async #sealCurrentSegment(): Promise<void> {
    const handle = this.#handle;
    if (!handle) {
      return;
    }
    this.#handle = null;
    await handle.close();
    const rawPath = join(this.#dir, segmentName(this.#segmentIndex));
    try {
      await pipeline(
        createReadStream(rawPath),
        createGzip(),
        createWriteStream(`${rawPath}.gz`)
      );
      await rm(rawPath, { force: true });
    } catch (error) {
      // 压缩失败保留原始段（读取路径两种后缀都认）。
      this.#logger?.warn("[terminal-transcripts] segment gzip failed", {
        error,
        rawPath,
      });
      await rm(`${rawPath}.gz`, { force: true });
    }
  }
}

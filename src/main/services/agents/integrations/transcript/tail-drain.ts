import { open } from "node:fs/promises";
import { createLogger } from "@shared/logger.ts";
import type {
  TranscriptTailReconcilerConfig,
  TranscriptTerminalRecord,
} from "./tail-contracts.ts";
import {
  fileIdentity,
  MAX_READ_BYTES,
  type TranscriptEntry,
} from "./tail-entry.ts";
import { resolveTranscriptPath, statTranscriptFile } from "./tail-path.ts";
import { processTranscriptLine } from "./tail-process.ts";
import { retainPromptWatermarksForFile } from "./tail-watermark.ts";

const log = createLogger("agents.transcript");

export function createTranscriptDrainScheduler(options: {
  config: TranscriptTailReconcilerConfig;
  createLineClassifier: (
    path: string
  ) => (line: string) => TranscriptTerminalRecord | null;
  hasPendingPrompt: (path: string) => boolean;
  isCurrentEntry: (path: string, entry: TranscriptEntry) => boolean;
  isDisposed: () => boolean;
}): (path: string, entry: TranscriptEntry) => void {
  function scheduleDrain(path: string, entry: TranscriptEntry): void {
    if (options.isDisposed() || entry.disposed) return;
    if (entry.processing) {
      entry.pending = true;
      return;
    }
    if (entry.retryTimer) return;
    entry.processing = true;
    drainTranscript(path, entry, {
      ...options,
      hasPendingPrompt: () => options.hasPendingPrompt(path),
    })
      .catch((error: unknown) => {
        entry.pending = false;
        if (options.isDisposed() || entry.disposed) return;
        if (entry.retryDelayMs === 250) {
          // Internal compatibility diagnostics; never expose transcript paths or text.
          log.warn("read-failed", {
            agent: options.config.agent,
            code:
              error && typeof error === "object" && "code" in error
                ? String(error.code)
                : "unknown",
            phase: "read",
            retry: true,
          });
        }
        entry.retryTimer = setTimeout(() => {
          entry.retryTimer = null;
          scheduleDrain(path, entry);
        }, entry.retryDelayMs);
        entry.retryTimer.unref();
        entry.retryDelayMs = Math.min(entry.retryDelayMs * 2, 5000);
      })
      .finally(() => {
        entry.processing = false;
        if (
          !(options.isDisposed() || entry.disposed) &&
          entry.pending &&
          options.isCurrentEntry(path, entry)
        ) {
          scheduleDrain(path, entry);
        }
      });
  }
  return scheduleDrain;
}

export async function drainTranscript(
  path: string,
  entry: TranscriptEntry,
  options: {
    config: TranscriptTailReconcilerConfig;
    createLineClassifier: (
      path: string
    ) => (line: string) => TranscriptTerminalRecord | null;
    hasPendingPrompt: () => boolean;
    isDisposed: () => boolean;
  }
): Promise<void> {
  const { config } = options;
  do {
    entry.pending = false;
    const observed = await statTranscriptFile(path);
    if (observed === null) throw new Error("transcript stat unavailable");
    if (!observed?.isFile()) continue;
    // A same-path rename or symlink replacement must pass the root check again.
    const resolution = await resolveTranscriptPath(path, entry.root);
    if (!resolution) continue;
    const fd = await open(resolution.path, "r");
    let chunk: Buffer;
    let size: number;
    try {
      // Use the opened file's identity; replacement may race the path lookup.
      const current = await fd.stat();
      if (!current.isFile()) continue;
      size = current.size;
      const identity = fileIdentity(current);
      const replaced =
        entry.fileIdentity !== undefined && entry.fileIdentity !== identity;
      if (replaced || size < entry.offset) {
        entry.initialScanEnd = size;
        entry.offset = Math.max(0, size - MAX_READ_BYTES);
        entry.classifyLine = options.createLineClassifier(path);
        entry.pendingRecords.length = 0;
        if (!replaced) {
          entry.promptWatermarkByScope.clear();
          entry.promptFileIdentityByScope.clear();
        }
        // Keep delivered native-ID dedupe across generations. Anonymous history
        // cannot use an old generation's owner watermark to settle current work.
      }
      if (entry.fileIdentity !== identity) {
        retainPromptWatermarksForFile(
          entry.promptWatermarkByScope,
          entry.promptFileIdentityByScope,
          identity
        );
      }
      entry.fileIdentity = identity;
      if (entry.initialScanEnd === null) {
        entry.initialScanEnd = size;
        entry.offset = Math.max(0, size - MAX_READ_BYTES);
      }
      if (size === entry.offset) continue;
      chunk = Buffer.alloc(Math.min(size - entry.offset, MAX_READ_BYTES));
      const result = await fd.read(chunk, 0, chunk.length, entry.offset);
      chunk = chunk.subarray(0, result.bytesRead);
    } finally {
      await fd.close();
    }
    // A PromptSubmit awaiting its stat owns the boundary before any line drains.
    if (options.hasPendingPrompt()) {
      entry.pending = false;
      return;
    }
    const lastNewline = chunk.lastIndexOf(0x0a);
    if (lastNewline === -1) {
      if (chunk.length >= MAX_READ_BYTES) {
        entry.offset += chunk.length;
        entry.pending = true;
      }
      continue;
    }
    const consumed = chunk.subarray(0, lastNewline + 1);
    const chunkStart = entry.offset;
    entry.offset += consumed.length;
    let lineStart = 0;
    for (let index = 0; index < consumed.length; index += 1) {
      if (consumed[index] !== 0x0a) continue;
      const line = consumed.subarray(lineStart, index).toString("utf8");
      const lineEnd = chunkStart + index + 1;
      processTranscriptLine({
        allowOwnerFallback: lineEnd > entry.initialScanEnd,
        classifyTitleLine: config.classifyTitleLine,
        disposed: options.isDisposed(),
        entry,
        line,
        lineEnd,
        onTerminalEvent: config.onTerminalEvent,
        onTitleRecord: config.onTitleRecord,
      });
      lineStart = index + 1;
    }
    if (entry.offset < size) entry.pending = true;
  } while (!(options.isDisposed() || entry.disposed) && entry.pending);
  entry.retryDelayMs = 250;
}

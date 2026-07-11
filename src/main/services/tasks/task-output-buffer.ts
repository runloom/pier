import type {
  TaskOutputChunk,
  TaskOutputStream,
  TaskOutputUpdate,
} from "@shared/contracts/tasks.ts";

const DEFAULT_MAX_CHARS = 1_000_000;
const DEFAULT_MAX_CHUNKS = 2000;
const DEFAULT_RETAINED_OUTPUTS = 100;
const PUBLISH_DELAY_MS = 32;

interface OutputRecord {
  charCount: number;
  chunks: TaskOutputChunk[];
  pending: TaskOutputChunk[];
  runId: string;
  taskId: string;
  timer?: ReturnType<typeof setTimeout> | undefined;
  truncated: boolean;
  updatedAt: number;
  version: number;
  windowId?: string | undefined;
}

export interface TaskOutputBuffer {
  append(
    runId: string,
    taskId: string,
    stream: TaskOutputStream,
    text: string
  ): void;
  dispose(): void;
  flush(runId: string, taskId: string): void;
  snapshot(runId: string, taskId: string): TaskOutputUpdate | null;
  start(args: {
    runId: string;
    taskId: string;
    windowId?: string | undefined;
  }): void;
}

function outputKey(runId: string, taskId: string): string {
  return `${runId}\0${taskId}`;
}

function updateFrom(record: OutputRecord, chunks: TaskOutputChunk[]) {
  return {
    chunks,
    firstSequence: record.chunks[0]?.sequence ?? record.version + 1,
    runId: record.runId,
    taskId: record.taskId,
    truncated: record.truncated,
    version: record.version,
  } satisfies TaskOutputUpdate;
}

/**
 * 后台任务输出所有者。每个任务、总任务数均有上限，增量按一帧量级合并后发布，
 * 避免高频 stdout 直接放大成 renderer 的高频全量状态更新。
 */
export function createTaskOutputBuffer(options: {
  maxChars?: number;
  maxChunks?: number;
  now?: () => number;
  onChanged?(update: TaskOutputUpdate, windowId?: string): void;
  retainedOutputs?: number;
}): TaskOutputBuffer {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const maxChunks = options.maxChunks ?? DEFAULT_MAX_CHUNKS;
  const retainedOutputs = options.retainedOutputs ?? DEFAULT_RETAINED_OUTPUTS;
  const now = options.now ?? (() => Date.now());
  const records = new Map<string, OutputRecord>();

  function publish(record: OutputRecord): void {
    if (record.timer) {
      clearTimeout(record.timer);
      record.timer = undefined;
    }
    if (record.pending.length === 0) {
      return;
    }
    const pending = record.pending;
    record.pending = [];
    options.onChanged?.(updateFrom(record, pending), record.windowId);
  }

  function schedulePublish(record: OutputRecord): void {
    if (record.timer) {
      return;
    }
    record.timer = setTimeout(() => publish(record), PUBLISH_DELAY_MS);
  }

  function enforceLimit(record: OutputRecord): void {
    while (
      record.chunks.length > 1 &&
      (record.charCount > maxChars || record.chunks.length > maxChunks)
    ) {
      const removed = record.chunks.shift();
      if (removed) {
        record.charCount -= removed.text.length;
        record.truncated = true;
      }
    }
    const only = record.chunks[0];
    if (only && only.text.length > maxChars) {
      const text = only.text.slice(-maxChars);
      record.charCount = text.length;
      record.chunks[0] = { ...only, text };
      record.pending = record.pending.map((chunk) =>
        chunk.sequence === only.sequence ? { ...chunk, text } : chunk
      );
      record.truncated = true;
    }
  }

  function trimRetainedOutputs(): void {
    if (records.size <= retainedOutputs) {
      return;
    }
    const oldest = [...records.entries()].sort(
      ([, left], [, right]) => left.updatedAt - right.updatedAt
    )[0];
    if (!oldest) {
      return;
    }
    const [key, record] = oldest;
    if (record.timer) {
      clearTimeout(record.timer);
    }
    records.delete(key);
  }

  return {
    append(runId, taskId, stream, text) {
      if (text.length === 0) {
        return;
      }
      const record = records.get(outputKey(runId, taskId));
      if (!record) {
        return;
      }
      record.version += 1;
      record.updatedAt = now();
      const chunk = { sequence: record.version, stream, text };
      record.chunks.push(chunk);
      record.pending.push(chunk);
      record.charCount += text.length;
      enforceLimit(record);
      schedulePublish(record);
    },
    dispose() {
      for (const record of records.values()) {
        if (record.timer) {
          clearTimeout(record.timer);
        }
      }
      records.clear();
    },
    flush(runId, taskId) {
      const record = records.get(outputKey(runId, taskId));
      if (record) {
        publish(record);
      }
    },
    snapshot(runId, taskId) {
      const record = records.get(outputKey(runId, taskId));
      return record ? updateFrom(record, [...record.chunks]) : null;
    },
    start({ runId, taskId, windowId }) {
      const key = outputKey(runId, taskId);
      if (records.has(key)) {
        return;
      }
      records.set(key, {
        charCount: 0,
        chunks: [],
        pending: [],
        runId,
        taskId,
        truncated: false,
        updatedAt: now(),
        version: 0,
        ...(windowId ? { windowId } : {}),
      });
      trimRetainedOutputs();
    },
  };
}

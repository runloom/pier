import {
  readFileSync,
  type Stats,
  statSync,
  unwatchFile,
  watchFile,
} from "node:fs";
import { open, readFile, stat, writeFile } from "node:fs/promises";
import {
  type AgentHookEvent,
  agentHookEventSchema,
} from "@shared/contracts/agent-session.ts";

/** rotate 阈值：10MB。 */
const ROTATE_SIZE = 10 * 1024 * 1024;

/** rotate 后保留行数。 */
const ROTATE_TAIL_LINES = 1000;

/** watchFile 轮询间隔（ms）。 */
const POLL_INTERVAL_MS = 250;

export interface JsonlObserver {
  /** 停止监听并释放资源。 */
  dispose(): void;
}

export interface JsonlObserverOpts {
  /** events.jsonl 绝对路径。 */
  filePath: string;
  /** 错误回调（解析失败等）——静默降级，不中断监听。 */
  onError?: (err: unknown) => void;
  /** 每行合法事件的回调。 */
  onEvent: (event: AgentHookEvent) => void;
}

/** offset 持久化文件后缀。 */
const OFFSET_SUFFIX = ".offset";

/**
 * JSONL 尾读 observer（spec §4.4）。
 *
 * - 首次 init 时 stat → 记当前 file size 为 offset（跳过历史事件）
 * - 崩溃恢复：若 offset 文件存在则从上次位置继续
 * - watchFile 命中 → read(fd, prevOffset..curSize) → 按行分割 → zod 校验
 * - rotate：文件 >10MB → 读 tail 1000 行 → 重写 → offset 重置
 */
export function createJsonlObserver(opts: JsonlObserverOpts): JsonlObserver {
  const { filePath, onEvent, onError } = opts;
  const offsetPath = filePath + OFFSET_SUFFIX;
  let offset = loadOffset(filePath, offsetPath);
  let processing = false;
  let disposed = false;

  watchFile(filePath, { interval: POLL_INTERVAL_MS }, onFileChange);

  function onFileChange(_curr: Stats, _prev: Stats): void {
    if (disposed || processing) {
      return;
    }
    processing = true;
    processChanges().finally(() => {
      processing = false;
    });
  }

  async function readNewBytes(size: number): Promise<Buffer> {
    const fd = await open(filePath, "r");
    try {
      const buf = Buffer.alloc(size - offset);
      const { bytesRead } = await fd.read(buf, 0, buf.length, offset);
      return buf.subarray(0, bytesRead);
    } finally {
      await fd.close();
    }
  }

  function processLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    try {
      const parsed = JSON.parse(trimmed);
      const result = agentHookEventSchema.safeParse(parsed);
      if (result.success) {
        onEvent(result.data);
      } else {
        onError?.(result.error);
      }
    } catch (err) {
      onError?.(err);
    }
  }

  async function processChanges(): Promise<void> {
    try {
      const st = await stat(filePath).catch(() => null);
      if (!st || st.size <= offset) {
        // 文件缩小（外部截断）——重置 offset
        if (st && st.size < offset) {
          offset = st.size;
          await persistOffset(offsetPath, offset);
        }
        return;
      }
      if (st.size > ROTATE_SIZE) {
        await rotate();
        return;
      }

      const chunk = await readNewBytes(st.size);
      offset = st.size;
      await persistOffset(offsetPath, offset);

      if (!chunk.length) {
        return;
      }
      for (const line of chunk.toString("utf8").split("\n")) {
        processLine(line);
      }
    } catch (err) {
      onError?.(err);
    }
  }

  async function rotate(): Promise<void> {
    try {
      const content = await readFile(filePath, "utf8");
      const allLines = content.split("\n").filter((l) => l.trim());
      const tail = allLines.slice(-ROTATE_TAIL_LINES);
      const newContent = `${tail.join("\n")}\n`;
      await writeFile(filePath, newContent);
      offset = Buffer.byteLength(newContent);
      await persistOffset(offsetPath, offset);
    } catch (err) {
      onError?.(err);
    }
  }

  return {
    dispose() {
      disposed = true;
      unwatchFile(filePath, onFileChange);
    },
  };
}

/**
 * 加载 offset：优先读 offset 文件（崩溃恢复），fallback 到当前文件大小
 * （首次启动跳过历史），文件不存在返回 0。
 */
function loadOffset(filePath: string, offsetPath: string): number {
  try {
    const raw = readFileSync(offsetPath, "utf8").trim();
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) {
      return n;
    }
  } catch {
    // offset 文件不存在——首次启动
  }
  try {
    return statSync(filePath).size;
  } catch {
    return 0;
  }
}

/** 异步写 offset 到持久化文件。 */
async function persistOffset(offsetPath: string, value: number): Promise<void> {
  await writeFile(offsetPath, String(value)).catch(() => {
    // offset 写失败仅影响崩溃恢复精度，进程继续跑不阻塞——静默降级即可。
  });
}

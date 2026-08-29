import { type Stats, unwatchFile, watchFile } from "node:fs";
import { open, rename, rm, stat, writeFile } from "node:fs/promises";
import {
  type AgentHookEventPayload,
  agentHookEventSchema,
  type CommandFinishedHookEvent,
  type CommandStartHookEvent,
} from "@shared/contracts/agent/session.ts";
import { createLogger } from "@shared/logger.ts";
import { enrichAgentEventFromRawPayload } from "./jsonl-enrichment.ts";
import {
  acquireRotationLock,
  LOCK_SUFFIX,
  loadOffset,
  OFFSET_SUFFIX,
  persistOffset,
  prepareInterruptedRotation,
  ROTATING_SUFFIX,
  type RotationRecovery,
  reapStaleRotationLock,
  sweepStaleLockCandidates,
} from "./jsonl-rotation.ts";

const log = createLogger("foreground-activity.jsonl-observer");

/** rotate 阈值：10MB。 */
const ROTATE_SIZE = 10 * 1024 * 1024;

/** watchFile 轮询间隔（ms）。 */
const POLL_INTERVAL_MS = 250;
/** 锁候选残留清扫周期（启动即扫一次）。 */
const LOCK_CANDIDATE_SWEEP_INTERVAL_MS = 60 * 60 * 1000;
const MAX_READ_BYTES = 1024 * 1024;
type ObserverCallback<T> =
  | ((value: T) => void)
  | ((value: T) => PromiseLike<void>);
const reportCallbackFailure = (): void =>
  log.warn("observer-error-callback-failed", {
    code: "error-callback-failed",
  });

export interface JsonlObserver {
  /** 停止监听并释放资源。 */
  dispose(): void;
  /** 手动触发尾读循环，供测试跳过 watchFile 轮询等待。 */
  pollNow(): Promise<void>;
}

export interface JsonlObserverOpts {
  /** events.jsonl 绝对路径。 */
  filePath: string;
  /** agentEvent kind 行的回调（现役 Path B）。 */
  onAgentEvent: ObserverCallback<AgentHookEventPayload>;
  /** commandFinished kind 行的回调（emit 脚本 `commandFinished` dispatch）。 */
  onCommandFinished: ObserverCallback<CommandFinishedHookEvent>;
  /** commandStart kind 行的回调（emit 脚本 `commandStart` dispatch）。 */
  onCommandStart: ObserverCallback<CommandStartHookEvent>;
  /** 错误回调只传安全结构诊断——静默降级，不中断监听。 */
  onError?: ObserverCallback<JsonlObserverDiagnostic>;
}

export type JsonlObserverDiagnostic = Record<string, unknown> &
  (
    | {
        code: "callback-failed" | "invalid-json" | "schema-validation-failed";
        lineByteLength: number;
      }
    | {
        code: "file-operation-failed";
        operation: "drain" | "rotate";
        systemCode?: string;
      }
    | {
        code: "line-too-long";
        discardedByteLength: number;
        source: "active" | "recovery";
      }
  );

/**
 * JSONL 尾读 observer（spec §4.4）。
 *
 * - 首次 init 时 stat → 记当前 file size 为 offset（跳过历史事件）
 * - 崩溃恢复：若 offset 文件存在则从上次位置继续
 * - watchFile 命中 → read(fd, prevOffset..curSize) → 按行分割 → zod 校验
 * - rotate：文件 >10MB → 读 tail 1000 行 → 重写 → offset 重置
 */
export function createJsonlObserver(opts: JsonlObserverOpts): JsonlObserver {
  const { filePath, onCommandStart, onCommandFinished, onAgentEvent, onError } =
    opts;
  const offsetPath = filePath + OFFSET_SUFFIX;
  let recovery = prepareInterruptedRotation(filePath, offsetPath);
  let offset = recovery ? 0 : loadOffset(filePath, offsetPath);
  let processing = false;
  let pending = false;
  let disposed = false;
  const reapTimer = setInterval(() => {
    if (!(disposed || processing)) startDrain();
  }, 1000);
  reapTimer.unref();
  const sweepLockCandidates = (): void => {
    sweepStaleLockCandidates(filePath + LOCK_SUFFIX).catch(() => undefined);
  };
  const lockCandidateSweepTimer = setInterval(() => {
    if (!disposed) {
      sweepLockCandidates();
    }
  }, LOCK_CANDIDATE_SWEEP_INTERVAL_MS);
  lockCandidateSweepTimer.unref();
  sweepLockCandidates();

  watchFile(filePath, { interval: POLL_INTERVAL_MS }, onFileChange);

  function onFileChange(_curr: Stats, _prev: Stats): void {
    if (disposed) {
      return;
    }
    if (processing) {
      pending = true;
      return;
    }
    startDrain();
  }

  function startDrain(): void {
    processing = true;
    drainChanges().finally(() => {
      processing = false;
    });
  }

  async function drainChanges(): Promise<void> {
    do {
      pending = false;
      await processChanges();
    } while (!disposed && pending);
  }

  async function readNewBytes(size: number): Promise<Buffer> {
    const fd = await open(filePath, "r");
    try {
      const buf = Buffer.alloc(Math.min(size - offset, MAX_READ_BYTES));
      const { bytesRead } = await fd.read(buf, 0, buf.length, offset);
      return buf.subarray(0, bytesRead);
    } finally {
      await fd.close();
    }
  }

  function reportDiagnostic(diagnostic: JsonlObserverDiagnostic): void {
    log.warn("observer-failure", diagnostic);
    try {
      Promise.resolve(onError?.(diagnostic)).catch(reportCallbackFailure);
    } catch {
      reportCallbackFailure();
    }
  }

  function reportLineFailure(
    code: "callback-failed" | "invalid-json" | "schema-validation-failed",
    line: string
  ): void {
    reportDiagnostic({
      code,
      lineByteLength: Buffer.byteLength(line),
    });
  }

  function reportFileFailure(
    operation: "drain" | "rotate",
    error: unknown
  ): void {
    const rawCode =
      error && typeof error === "object" && "code" in error
        ? error.code
        : undefined;
    const systemCode =
      typeof rawCode === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(rawCode)
        ? rawCode
        : undefined;
    reportDiagnostic({
      code: "file-operation-failed",
      operation,
      ...(systemCode ? { systemCode } : {}),
    });
  }

  async function processLine(line: string): Promise<void> {
    if (disposed) {
      return;
    }
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      reportLineFailure("invalid-json", trimmed);
      return;
    }
    const result = agentHookEventSchema.safeParse(parsed);
    if (!result.success) {
      reportLineFailure("schema-validation-failed", trimmed);
      return;
    }
    const event = enrichAgentEventFromRawPayload(result.data);
    if (event.kind === "agentEvent") {
      log.debug("event-line", {
        kind: event.kind,
        agent: event.agent,
        event: event.event,
        panelId: event.panelId,
      });
    }
    try {
      switch (event.kind) {
        case "commandStart":
          await onCommandStart(event);
          break;
        case "commandFinished":
          await onCommandFinished(event);
          break;
        case "agentEvent":
          await onAgentEvent(event);
          break;
        default: {
          const _exhaustive: never = event;
          throw new Error(`unreachable kind: ${String(_exhaustive)}`);
        }
      }
    } catch {
      reportLineFailure("callback-failed", trimmed);
    }
  }

  async function processChanges(): Promise<void> {
    try {
      await reapStaleRotationLock(filePath + LOCK_SUFFIX);
      if (recovery) {
        const releaseLock = await acquireRotationLock(
          filePath + LOCK_SUFFIX,
          () => disposed
        );
        if (!releaseLock) return;
        try {
          const mainExists = await stat(filePath)
            .then(() => true)
            .catch(() => false);
          if (mainExists) {
            await finishInterruptedRotation(recovery);
          } else {
            await rename(recovery.path, filePath);
            await rename(recovery.offsetPath, offsetPath).catch(
              () => undefined
            );
            offset = loadOffset(filePath, offsetPath);
          }
          recovery = null;
        } finally {
          await releaseLock();
        }
      }
      const st = await stat(filePath).catch(() => null);
      if (!st) {
        return;
      }
      if (st.size < offset) {
        // 文件被外部截断/重建——从头读当前内容（loomdesk watcher 同语义:
        // 只重置不读会把重建后已写入的合法事件永久跳过）。
        offset = 0;
      }
      if (st.size === offset) {
        return;
      }
      const chunk = await readNewBytes(st.size);
      // 只消费到最后一个完整行边界（字节层面找 0x0A——JSONL 写端不保证
      // 原子换行边界, 半行必须留在文件里等补齐; 按字节切割也天然规避
      // UTF-8 多字节字符跨 chunk 被 toString 拆坏的问题）。offset 只推进
      // 过完整行, 崩溃恢复永不丢已落盘的完整事件。
      const lastNewline = chunk.lastIndexOf(0x0a);
      if (lastNewline === -1) {
        if (chunk.length >= MAX_READ_BYTES) {
          reportDiagnostic({
            code: "line-too-long",
            discardedByteLength: chunk.length,
            source: "active",
          });
          offset += chunk.length;
          await persistOffset(offsetPath, offset);
          pending = true;
        }
        return;
      }
      const consumed = chunk.subarray(0, lastNewline + 1);
      let lineStart = 0;
      for (let index = 0; index < consumed.length; index += 1) {
        if (consumed[index] !== 0x0a) {
          continue;
        }
        await processLine(consumed.subarray(lineStart, index).toString("utf8"));
        const lineBytes = index + 1 - lineStart;
        offset += lineBytes;
        lineStart = index + 1;
        // callback 成功后再 checkpoint：崩溃最多重放当前行，不会跳过尚未派发
        // 的后续完整行。
        await persistOffset(offsetPath, offset);
      }
      if (st.size - offset >= MAX_READ_BYTES) {
        pending = true;
      }
      if (st.size > ROTATE_SIZE && offset >= st.size) {
        await rotate();
      }
    } catch (error) {
      reportFileFailure("drain", error);
    }
  }

  async function rotate(): Promise<void> {
    const rotatedPath = `${filePath}${ROTATING_SUFFIX}`;
    const rotatedOffsetPath = `${rotatedPath}${OFFSET_SUFFIX}`;
    const releaseLock = await acquireRotationLock(
      filePath + LOCK_SUFFIX,
      () => disposed
    );
    if (!releaseLock) {
      return;
    }
    try {
      await rm(rotatedPath, { force: true });
      await rm(rotatedOffsetPath, { force: true });
      await persistOffset(rotatedOffsetPath, offset);
      await rename(filePath, rotatedPath);
      await writeFile(filePath, "");
      await finishInterruptedRotation({
        offset,
        offsetPath: rotatedOffsetPath,
        path: rotatedPath,
      });
      pending = true;
    } catch (error) {
      reportFileFailure("rotate", error);
    } finally {
      await releaseLock();
    }
  }

  async function finishInterruptedRotation(
    interrupted: RotationRecovery
  ): Promise<void> {
    const rotated = await stat(interrupted.path).catch(() => null);
    if (rotated) {
      let recoveryOffset = Math.min(interrupted.offset, rotated.size);
      while (rotated.size > recoveryOffset) {
        const fd = await open(interrupted.path, "r");
        try {
          const tail = Buffer.alloc(
            Math.min(rotated.size - recoveryOffset, MAX_READ_BYTES)
          );
          const result = await fd.read(tail, 0, tail.length, recoveryOffset);
          const bytes = tail.subarray(0, result.bytesRead);
          const lastNewline = bytes.lastIndexOf(0x0a);
          if (lastNewline === -1) {
            if (recoveryOffset + bytes.length < rotated.size) {
              reportDiagnostic({
                code: "line-too-long",
                discardedByteLength: bytes.length,
                source: "recovery",
              });
            } else {
              await processLine(bytes.toString("utf8"));
            }
            recoveryOffset += bytes.length;
            await persistOffset(interrupted.offsetPath, recoveryOffset);
          } else {
            const consumed = bytes.subarray(0, lastNewline + 1);
            let lineStart = 0;
            for (let index = 0; index < consumed.length; index += 1) {
              if (consumed[index] !== 0x0a) {
                continue;
              }
              await processLine(
                consumed.subarray(lineStart, index).toString("utf8")
              );
              recoveryOffset += index + 1 - lineStart;
              lineStart = index + 1;
              await persistOffset(interrupted.offsetPath, recoveryOffset);
            }
            const remainingStart = lastNewline + 1;
            if (
              remainingStart < bytes.length &&
              recoveryOffset === rotated.size - (bytes.length - remainingStart)
            ) {
              await processLine(
                bytes.subarray(remainingStart).toString("utf8")
              );
              recoveryOffset += bytes.length - remainingStart;
              await persistOffset(interrupted.offsetPath, recoveryOffset);
            }
          }
        } finally {
          await fd.close();
        }
      }
    }

    // 先把新日志 checkpoint 归零，再删除旧日志；任一位置崩溃，下一次
    // 启动都只会重放尚未 checkpoint 的旧行，不会拼接或重复消费新日志。
    offset = 0;
    await persistOffset(offsetPath, offset);
    await rm(interrupted.path, { force: true });
    await rm(interrupted.offsetPath, { force: true });
  }

  return {
    dispose() {
      disposed = true;
      clearInterval(reapTimer);
      clearInterval(lockCandidateSweepTimer);
      unwatchFile(filePath, onFileChange);
    },
    async pollNow() {
      // 与 watchFile 触发共享同一 processing 闸门，避免并发读同段字节。
      if (disposed) {
        return;
      }
      if (processing) {
        pending = true;
        return;
      }
      processing = true;
      try {
        await drainChanges();
      } finally {
        processing = false;
      }
    },
  };
}

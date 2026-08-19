export {
  createTerminalTranscriptsService,
  sanitizeTranscriptLifecycleId,
  type TerminalTranscriptLifecycleInfo,
  type TerminalTranscriptsService,
  type TerminalTranscriptsServiceOptions,
  TRANSCRIPT_GLOBAL_QUOTA_BYTES,
  TRANSCRIPT_QUOTA_SWEEP_INTERVAL_MS,
} from "./service.ts";
export {
  TRANSCRIPT_DROP_MARKER_PREFIX,
  TRANSCRIPT_QUEUE_MAX_BYTES,
  TRANSCRIPT_SEGMENT_MAX_BYTES,
  TranscriptSegmentWriter,
} from "./writer.ts";

/** 任务输出等落盘方的最小注入面（tasks 服务不直接依赖本模块实现）。 */
export interface TerminalTranscriptSink {
  append(lifecycleId: string, text: string): void;
  seal(lifecycleId: string): void;
}

/** 任务输出 transcript 的 lifecycle 目录名（runId × taskId 唯一）。 */
export function taskOutputTranscriptLifecycleId(
  runId: string,
  taskId: string
): string {
  return `task-${runId}-${taskId}`;
}

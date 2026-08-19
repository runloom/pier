import type {
  TerminalTranscriptTailRequest,
  TerminalTranscriptTailResult,
} from "@shared/contracts/terminal.ts";
import type { IpcMain } from "electron";
import { stripControlSequences } from "../../../services/runtime-control/screen-text.ts";
import type { TerminalTranscriptsService } from "../../../services/terminal-transcripts/index.ts";
import {
  sanitizeTranscriptLifecycleId,
  taskOutputTranscriptLifecycleId,
} from "../../../services/terminal-transcripts/index.ts";

const DEFAULT_TAIL_BYTES = 2 * 1024 * 1024;
const MAX_TAIL_BYTES = 8 * 1024 * 1024;

function isTailRequest(value: unknown): value is TerminalTranscriptTailRequest {
  if (!value || typeof value !== "object") {
    return false;
  }
  const request = value as Record<string, unknown>;
  return (
    typeof request.panelId === "string" &&
    request.panelId.length > 0 &&
    (request.maxBytes === undefined ||
      (typeof request.maxBytes === "number" &&
        Number.isFinite(request.maxBytes))) &&
    (request.taskId === undefined || typeof request.taskId === "string") &&
    (request.taskRunId === undefined || typeof request.taskRunId === "string")
  );
}

/**
 * 终端历史（Tier 2 transcript）读取通道。
 *
 * lifecycle 解析顺序与写入端约定一致：
 * 1. 任务输出面板（taskRunId + taskId）→ `task-{runId}-{taskId}`（main sink 写入）
 * 2. 任务运行终端（taskRunId）→ runId（native tap 写入）
 * 3. 普通终端 → `term-{panelId}`（native tap 写入，跨重启稳定）
 */
export function registerTerminalTranscriptIpc(
  ipcMain: IpcMain,
  transcripts: TerminalTranscriptsService | undefined
): void {
  ipcMain.handle(
    "pier:terminal:transcript-tail",
    async (_event, payload: unknown): Promise<TerminalTranscriptTailResult> => {
      if (!isTailRequest(payload)) {
        return { error: "invalid transcript request", ok: false };
      }
      if (!transcripts) {
        return { error: "transcripts unavailable", ok: false };
      }
      const maxBytes = Math.min(
        MAX_TAIL_BYTES,
        Math.max(64 * 1024, payload.maxBytes ?? DEFAULT_TAIL_BYTES)
      );
      const candidates: string[] = [];
      if (payload.taskRunId && payload.taskId) {
        candidates.push(
          taskOutputTranscriptLifecycleId(payload.taskRunId, payload.taskId)
        );
      }
      if (payload.taskRunId) {
        candidates.push(payload.taskRunId);
      }
      candidates.push(`term-${payload.panelId}`);

      try {
        const lifecycles = await transcripts.listLifecycles();
        const byId = new Map(lifecycles.map((info) => [info.id, info]));
        for (const candidate of candidates) {
          const sanitized = sanitizeTranscriptLifecycleId(candidate);
          const info = byId.get(sanitized);
          if (!info || info.bytes === 0) {
            continue;
          }
          const tail = await transcripts.readTail(candidate, maxBytes);
          return {
            ok: true,
            text: stripControlSequences(tail.text),
            totalBytes: tail.totalUncompressedBytes,
            truncated: tail.truncated,
          };
        }
        return { ok: true, text: "", totalBytes: 0, truncated: false };
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : String(error),
          ok: false,
        };
      }
    }
  );
}

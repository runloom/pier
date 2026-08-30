import type { AgentHookEventPayload } from "@shared/contracts/agent/session.ts";
import type { TranscriptTerminalRecord } from "./tail-contracts.ts";
import { emitTranscriptEvent } from "./tail-event.ts";
import { shouldDropStaleEmptyTurnTerminal } from "./tail-watermark.ts";
import {
  processTranscriptTitleLine,
  type TranscriptTitleListener,
  type TranscriptTitleRecord,
} from "./title-routing.ts";

export interface TranscriptLineProcessorEntry {
  classifyLine: ((line: string) => TranscriptTerminalRecord | null) | null;
  contextsByTurnId: Map<string, AgentHookEventPayload>;
  disposed: boolean;
  lastTitleByScope: Map<string, string>;
  owners: Map<string, AgentHookEventPayload>;
  pendingRecords: TranscriptTerminalRecord[];
  promptWatermarkByScope: Map<string, number>;
  seenTerminalEvents: Set<string>;
  seenTranscriptEvents: Set<string>;
}

const MAX_PENDING_TRANSCRIPT_RECORDS = 64;

function ownerWatermark(
  entry: TranscriptLineProcessorEntry
): number | undefined {
  if (entry.owners.size !== 1) {
    return;
  }
  const key = entry.owners.keys().next().value;
  return key === undefined ? undefined : entry.promptWatermarkByScope.get(key);
}

export function processTranscriptLine(input: {
  allowOwnerFallback: boolean;
  classifyTitleLine?:
    | ((line: string) => TranscriptTitleRecord | null)
    | undefined;
  disposed: boolean;
  entry: TranscriptLineProcessorEntry;
  line: string;
  lineEnd: number;
  onTerminalEvent: (event: AgentHookEventPayload) => void;
  onTitleRecord?: TranscriptTitleListener | undefined;
}): void {
  const { allowOwnerFallback, disposed, entry, line, lineEnd } = input;
  if (disposed || entry.disposed || !line.trim()) {
    return;
  }
  if (allowOwnerFallback) {
    try {
      const classifyTitleLine = input.classifyTitleLine;
      const listener = input.onTitleRecord;
      if (classifyTitleLine && listener) {
        processTranscriptTitleLine({
          classifyLine: classifyTitleLine,
          lastTitleByScope: entry.lastTitleByScope,
          line,
          listener,
          owners: entry.owners,
        });
      }
    } catch {
      // 标题是纯装饰通路，坏行不得连带影响终态对账。
    }
  }
  try {
    const record = entry.classifyLine?.(line);
    if (!record) {
      return;
    }
    if (
      shouldDropStaleEmptyTurnTerminal({
        lineEnd,
        record,
        watermark: ownerWatermark(entry),
      })
    ) {
      return;
    }
    let context: AgentHookEventPayload | undefined;
    if (record.turnId) {
      context = entry.contextsByTurnId.get(record.turnId);
    } else if (allowOwnerFallback && entry.owners.size === 1) {
      context = entry.owners.values().next().value;
    }
    if (!context) {
      if (record.turnId) {
        entry.pendingRecords.push(record);
        if (entry.pendingRecords.length > MAX_PENDING_TRANSCRIPT_RECORDS) {
          entry.pendingRecords.shift();
        }
      }
      return;
    }
    emitTranscriptEvent(entry, context, record, input.onTerminalEvent);
  } catch {
    // transcript 是兼容性对账源；坏行和格式升级不得影响主 hook 通路。
  }
}

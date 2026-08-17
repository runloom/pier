import type { CursorQuestionScanState } from "./cursor-question.ts";
import type { TranscriptTerminalRecord } from "./tail-contracts.ts";

/** 这些 observe 触发表示当前回合已在推进，不得把旧 turn_ended 封到新账上。 */
const LIVE_WORK_EVENTS = new Set([
  "InteractionRequested",
  "PromptSubmit",
  "ToolStart",
  "processing",
  "running",
]);

export function cursorLastTerminalFingerprint(
  transcriptPath: string,
  terminalSeq: number,
  record: TranscriptTerminalRecord
): string {
  return `${transcriptPath}\0${terminalSeq}\0${record.nativeEvent}\0${record.pierEvent}`;
}

/**
 * 末条 turn_ended 回填：每个文件世代只发一次；问卷/方案 waiting 期间先记账
 * 不发；PromptSubmit / ToolStart 等活体观察不把空 turnId 完成套到新回合。
 */
export function shouldEmitCursorLastTerminal(input: {
  alreadySeen: boolean;
  eventName: string;
  fresh: boolean;
  hasLastTerminal: boolean;
  waiting: boolean;
}): boolean {
  return (
    input.fresh &&
    input.hasLastTerminal &&
    !input.waiting &&
    !input.alreadySeen &&
    !LIVE_WORK_EVENTS.has(input.eventName)
  );
}

export function noteCursorLastTerminalBackfill(input: {
  eventName: string;
  fresh: boolean;
  resolvedPath: string;
  scanned: Pick<CursorQuestionScanState, "lastTerminal" | "terminalSeq">;
  seenByScope: Map<string, string>;
  scopeKey: string;
  waiting: boolean;
}): TranscriptTerminalRecord | null {
  const record = input.scanned.lastTerminal;
  if (!record) {
    return null;
  }
  const fingerprint = cursorLastTerminalFingerprint(
    input.resolvedPath,
    input.scanned.terminalSeq ?? 0,
    record
  );
  const alreadySeen = input.seenByScope.get(input.scopeKey) === fingerprint;
  input.seenByScope.set(input.scopeKey, fingerprint);
  return shouldEmitCursorLastTerminal({
    alreadySeen,
    eventName: input.eventName,
    fresh: input.fresh,
    hasLastTerminal: true,
    waiting: input.waiting,
  })
    ? record
    : null;
}

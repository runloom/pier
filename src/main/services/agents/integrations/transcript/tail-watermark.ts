import type { TranscriptTerminalRecord } from "./tail-contracts.ts";

export function isEmptyTurnTerminal(record: TranscriptTerminalRecord): boolean {
  return (
    (record.pierEvent === "TurnCompleted" ||
      record.pierEvent === "TurnInterrupted") &&
    record.turnId.trim().length === 0
  );
}

/**
 * 空 turnId 终态若写在本 scope 最近一次 PromptSubmit 当时的文件水位之内，
 * 属于已换代回合的遗留行，不得再走 owner 回退封新回合。
 */
export function shouldDropStaleEmptyTurnTerminal(input: {
  lineEnd: number;
  record: TranscriptTerminalRecord;
  watermark: number | undefined;
}): boolean {
  if (!isEmptyTurnTerminal(input.record)) {
    return false;
  }
  if (input.watermark === undefined) {
    return false;
  }
  return input.lineEnd <= input.watermark;
}

export function recordPromptWatermark(
  watermarks: Map<string, number>,
  scopeKey: string,
  size: number
): void {
  watermarks.set(scopeKey, size);
}

export function movePromptWatermark(
  watermarks: Map<string, number>,
  sourceKey: string,
  targetKey: string
): void {
  const watermark = watermarks.get(sourceKey);
  if (watermark === undefined) {
    return;
  }
  watermarks.delete(sourceKey);
  watermarks.set(targetKey, watermark);
}

export function dropPromptWatermarks(
  watermarks: Map<string, number>,
  keys: Iterable<string>
): void {
  for (const key of keys) {
    watermarks.delete(key);
  }
}

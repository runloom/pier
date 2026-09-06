import {
  isTranscriptTerminal,
  type TranscriptTerminalRecord,
} from "./tail-contracts.ts";

export function isEmptyTurnTerminal(record: TranscriptTerminalRecord): boolean {
  return isTranscriptTerminal(record) && record.turnId.trim().length === 0;
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
  size: number,
  fileIdentities?: Map<string, string | undefined>,
  fileIdentity?: string
): void {
  watermarks.set(scopeKey, size);
  fileIdentities?.set(scopeKey, fileIdentity);
}

export function movePromptWatermark(
  watermarks: Map<string, number>,
  sourceKey: string,
  targetKey: string,
  fileIdentities?: Map<string, string | undefined>
): void {
  const watermark = watermarks.get(sourceKey);
  if (watermark === undefined) {
    return;
  }
  watermarks.delete(sourceKey);
  watermarks.set(targetKey, watermark);
  if (fileIdentities?.has(sourceKey)) {
    const identity = fileIdentities.get(sourceKey);
    fileIdentities.delete(sourceKey);
    fileIdentities.set(targetKey, identity);
  }
}

export function dropPromptWatermarks(
  watermarks: Map<string, number>,
  keys: Iterable<string>,
  fileIdentities?: Map<string, string | undefined>
): void {
  for (const key of keys) {
    watermarks.delete(key);
    fileIdentities?.delete(key);
  }
}

/** A Prompt can stat the new file before the drain notices its replacement. */
export function retainPromptWatermarksForFile(
  watermarks: Map<string, number>,
  fileIdentities: Map<string, string | undefined>,
  currentIdentity: string
): void {
  for (const key of watermarks.keys()) {
    const identity = fileIdentities.get(key);
    if (
      fileIdentities.has(key) &&
      (identity === undefined || identity === currentIdentity)
    ) {
      // A confirmed missing-file boundary is valid only for its first generation.
      fileIdentities.set(key, currentIdentity);
    } else {
      watermarks.delete(key);
      fileIdentities.delete(key);
    }
  }
}

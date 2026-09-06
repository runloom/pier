import type { Stats } from "node:fs";
import type { TranscriptLineProcessorEntry } from "./tail-process.ts";

export const MAX_READ_BYTES = 1024 * 1024;

export function fileIdentity(stat: Stats): string {
  return `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
}

export interface TranscriptEntry extends TranscriptLineProcessorEntry {
  fileIdentity: string | undefined;
  /** null：登记时尚不存在，首次读取须重新校验路径与历史区。 */
  initialScanEnd: number | null;
  offset: number;
  pending: boolean;
  processing: boolean;
  promptFileIdentityByScope: Map<string, string | undefined>;
  retryDelayMs: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
  root: string;
  watcher: (curr: Stats, prev: Stats) => void;
}

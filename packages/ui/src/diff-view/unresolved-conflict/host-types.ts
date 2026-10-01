import type { PierUnresolvedConflictLabels } from "./types.ts";

export interface PierUnresolvedConflictHost {
  readonly busyItemId?: string | null;
  readonly labels: PierUnresolvedConflictLabels;
  readonly mutationLocked?: boolean;
  readonly onError?: (error: Error) => void;
  readonly onWriteResolved: (
    itemId: string,
    payload: {
      readonly contents: string;
      readonly contentsDigest: string;
    }
  ) => void | Promise<void>;
}

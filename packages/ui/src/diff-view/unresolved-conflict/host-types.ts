import type { ReactNode } from "react";
import type {
  PierConflictFileBody,
  PierUnresolvedConflictLabels,
} from "./types.ts";

export interface PierUnresolvedConflictFileLevelRender {
  readonly busy: boolean;
  readonly conflict: PierConflictFileBody;
  readonly itemId: string;
  readonly path: string;
  readonly stateNotice?: string;
}

export interface PierUnresolvedConflictHost {
  readonly busyItemId?: string | null;
  readonly labels: PierUnresolvedConflictLabels;
  readonly mutationLocked?: boolean;
  readonly onError?: (error: Error) => void;
  readonly onResolveFile?: (
    itemId: string,
    action: "ours" | "stage" | "theirs"
  ) => void;
  readonly onWriteResolved: (
    itemId: string,
    payload: {
      readonly contents: string;
      readonly contentsDigest: string;
    }
  ) => void | Promise<void>;
  readonly renderFileLevel?: (
    input: PierUnresolvedConflictFileLevelRender
  ) => ReactNode;
}

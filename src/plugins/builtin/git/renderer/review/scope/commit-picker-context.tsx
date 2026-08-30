import type { Dispatch, RefObject, SetStateAction } from "react";
import { createContext, useContext } from "react";

export interface GitReviewCommitPickerSessionValue {
  readonly enabled: boolean;
  readonly open: boolean;
  readonly orderOids: readonly string[];
  readonly originOid: string | null;
  readonly originOidRef: RefObject<string | null>;
  readonly rangeCount: number | null;
  readonly rememberCommit: (commit: { message: string; oid: string }) => void;
  readonly rememberedCommit: { message: string; oid: string } | null;
  readonly setOpen: (open: boolean) => void;
  readonly setOrderOids: (oids: readonly string[]) => void;
  readonly setOriginOid: Dispatch<SetStateAction<string | null>>;
  readonly setRangeCount: (count: number | null) => void;
  readonly setVisibleOids: (oids: readonly string[]) => void;
  readonly visibleOids: readonly string[];
}

export const GitReviewCommitPickerSessionContext =
  createContext<GitReviewCommitPickerSessionValue | null>(null);

export function useOptionalGitReviewCommitPickerSession(): GitReviewCommitPickerSessionValue | null {
  return useContext(GitReviewCommitPickerSessionContext);
}

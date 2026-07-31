import type {
  PierDiffViewHandle,
  PierDiffViewItem,
} from "@pier/ui/diff-view/index.tsx";
import { type RefObject, useRef } from "react";
import type {
  GitReviewDocumentGeneration,
  ReviewFailureChange,
} from "../review/document/generation.ts";
import type { ReviewReadingMode } from "../review/reading-session.ts";
import type { GitReviewGenerationCallbacks } from "./use-document-session.ts";

export function useGitReviewGenerationCallbacks(sources: {
  readonly applyFailureChanges: (
    generation: number,
    changes: readonly ReviewFailureChange[],
    settled?: boolean
  ) => void;
  readonly applyItemUpdates: (
    handle: PierDiffViewHandle,
    generation: number,
    items: readonly PierDiffViewItem[],
    options?: {
      readonly flush?: boolean;
      readonly preserveAnchor?: boolean;
    }
  ) => boolean;
  readonly beginGeneration: (
    entryKeys: ReadonlySet<string>,
    generation: number,
    options?: { readonly restoreSelection?: boolean }
  ) => string | null;
  readonly beginReadingNavigating: (entryKey: string) => void;
  readonly beginReadingRefresh: () => void;
  readonly cancelRetentionSync: (
    controller: GitReviewDocumentGeneration
  ) => void;
  readonly clearLatestItemUpdates: () => void;
  readonly endReadingNavigating: () => void;
  readonly endReadingRefresh: () => void;
  readonly flushPendingItemUpdates: (
    handle: PierDiffViewHandle,
    generation: number
  ) => boolean;
  readonly getNavigationMemberReason: () => "restore" | "tree" | null;
  readonly getReadingMode: () => ReviewReadingMode;
  readonly getSelectedEntryKey: () => string | null;
  readonly getSelectedSectionKey: () => string | null;
  readonly hasPendingNavigation: () => boolean;
  readonly noteUserScrollReading: () => void;
  readonly notifyProjectionChanged: (ids?: readonly string[]) => void;
  readonly recordLatestItemUpdates: (
    items: readonly PierDiffViewItem[]
  ) => void;
  readonly resetGenerationFailures: (
    generation: number,
    changes: readonly ReviewFailureChange[]
  ) => void;
  readonly syncReadingPinnedPrefix: (options: {
    readonly candidates: ReadonlySet<string>;
    readonly entryKeysInOrder: readonly string[];
    readonly selectedEntryKey: string | null;
    readonly viewportEntryKeys: readonly string[];
  }) => readonly string[];
  readonly syncRetentionLimits: () => void;
  readonly tryPendingNavigation: () => void;
}): RefObject<GitReviewGenerationCallbacks> {
  const generationCallbacksRef = useRef(sources);
  generationCallbacksRef.current = sources;
  return generationCallbacksRef;
}

import type { PierDiffViewHandle } from "@pier/ui/diff-view.tsx";
import type { RefObject } from "react";
import type { GitReviewDocumentLoader } from "./git-review-document-loader.ts";
import type { PendingReviewAnchor } from "./git-review-document-projection.ts";

export interface UseGitReviewNavigationOptions {
  readonly applyNavigationDemand: (entryKey: string) => void;
  readonly diffHandleRef: RefObject<PierDiffViewHandle | null>;
  readonly documentGenerationRef: RefObject<number>;
  readonly firstSectionIdByEntryKeyRef: RefObject<ReadonlyMap<string, string>>;
  readonly initialSelectedEntryKey?: string | null;
  readonly initialSelectedSectionKey?: string | null;
  readonly itemCacheKeysRef: RefObject<ReadonlyMap<string, string>>;
  readonly itemIndexByIdRef: RefObject<ReadonlyMap<string, number>>;
  readonly loaderRef: RefObject<GitReviewDocumentLoader | null>;
  readonly pendingAnchorRef: RefObject<PendingReviewAnchor | null>;
  readonly renderedGenerationRef: RefObject<number>;
}

export interface GitReviewNavigationApi {
  readonly beginGeneration: (
    entryKeys: ReadonlySet<string>,
    generation: number
  ) => string | null;
  readonly beginNavigation: (target: {
    readonly entryKey: string;
    readonly sectionKey: string;
  }) => void;
  readonly cancelVerification: () => void;
  readonly clearForUserIntent: () => void;
  readonly getSelectedEntryKey: () => string | null;
  readonly getSelectedSectionKey: () => string | null;
  readonly hasPendingNavigation: () => boolean;
  readonly navigationError: Error | null;
  readonly navigationPending: boolean;
  readonly notifyProjectionChanged: (
    changedItemIds?: readonly string[]
  ) => void;
  readonly resumeSelectedNavigation: () => void;
  readonly retryNavigation: () => void;
  readonly tryPendingNavigation: () => void;
}

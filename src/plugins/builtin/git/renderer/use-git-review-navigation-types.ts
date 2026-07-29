import type {
  PierDiffViewHandle,
  PierDiffViewRenderWindow,
} from "@pier/ui/diff-view.tsx";
import type { RefObject } from "react";
import type { GitReviewDocumentLoader } from "./git-review-document-loader.ts";

export interface UseGitReviewNavigationOptions {
  readonly applyNavigationDemand: (entryKey: string) => void;
  readonly diffHandleRef: RefObject<PierDiffViewHandle | null>;
  readonly documentGenerationRef: RefObject<number>;
  readonly entryKeyBySectionIdRef: RefObject<ReadonlyMap<string, string>>;
  readonly firstSectionIdByEntryKeyRef: RefObject<ReadonlyMap<string, string>>;
  readonly initialSelectedEntryKey?: string | null;
  readonly initialSelectedSectionKey?: string | null;
  readonly itemCacheKeysRef: RefObject<ReadonlyMap<string, string>>;
  readonly itemIndexByIdRef: RefObject<ReadonlyMap<string, number>>;
  readonly loaderRef: RefObject<GitReviewDocumentLoader | null>;
  /** 导航 settle/取消时通知阅读会话结束 navigating */
  readonly onNavigationSettled?: () => void;
  /** 树导航开始时通知阅读会话（pin 保护） */
  readonly onNavigationStarted?: (entryKey: string) => void;
  readonly renderedGenerationRef: RefObject<number>;
}

export interface GitReviewNavigationApi {
  readonly beginGeneration: (
    entryKeys: ReadonlySet<string>,
    generation: number,
    options?: { readonly restoreSelection?: boolean }
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
  readonly notifyRenderWindowApplied: (
    window: PierDiffViewRenderWindow
  ) => void;
  readonly restoreSelectedNavigation: () => void;
  readonly resumeSelectedNavigation: () => void;
  readonly retryNavigation: () => void;
  readonly tryPendingNavigation: () => void;
}

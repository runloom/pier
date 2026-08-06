import type {
  PierDiffViewHandle,
  PierDiffViewItem,
  PierDiffViewRenderWindow,
} from "@pier/ui/diff-view/index.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type {
  GitReviewIndexEntry,
  GitReviewScope,
} from "@shared/contracts/git/review.ts";
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useEffect,
} from "react";
import type { ReviewCommentIndex } from "../review/document/comment-projection.ts";
import type { ReviewDocumentDemand } from "../review/document/demand.ts";
import type {
  GitReviewDocumentGeneration,
  ReviewFailureChange,
} from "../review/document/generation.ts";
import type { GitReviewDocumentLoader } from "../review/document/loader.ts";
import type {
  ReviewDocumentProjection,
  ReviewDocumentViewState,
} from "../review/document/projection.ts";
import type { GitReviewDocumentLoaderSnapshot } from "../review/document/resource.ts";
import type { ReviewReadingMode } from "../review/reading-session.ts";
import type { GitReviewReadingSurface } from "../review/reading-surface.ts";
import { mountGitReviewDocumentGeneration } from "./use-document-generation-effect.ts";

// 与 content 中 generationCallbacksRef 形状对齐；回调实现保留在 content。
export interface GitReviewGenerationCallbacks {
  // 失败变更类型由 failure-state 模块拥有；此处只约束调用形状。
  applyFailureChanges: (
    generation: number,
    changes: readonly ReviewFailureChange[],
    settled?: boolean
  ) => void;
  applyItemUpdates: (
    handle: PierDiffViewHandle,
    generation: number,
    items: readonly PierDiffViewItem[],
    options?: {
      readonly flush?: boolean;
      readonly preserveAnchor?: boolean;
    }
  ) => boolean;
  beginGeneration: (
    entryKeys: ReadonlySet<string>,
    generation: number,
    options?: { readonly restoreSelection?: boolean }
  ) => string | null;
  beginReadingNavigating: (entryKey: string) => void;
  beginReadingRefresh: () => void;
  cancelRetentionSync: (controller: GitReviewDocumentGeneration) => void;
  clearLatestItemUpdates: () => void;
  endReadingNavigating: () => void;
  endReadingRefresh: () => void;
  flushPendingItemUpdates: (
    handle: PierDiffViewHandle,
    generation: number
  ) => boolean;
  getNavigationMemberReason: () => "restore" | "tree" | null;
  getReadingMode: () => ReviewReadingMode;
  getSelectedEntryKey: () => string | null;
  getSelectedSectionKey: () => string | null;
  hasPendingNavigation: () => boolean;
  noteUserScrollReading: () => void;
  notifyProjectionChanged: (ids?: readonly string[]) => void;
  recordLatestItemUpdates: (items: readonly PierDiffViewItem[]) => void;
  resetGenerationFailures: (
    generation: number,
    changes: readonly ReviewFailureChange[]
  ) => void;
  /** 同步阅读 pin（视口/选中/模式）。返回最新 pinnedPrefix。 */
  syncReadingPinnedPrefix: (options: {
    readonly candidates: ReadonlySet<string>;
    readonly entryKeysInOrder: readonly string[];
    readonly selectedEntryKey: string | null;
    readonly viewportEntryKeys: readonly string[];
  }) => readonly string[];
  syncRetentionLimits: () => void;
  tryPendingNavigation: () => void;
}

export function useGitReviewDocumentSession(options: {
  readonly commentsIndexRef: RefObject<ReviewCommentIndex | null>;
  readonly commentsSeqRef: RefObject<number>;
  readonly committedProjectionGenerationRef: RefObject<number>;
  readonly context: RendererPluginContext;
  readonly currentDemandRef: RefObject<ReviewDocumentDemand>;
  readonly diffHandleRef: RefObject<PierDiffViewHandle | null>;
  readonly diffBase: GitReviewReadingSurface;
  readonly documentControllerRef: RefObject<GitReviewDocumentGeneration | null>;
  readonly documentGenerationRef: RefObject<number>;
  readonly entries: readonly GitReviewIndexEntry[];
  readonly entryKeyBySectionIdRef: RefObject<ReadonlyMap<string, string>>;
  readonly firstSectionIdByEntryKeyRef: RefObject<ReadonlyMap<string, string>>;
  readonly generationCallbacksRef: RefObject<GitReviewGenerationCallbacks>;
  readonly indexGeneration: number;
  readonly itemCacheKeysRef: RefObject<Map<string, string>>;
  readonly itemIdsRef: RefObject<readonly string[]>;
  readonly loaderRef: RefObject<GitReviewDocumentLoader | null>;
  readonly previousSnapshotRef: {
    current: GitReviewDocumentLoaderSnapshot;
  };
  readonly projectedLocaleRef: RefObject<string>;
  readonly projectionLocaleRef: RefObject<string>;
  readonly renderWindowRef: RefObject<PierDiffViewRenderWindow | null>;
  readonly scope: GitReviewScope;
  readonly scopeKeyRef: RefObject<string | null>;
  readonly seedEntryKeysRef: RefObject<readonly string[]>;
  readonly setProjection: Dispatch<SetStateAction<ReviewDocumentProjection>>;
  readonly setProjectionGeneration: Dispatch<SetStateAction<number>>;
  readonly setViewState: Dispatch<SetStateAction<ReviewDocumentViewState>>;
  readonly demandPrefetchEntryKeysRef: {
    current: ReadonlySet<string>;
  };
  readonly viewStateRef: RefObject<ReviewDocumentViewState>;
}): void {
  const { context, diffBase, entries, indexGeneration, scope } = options;

  // 代际 effect 只随 index/scope 重建；refs/setState 故意不进 deps。
  // biome-ignore lint/correctness/useExhaustiveDependencies: generation lifecycle is ref-driven
  useEffect(
    () => mountGitReviewDocumentGeneration(options),
    [context, diffBase, entries, indexGeneration, scope]
  );
}

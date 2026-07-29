import type {
  PierDiffViewAnchor,
  PierDiffViewItem,
  PierHunkActionEvent,
} from "@pier/ui/diff-view.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type {
  GitReviewIndexEntry,
  GitReviewMutationOk,
} from "@shared/contracts/git-review.ts";
import type {
  GitReviewMutationLease,
  GitReviewMutationTransition,
} from "./git-review-reading-surface.ts";

export interface UseGitReviewCodeMutationsOptions {
  readonly captureReadingAnchor?: (itemId: string) => PierDiffViewAnchor | null;
  readonly context: RendererPluginContext;
  readonly contextId: string;
  readonly entries?: readonly GitReviewIndexEntry[];
  readonly gitRootPath?: string;
  readonly items: readonly PierDiffViewItem[];
  readonly mutationBlocked?: boolean;
  readonly onMutationCommitted?: (
    result: GitReviewMutationOk | null,
    transition?: GitReviewMutationTransition
  ) => Promise<void>;
  readonly onMutationStart?: () => GitReviewMutationLease | null;
  readonly revisionBySectionId: ReadonlyMap<string, string>;
}

export interface UseGitReviewCodeMutationsResult {
  readonly canMutate: boolean;
  readonly displayItems: readonly PierDiffViewItem[];
  readonly onDiscardFile: (itemId: string) => void;
  readonly onHunkAction: (event: PierHunkActionEvent) => void;
  readonly onOpenFile: (itemId: string) => void;
  readonly onToggleStage: (itemId: string) => void;
}

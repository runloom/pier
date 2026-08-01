import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type {
  GitReviewFailure,
  GitReviewGroup,
  GitReviewIndexEntry,
  GitReviewIndexOk,
  GitReviewMutationOk,
  GitReviewScope,
} from "@shared/contracts/git/review.ts";
import type {
  GitReviewMutationLease,
  GitReviewMutationTransition,
  GitReviewReadingSurface,
} from "./reading-surface.ts";
import type { gitReviewTreeModel } from "./tree.tsx";

export type { UncommittedGitReviewSurface } from "./reading-surface.ts";

export interface ReviewSurfaceNavigationRequest {
  /**
   * 只有显式用户导航可以改变活动阅读面。
   * mutation 协调只在后台准备目标正文，不能夺取当前阅读视角。
   */
  readonly activation: "activate" | "preserve";
  readonly anchorOffset?: number;
  readonly entryKey: string;
  readonly itemId: string;
  readonly minimumIndexGeneration?: number;
  readonly nonce: number;
  readonly surface: GitReviewReadingSurface;
  readonly treeSectionKey: string;
}

/** 活动面的正文工具条能力（折叠等），由共享 header trailing 消费 */
export interface ReviewActiveChrome {
  readonly allCollapsed: boolean;
  readonly onToggleCollapseAll: () => void;
}

export interface ReviewSurfaceProps {
  readonly active: boolean;
  readonly activeSurface: GitReviewReadingSurface;
  readonly context: RendererPluginContext;
  readonly diffBase: GitReviewReadingSurface;
  readonly entries: readonly GitReviewIndexEntry[];
  readonly groupSummaries: GitReviewIndexOk["groupSummaries"];
  readonly headerLeading?: React.ReactNode;
  readonly indexGeneration: number;
  readonly indexRefreshFailure: GitReviewFailure | null;
  readonly indexRefreshing?: boolean;
  readonly mutationAuthorityBlocked: boolean;
  readonly navigationRequest: ReviewSurfaceNavigationRequest | null;
  readonly onAcquireMutationAuthority: () => GitReviewMutationLease | null;
  readonly onActiveChromeChange?: (chrome: ReviewActiveChrome | null) => void;
  readonly onMutationCommitted: (
    result: GitReviewMutationOk | null
  ) => Promise<void>;
  readonly onMutationTransition: (
    transition: GitReviewMutationTransition
  ) => void;
  readonly onNavigationMaterialized: (
    request: ReviewSurfaceNavigationRequest
  ) => void;
  readonly onRequestTreeOpen: (
    entryKey: string,
    sectionKey: string,
    group: GitReviewGroup
  ) => void;
  readonly onRetryIndex: () => void;
  readonly onSelectSurface: (surface: GitReviewReadingSurface) => void;
  readonly onSurfaceNavigationSettled: (
    request: ReviewSurfaceNavigationRequest
  ) => void;
  readonly panelId: string;
  readonly panelVisible: boolean;
  readonly scope: GitReviewScope;
  readonly setSidebarCollapsed: (collapsed: boolean) => void;
  readonly sidebarCollapsed: boolean;
  readonly sidebarFooter?: React.ReactNode;
  readonly sidebarHeader?: React.ReactNode;
  readonly targetSelectionPending?: boolean;
  readonly treeModel: ReturnType<typeof gitReviewTreeModel>;
  readonly warnings: GitReviewIndexOk["warnings"];
}

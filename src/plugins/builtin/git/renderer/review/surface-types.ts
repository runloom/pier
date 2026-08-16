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

/** 页签切面后对分组根做一次目录式 reveal。 */
export interface ReviewTreeFocus {
  readonly nonce: number;
  readonly path: string;
}

/**
 * 评论 / 编辑器 gutter reveal 跳转意图（→ git changes 面板）。
 * 经 panel params 透传到 ReviewDocuments，反查 entryKey/sectionKey 后调
 * onRequestTreeOpen(reveal) 触发 section 导航 + 行级 scrollToLine。
 * nonce 用于去重（同 nonce 不重复触发）。
 *
 * - 评论状态栏跳转：必填 group + 可设 allowGroupFallback（stage/unstage 后
 *   preferred group 槽位消失时回退；解析仍优先 preferred group）。
 * - Files gutter：可 omit group 并设 allowGroupFallback，按 entry 实际 slot 回退。
 * - index 刷新中 path/group 短暂 miss 时不消费 nonce（见 planPendingReveal）。
 */
export interface PendingCommentReveal {
  /**
   * true：preferred group 不可用时按 unstaged → staged → conflict 回退到 entry
   * 上存在的 slot。始终先试 preferred group，避免无故跨 group。
   */
  readonly allowGroupFallback?: boolean;
  readonly group?: GitReviewGroup;
  readonly line: number;
  readonly nonce: number;
  readonly path: string;
  readonly side: "new" | "old";
}

/** onRequestTreeOpen 携带的行级 reveal（评论 reveal 专用）。 */
export interface ReviewTreeOpenReveal {
  readonly line: number;
  readonly side: "new" | "old";
}

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
  /** 行级 reveal：section 导航物化后 scrollToLine 到此行（评论 reveal）。 */
  readonly revealLine?: number;
  /** revealLine 的 diff 侧（评论 target.side "old"|"new"）。 */
  readonly revealSide?: "new" | "old";
  readonly surface: GitReviewReadingSurface;
  readonly treeSectionKey: string;
}

/**
 * 构造 activate navigation request（requestTreeOpen 共享）。
 * reveal 携带评论行级定位：section 导航物化后 handoff 调 scrollToLine。
 */
export function buildActivateNavigationRequest(
  nonce: number,
  entryKey: string,
  sectionKey: string,
  surface: GitReviewReadingSurface,
  reveal?: ReviewTreeOpenReveal
): ReviewSurfaceNavigationRequest {
  return {
    activation: "activate",
    entryKey,
    itemId: sectionKey,
    nonce,
    surface,
    treeSectionKey: sectionKey,
    ...(reveal === undefined
      ? {}
      : { revealLine: reveal.line, revealSide: reveal.side }),
  };
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
  /** Clear dockview params after comment reveal handoff starts. */
  readonly onPendingRevealHandled?: () => void;
  readonly onRequestTreeOpen: (
    entryKey: string,
    sectionKey: string,
    group: GitReviewGroup,
    reveal?: ReviewTreeOpenReveal
  ) => void;
  readonly onRetryIndex: () => void;
  readonly onSelectSurface: (surface: GitReviewReadingSurface) => void;
  readonly onSurfaceNavigationSettled: (
    request: ReviewSurfaceNavigationRequest
  ) => void;
  readonly panelId: string;
  readonly panelVisible: boolean;
  /** 评论 reveal 意图（状态栏跳转）；反查后触发 onRequestTreeOpen(reveal)。 */
  readonly pendingReveal?: PendingCommentReveal | null;
  readonly scope: GitReviewScope;
  readonly setSidebarCollapsed: (collapsed: boolean) => void;
  readonly sidebarCollapsed: boolean;
  readonly sidebarFooter?: React.ReactNode;
  readonly sidebarHeader?: React.ReactNode;
  readonly targetSelectionPending?: boolean;
  readonly treeModel: ReturnType<typeof gitReviewTreeModel>;
  readonly warnings: GitReviewIndexOk["warnings"];
}

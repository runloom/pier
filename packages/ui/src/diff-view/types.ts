import type { Ref } from "react";
import type { PierDiffViewLabels } from "./collapse.tsx";

export type { PierDiffViewLabels } from "./collapse.tsx";

import type {
  PierDriftCommentLabels,
  PierGutterReviewEvent,
} from "./gutter/gutter-comments.tsx";
import type { PierHunkActionEvent } from "./hunk-actions.tsx";
import type { PierDiffViewImageDiff } from "./image-diff/types.ts";
import type { PierDiffReviewCommentThread, PierDiffViewItem } from "./items.ts";
import type { PierDiffViewRenderWindow } from "./render-window.ts";
import type { PierActiveReviewSlot } from "./review/annotation-anchors.ts";
import type {
  PierInlineReviewHandlers,
  PierInlineReviewLabels,
  PierInlineReviewThread,
} from "./review/inline-comment-types.ts";
import type { PierUnresolvedConflictHost } from "./unresolved-conflict/host-types.ts";
import type { PierDiffViewHandle } from "./use-handle.ts";

export interface PierDiffViewAppearance {
  readonly codeFontFamily: string;
  /** Resolved code body size, e.g. "13px" from settings `codeFontSize`. */
  readonly codeFontSize: string;
  /**
   * Dual Shiki theme names for the current style preset.
   * Pierre dual-theme mode: tokens use CSS variables; {@link colorMode}
   * selects light/dark without re-tokenizing.
   */
  readonly codeThemes: {
    readonly dark: string;
    readonly light: string;
  };
  readonly colorMode: "dark" | "light";
}

export interface PierDiffViewPresentation {
  readonly diffStyle: "split" | "unified";
  readonly wrapLines: boolean;
}

export interface PierDiffViewProps {
  /**
   * 激活态单调计数：每次 {@link activeReviewSlotsByItem} 变化时 +1，驱动
   * 受影响 item 的 annotation version bump，让 @pierre/diffs 重建行内
   * 槽位 + remeasure。与 {@link activeReviewSlotsByItem} 同源提供。
   */
  readonly activeReviewEpoch?: number;
  /**
   * itemId → 当前激活的行内评论槽（视图级激活态）。host review hook 据此
   * 注入行内线程卡 / 草稿卡 annotation；缺省无行内展开（仅 gutter 入口）。
   */
  readonly activeReviewSlotsByItem?: ReadonlyMap<
    string,
    readonly PierActiveReviewSlot[]
  >;
  readonly appearance: PierDiffViewAppearance;
  /** drift 评论 chip aria/title 文案（行内漂移 + 文件级）。 */
  readonly driftCommentLabels?: PierDriftCommentLabels;
  /**
   * 同步闸门（layout 可读）：与 pendingNavigationRef 同源，
   * 避免仅依赖 React state 时同帧 membership apply 漏 suppress。
   */
  readonly getSuppressMembershipScrollRestore?: () => boolean;
  /**
   * Host-owned preview tickets for `kind: "image"` items (GitHub-style
   * 2-up / swipe / onion). Omit when the view has no image diffs.
   */
  readonly imageDiff?: PierDiffViewImageDiff;
  /**
   * 行内评论写操作回调（host 提供）。与 {@link inlineReviewLabels} +
   * {@link inlineReviewThreadById} 同时提供时，激活态的 review annotation
   * 渲染行内线程卡 / 草稿卡并完成写操作。
   */
  readonly inlineReviewHandlers?: PierInlineReviewHandlers;
  /** 行内评论卡 i18n 文案（host 注入，禁止卡片内联用户串）。 */
  readonly inlineReviewLabels?: PierInlineReviewLabels;
  /**
   * threadId → 行内线程完整数据（卡片渲染用）。激活态的 thread 槽据此
   * 查询完整评论列表；缺省无行内线程卡（仅 gutter 计数入口）。
   */
  readonly inlineReviewThreadById?: ReadonlyMap<string, PierInlineReviewThread>;
  readonly items: readonly PierDiffViewItem[];
  readonly labels: PierDiffViewLabels;
  /**
   * 行内评论卡 locale（相对时间格式化用，与 {@link inlineReviewLabels}
   * 同源）。缺省时行内卡不渲染（gutter 入口仍可用）。
   */
  readonly locale?: string;
  /** Discard unstaged working-tree changes for a multi-diff item id. */
  readonly onDiscardFile?: (itemId: string) => void;
  /**
   * 文件级 drift 评论 chip 点击（host 据此打开线程卡）。
   * 与 {@link driftCommentLabels} 同时提供时，有 drift 评论的文件 header 显示 chip。
   */
  readonly onDriftCommentActivate?: (threadId: string) => void;
  readonly onError: (error: Error) => void;
  /**
   * Diff 行内评论 gutter 入口激活（host 据此在该行打开新建草稿）。
   * 提供即开启原生 gutter `+` 入口；已有评论恒常驻行内渲染。
   */
  readonly onGutterReviewActivate?: (event: PierGutterReviewEvent) => void;
  /**
   * Codex-style per-hunk Stage / Unstage / Revert (Pierre annotations +
   * renderAnnotation). When set, items with changeControls get block toolbars.
   */
  readonly onHunkAction?: (event: PierHunkActionEvent) => void;
  readonly onItemError?: (id: string, error: Error | null) => void;
  /** Open the file for a multi-diff item id (header title click). */
  readonly onOpenFile?: (itemId: string) => void;
  readonly onRenderWindowChange?: (window: PierDiffViewRenderWindow) => void;
  /**
   * error 槽行内重试（document materialize 失败等）；
   * 与 `labels.retry` 同时提供时 header 显示 Retry。
   */
  readonly onRetryItem?: (itemId: string) => void;
  readonly onScroll?: () => void;
  /** Toggle uncommitted stage for a canonical multi-diff item id (entryKey). */
  readonly onToggleStage?: (itemId: string) => void;
  /** 缺省 split + 不换行(既有行为)。变更会强制 CodeView 重建。 */
  readonly presentation?: PierDiffViewPresentation;
  readonly ref?: Ref<PierDiffViewHandle>;
  /**
   * itemId → 该文件 diff 行内评论线程（host 投影后注入）。gutter 按
   * (side, lineNumber) 查询渲染入口；缺省无评论入口。
   */
  readonly reviewCommentsById?: ReadonlyMap<
    string,
    readonly PierDiffReviewCommentThread[]
  >;
  /**
   * 树导航 pending 时禁止成员变更后的 scrollTop 硬恢复，
   * 避免与 scrollTo(target) 双意图（full-alignment K5）。
   */
  readonly suppressMembershipScrollRestore?: boolean;
  /**
   * Host for merge-conflict items: UnresolvedFile / File in the annotation
   * body, CodeView file chrome unchanged. Omit when the view has none.
   */
  readonly unresolvedConflict?: PierUnresolvedConflictHost;
}

export type PierDiffViewConflictPresentation =
  | "markers-text"
  | "file-level"
  | "binary"
  | "tooLarge"
  | "invalidEncoding"
  | "readError";

export type PierDiffViewConflictXy =
  | "DD"
  | "AU"
  | "UD"
  | "UA"
  | "DU"
  | "AA"
  | "UU";

/** Conflict payload for review host (not consumed by CodeView). */
export interface PierDiffViewConflictBody {
  readonly contents: string | null;
  readonly contentsDigest: string;
  readonly presentation: PierDiffViewConflictPresentation;
  readonly stages: {
    readonly baseOid: string | null;
    readonly oursOid: string | null;
    readonly theirsOid: string | null;
  };
  readonly xy: PierDiffViewConflictXy;
}

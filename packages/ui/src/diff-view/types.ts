import type { Ref } from "react";
import type { PierDiffViewLabels } from "./collapse.tsx";

export type { PierDiffViewLabels } from "./collapse.tsx";

import type { PierHunkActionEvent } from "./hunk-actions.tsx";
import type { PierDiffViewItem } from "./items.ts";
import type { PierDiffViewRenderWindow } from "./render-window.ts";
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
  readonly appearance: PierDiffViewAppearance;
  /**
   * 同步闸门（layout 可读）：与 pendingNavigationRef 同源，
   * 避免仅依赖 React state 时同帧 membership apply 漏 suppress。
   */
  readonly getSuppressMembershipScrollRestore?: () => boolean;
  readonly items: readonly PierDiffViewItem[];
  readonly labels: PierDiffViewLabels;
  /** Discard unstaged working-tree changes for a multi-diff item id. */
  readonly onDiscardFile?: (itemId: string) => void;
  readonly onError: (error: Error) => void;
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
   * 树导航 pending 时禁止成员变更后的 scrollTop 硬恢复，
   * 避免与 scrollTo(target) 双意图（full-alignment K5）。
   */
  readonly suppressMembershipScrollRestore?: boolean;
}

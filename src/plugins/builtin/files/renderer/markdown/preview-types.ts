/**
 * Markdown preview public props + internal ready/loading state types.
 */
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { MouseEvent as ReactMouseEvent, RefObject } from "react";
import type { MarkdownCodeHighlighter } from "./code-highlighter.ts";
import type { MarkdownPreviewCommentLabels } from "./comments/preview-layer.tsx";
import type { MarkdownCrossModeAnchor } from "./cross-mode-anchor.ts";
import type { MarkdownIrDocument } from "./ir.ts";
import type {
  MarkdownDiskSource,
  MarkdownFileResources,
  MarkdownInternalTarget,
  MarkdownRendererLabels,
} from "./ir-renderer.tsx";
import type {
  MarkdownPreviewTocLabels,
  MarkdownPreviewZoomLabels,
} from "./preview-defaults.ts";
import type { MarkdownPagination, MarkdownRuntime } from "./runtime.ts";
import type { TaskToggleInput } from "./task-patch.ts";
import type { MarkdownPreviewSearchLabels } from "./use-preview-search.ts";

export interface MarkdownPreviewProps {
  appearance?: RendererPluginContext["appearance"] | undefined;
  /** Capture callback for preview → source switch; cleared when not ready. */
  captureAnchorRef?:
    | RefObject<(() => MarkdownCrossModeAnchor | null) | null>
    | undefined;
  charts?: RendererPluginContext["charts"] | undefined;
  codeHighlighter?: MarkdownCodeHighlighter | undefined;
  codeTheme?: string | undefined;
  commentLabels?: MarkdownPreviewCommentLabels | undefined;
  commentsContext?: RendererPluginContext | undefined;
  /** One-shot content restore after source → preview mode switch. */
  contentAnchor?: MarkdownCrossModeAnchor | undefined;
  contentAnchorRequestId?: string | number | undefined;
  /** Heading anchor copy channel; host owns clipboard + toast/alert feedback. */
  copyAnchor?: ((anchor: string) => Promise<void>) | undefined;
  copyCode?: ((code: string) => Promise<void>) | undefined;
  errorLabel?: string | undefined;
  fileResources?: MarkdownFileResources | undefined;
  initialAnchor?: string | undefined;
  initialAnchorRequestId?: string | undefined;
  labels?: MarkdownRendererLabels | undefined;
  liveModules?: RendererPluginContext["liveModules"] | undefined;
  onContextMenu?:
    | ((event: ReactMouseEvent<HTMLDivElement>) => void)
    | undefined;
  onJumpToSource?: ((offset: number) => void) | undefined;
  /** Host task-checkbox toggle; writes the patched contents back via the document model. */
  onToggleTask?: ((input: TaskToggleInput) => void) | undefined;
  onToggleWordWrap?: (() => void) | undefined;
  openExternal: (url: string) => void;
  openInternal?: ((target: MarkdownInternalTarget) => void) | undefined;
  /** Dockview panel instance id — used for select-all provider scope. */
  panelId?: string | undefined;
  registerSelectionSelectAllProvider?:
    | RendererPluginContext["contextMenu"]["registerSelectionSelectAllProvider"]
    | undefined;
  relativeCommentPath?: string | undefined;
  runtime?: MarkdownRuntime | undefined;
  searchLabels?: MarkdownPreviewSearchLabels | undefined;
  searchRequest?: number | undefined;
  sessionId: string;
  source?: MarkdownDiskSource | undefined;
  tocLabels?: MarkdownPreviewTocLabels | undefined;
  value: string;
  worktreeKey?: string | undefined;
  zoomLabels?: MarkdownPreviewZoomLabels | undefined;
}

export type MarkdownPreviewState =
  | { status: "loading" }
  | {
      document: MarkdownIrDocument;
      pagination: MarkdownPagination;
      status: "ready";
    }
  | { status: "error" };

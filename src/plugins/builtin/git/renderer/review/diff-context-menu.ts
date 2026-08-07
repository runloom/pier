// 模块级粘性：与 packages/ui 同构，避免 handle 为空时复制项一直灰。
import {
  getDiffCopyStickyText,
  pinDiffCopyStickyText,
} from "@pier/ui/diff-view/copy-sticky.ts";
import type {
  PierDiffViewHandle,
  PierDiffViewItem,
} from "@pier/ui/diff-view/index.tsx";
import { readBrowserSelectedText } from "@pier/ui/diff-view/pointer-selection.ts";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import type { MouseEvent as ReactMouseEvent } from "react";
import { pluginText } from "../plugin-text.ts";
import { panelContextFromReviewGitRoot } from "./context/from-git-root.ts";
import {
  GIT_REVIEW_DIFF_SURFACE,
  type GitReviewDiffOpenMetadata,
} from "./diff-actions.ts";
import { resolveGitReviewDiffOpenTarget } from "./diff-open-target.ts";

export function openGitReviewDiffContextMenu(options: {
  readonly context: RendererPluginContext;
  readonly contextId: string;
  readonly event: ReactMouseEvent;
  readonly gitRootPath: string;
  readonly handle: PierDiffViewHandle | null | undefined;
  readonly items: readonly PierDiffViewItem[];
  readonly sourcePanelComponent?: string;
  readonly sourcePanelContext?: PanelContext | null;
  readonly sourcePanelId?: string;
}): void {
  const {
    context,
    contextId,
    event,
    gitRootPath,
    handle,
    items,
    sourcePanelComponent,
    sourcePanelContext,
    sourcePanelId,
  } = options;

  // preventDefault 前钉住非空文本 → metadata.selectedText → 复制 enabled。
  // live → handle（含粘性）→ 模块粘性；读选区与 sticky pin 共用 readBrowserSelectedText。
  let selectedText = readBrowserSelectedText();
  if (selectedText.length === 0) {
    selectedText = handle?.getSelectedText() ?? "";
  }
  if (selectedText.length === 0) {
    selectedText = getDiffCopyStickyText();
  }
  if (selectedText.length > 0) {
    pinDiffCopyStickyText(selectedText);
  }
  event.preventDefault();
  event.stopPropagation();

  const target = resolveGitReviewDiffOpenTarget({
    event: event.nativeEvent,
    handle,
    items,
  });

  const openMetadata: GitReviewDiffOpenMetadata | null = target
    ? {
        contextId,
        gitRootPath,
        path: target.path,
        ...(target.line === undefined ? {} : { line: target.line }),
      }
    : null;

  context.contextMenu
    .popup(
      GIT_REVIEW_DIFF_SURFACE,
      { x: event.clientX, y: event.clientY },
      {
        metadata: {
          ...(selectedText.length > 0 ? { selectedText } : {}),
          ...(openMetadata ?? {}),
        },
        ...(sourcePanelComponent ? { sourcePanelComponent } : {}),
        ...(sourcePanelId ? { sourcePanelId } : {}),
        sourcePanelContext: panelContextFromReviewGitRoot({
          contextId,
          gitRootPath,
          ...(sourcePanelContext ? { sourcePanelContext } : {}),
        }),
      }
    )
    .catch((err: unknown) => {
      context.dialogs
        .alert({
          body: err instanceof Error ? err.message : String(err),
          title: pluginText(
            context,
            "reviewDiffContextMenuFailed",
            "Unable to open menu"
          ),
        })
        .catch(() => undefined);
    });
}

// 模块级粘性：与 packages/ui 同构，避免 handle 为空时复制项一直灰。

import type {
  PierDiffViewHandle,
  PierDiffViewItem,
} from "@pier/ui/diff-view/index.tsx";
import { readBrowserSelectedText } from "@pier/ui/diff-view/pointer-selection.ts";
import {
  getDiffCopyStickyText,
  pinDiffCopyStickyText,
} from "@pier/ui/diff-view/selection/copy-sticky.ts";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  type GitReviewIndexEntry,
  gitReviewConflictCanOpen,
} from "@shared/contracts/git/review.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import type { MouseEvent as ReactMouseEvent } from "react";
import { pluginText } from "../plugin-text.ts";
import { panelContextFromReviewGitRoot } from "./context/from-git-root.ts";
import {
  GIT_REVIEW_DIFF_SURFACE,
  type GitReviewDiffOpenMetadata,
} from "./diff-actions.ts";
import {
  resolveGitReviewDiffCopyRange,
  resolveGitReviewDiffOpenTarget,
} from "./diff-open-target.ts";

export function openGitReviewDiffContextMenu(options: {
  readonly context: RendererPluginContext;
  readonly contextId: string;
  readonly event: ReactMouseEvent;
  readonly gitRootPath: string;
  readonly entries?: readonly GitReviewIndexEntry[];
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
    entries,
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
  // Header and nested conflict bodies share the native CodeView host identity.
  // Never substitute a previous line selection for a file-level command.
  const pointerHit = handle?.resolvePointerLineHit(event.nativeEvent);
  const pointerHost = event.nativeEvent
    .composedPath()
    .find(
      (node) =>
        node instanceof Element && node.hasAttribute("data-pier-file-host")
    );
  const pointerItemId =
    pointerHost instanceof Element
      ? pointerHost.getAttribute("data-pier-file-host")
      : pointerHit?.id;
  const pointerItem = items.find((item) => item.id === pointerItemId);
  const pointerPath = pointerItem?.fileDisplay?.path;
  const conflict = pointerItem?.conflict;
  const conflictEntry = pointerPath
    ? entries?.find((entry) =>
        entry.renderSlots.some(
          (slot) =>
            slot.group === "conflict" &&
            slot.targetPath === pointerPath &&
            slot.xy === conflict?.xy
        )
      )
    : undefined;
  const conflictMetadata =
    conflictEntry &&
    conflict &&
    pointerItem?.kind !== "estimate" &&
    !conflict.contentsDigest.startsWith("estimate:")
      ? {
          source: {
            contextId,
            gitRootPath,
            oldPaths: conflictEntry.oldPaths,
            path: pointerPath,
            target: { kind: "uncommitted" },
          },
          xy: conflict.xy,
          presentation: conflict.presentation,
          contentsDigest: conflict.contentsDigest,
          readable: conflict.contents !== null,
        }
      : undefined;

  const path = pointerPath ?? target?.path;
  const pointerLine =
    pointerPath && pointerPath !== target?.path
      ? pointerHit?.lineNumber
      : (target?.line ?? pointerHit?.lineNumber);
  const openMetadata: GitReviewDiffOpenMetadata | null = path
    ? {
        contextId,
        gitRootPath,
        path,
        ...(pointerLine === undefined ? {} : { line: pointerLine }),
      }
    : null;
  const itemId = pointerItemId ?? handle?.getSelectedLines()?.id;
  const copyRange = resolveGitReviewDiffCopyRange({
    handle,
    ...(itemId ? { itemId } : {}),
    ...(pointerLine === undefined ? {} : { line: pointerLine }),
  });

  context.contextMenu
    .popup(
      GIT_REVIEW_DIFF_SURFACE,
      { x: event.clientX, y: event.clientY },
      {
        metadata: {
          ...(selectedText.length > 0 ? { selectedText } : {}),
          ...(openMetadata ?? {}),
          ...(pointerItem?.conflict
            ? { openable: gitReviewConflictCanOpen(pointerItem.conflict.xy) }
            : {}),
          ...(conflictMetadata ? { conflict: conflictMetadata } : {}),
          ...(copyRange
            ? {
                selectionEndLine: copyRange.endLine,
                selectionStartLine: copyRange.startLine,
              }
            : {}),
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

import type {
  PierDiffViewHandle,
  PierDiffViewItem,
} from "@pier/ui/diff-view/index.tsx";
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

  // Snapshot line selection before preventDefault so sticky copy text stays.
  const selectedText = handle?.getSelectedText() ?? "";
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

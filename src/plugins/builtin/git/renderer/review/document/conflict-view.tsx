import type {
  PierDiffViewAppearance,
  PierDiffViewItem,
  PierDiffViewPresentation,
} from "@pier/ui/diff-view/index.tsx";
import {
  conflictStageTexts,
  PierConflictStageDiff,
  PierUnresolvedConflictView,
} from "@pier/ui/diff-view/index.tsx";
import type { RendererPluginAppearance } from "@plugins/api/renderer.ts";
import type { GitReviewConflictXy } from "@shared/contracts/git/review.ts";
import { gitReviewConflictCanOpen } from "@shared/contracts/git/review.ts";
import { useMemo } from "react";
import type { useReviewUnresolvedConflictHost } from "./conflict-host.tsx";

type ConflictHost = NonNullable<
  ReturnType<typeof useReviewUnresolvedConflictHost>
>;

/**
 * One selected conflict fills the reading surface.
 * Marker text uses UnresolvedFile. A missing worktree uses the stage blobs
 * as the only body. Readable worktree text stays on File, next to the card.
 */
export function ReviewConflictView(options: {
  readonly appearance: RendererPluginAppearance;
  readonly host: ConflictHost;
  readonly item: PierDiffViewItem;
  readonly onOpenFile?: (path: string) => void;
  readonly presentation?: PierDiffViewPresentation;
}): React.JSX.Element | null {
  const { appearance, host, item, onOpenFile } = options;
  const conflict = item.conflict;
  const path = item.fileDisplay?.path;
  const pierAppearance = useMemo<PierDiffViewAppearance>(
    () => ({
      codeFontFamily: appearance.typography.codeFontFamily,
      codeFontSize: appearance.typography.codeFontSize,
      codeThemes: appearance.codeThemes,
      colorMode: appearance.theme,
    }),
    [appearance]
  );
  if (conflict === undefined || path === undefined) {
    return null;
  }
  const busy = host.mutationLocked || host.busyItemId === item.id;
  const canOpen =
    onOpenFile !== undefined &&
    gitReviewConflictCanOpen(conflict.xy as GitReviewConflictXy);
  const fileLevel = host.renderFileLevel?.({
    busy,
    conflict,
    itemId: item.id,
    path,
    ...(item.stateNotice === undefined
      ? {}
      : { stateNotice: item.stateNotice }),
  });
  const stageTexts = conflictStageTexts(conflict);
  if (conflict.contents === null) {
    return (
      <div
        className="flex h-full min-h-0 min-w-0 flex-col"
        data-git-review-conflict-view=""
      >
        {stageTexts !== null && host.onError !== undefined ? (
          <>
            {fileLevel}
            <PierConflictStageDiff
              appearance={pierAppearance}
              {...(options.presentation === undefined
                ? {}
                : { diffStyle: options.presentation.diffStyle })}
              labels={host.labels}
              onError={host.onError}
              ours={stageTexts.ours}
              path={path}
              theirs={stageTexts.theirs}
            />
          </>
        ) : (
          <>
            {item.stateNotice === undefined ? null : (
              <p className="px-5 py-3 text-muted-foreground text-sm">
                {item.stateNotice}
              </p>
            )}
            {fileLevel}
          </>
        )}
      </div>
    );
  }
  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-col"
      data-git-review-conflict-view=""
    >
      {fileLevel}
      <div className="min-h-0 flex-1 overflow-auto">
        <PierUnresolvedConflictView
          appearance={pierAppearance}
          busy={busy}
          conflict={conflict}
          labels={host.labels}
          {...(host.onError === undefined ? {} : { onError: host.onError })}
          {...(canOpen ? { onOpenFile: () => onOpenFile(path) } : {})}
          {...(conflict.presentation === "file-level" &&
          host.onResolveFile !== undefined
            ? {
                onStageFile: () => {
                  host.onResolveFile?.(item.id, "stage");
                },
              }
            : {})}
          onWriteResolved={(payload) => host.onWriteResolved(item.id, payload)}
          path={path}
        />
      </div>
    </div>
  );
}

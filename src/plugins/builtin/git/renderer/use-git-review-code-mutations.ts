import type {
  PierDiffViewChangeControl,
  PierDiffViewStageControl,
  PierHunkActionEvent,
} from "@pier/ui/diff-view.tsx";
import { useCallback, useMemo, useRef, useState } from "react";
import { notifyError } from "./git-command-helpers.ts";
import { pluginText } from "./git-plugin-text.ts";
import {
  displayReviewItemsWithMutationPending,
  resolveReviewMutationSection,
  reviewMutationSource,
  showReviewMutationFailure,
  withReviewMutationPending,
} from "./git-review-code-mutation-helpers.ts";
import type {
  UseGitReviewCodeMutationsOptions,
  UseGitReviewCodeMutationsResult,
} from "./git-review-code-mutation-types.ts";
import {
  confirmGitDiscard,
  partitionDiscardPaths,
} from "./git-review-discard.ts";
import type { GitReviewMutationLease } from "./git-review-reading-surface.ts";
import { useGitReviewOpenFile } from "./use-git-review-open-file.ts";

const ALWAYS_ACQUIRE_MUTATION_AUTHORITY = (): GitReviewMutationLease => ({
  minimumIndexGeneration: 0,
});

export function useGitReviewCodeMutations(
  options: UseGitReviewCodeMutationsOptions
): UseGitReviewCodeMutationsResult {
  const {
    captureReadingAnchor,
    context,
    contextId,
    entries,
    gitRootPath,
    items,
    mutationBlocked = false,
    onMutationStart = ALWAYS_ACQUIRE_MUTATION_AUTHORITY,
    onMutationCommitted,
    revisionBySectionId,
  } = options;
  const [pendingFileActions, setPendingFileActions] = useState(
    () =>
      new Map<string, NonNullable<PierDiffViewStageControl["pendingAction"]>>()
  );
  const [pendingChangeActions, setPendingChangeActions] = useState(
    () =>
      new Map<string, NonNullable<PierDiffViewChangeControl["pendingAction"]>>()
  );
  const entriesRef = useRef(entries);
  const captureReadingAnchorRef = useRef(captureReadingAnchor);
  const itemsRef = useRef(items);
  const onMutationCommittedRef = useRef(onMutationCommitted);
  const revisionBySectionIdRef = useRef(revisionBySectionId);
  const pendingFileActionsRef = useRef(pendingFileActions);
  const pendingChangeActionsRef = useRef(pendingChangeActions);
  const mutationBlockedRef = useRef(mutationBlocked);
  const onMutationStartRef = useRef(onMutationStart);
  entriesRef.current = entries;
  captureReadingAnchorRef.current = captureReadingAnchor;
  itemsRef.current = items;
  onMutationCommittedRef.current = onMutationCommitted;
  revisionBySectionIdRef.current = revisionBySectionId;
  pendingFileActionsRef.current = pendingFileActions;
  pendingChangeActionsRef.current = pendingChangeActions;
  mutationBlockedRef.current = mutationBlocked;
  onMutationStartRef.current = onMutationStart;

  const displayItems = useMemo(
    () =>
      displayReviewItemsWithMutationPending(
        items,
        pendingFileActions,
        pendingChangeActions
      ),
    [items, pendingChangeActions, pendingFileActions]
  );

  const onToggleStage = useCallback(
    (itemId: string) => {
      if (
        mutationBlockedRef.current ||
        !(entriesRef.current && gitRootPath) ||
        pendingFileActionsRef.current.has(itemId)
      ) {
        return;
      }
      const item = itemsRef.current.find(
        (candidate) => candidate.id === itemId
      );
      const stageState = item?.stageControl?.state;
      if (!stageState) {
        return;
      }
      const targetSectionKey = item.stageControl?.targetSectionKey ?? itemId;
      const resolved = resolveReviewMutationSection(
        entriesRef.current,
        itemsRef.current,
        targetSectionKey
      );
      const expectedRevision = revisionBySectionIdRef.current.get(itemId);
      if (!(resolved && expectedRevision)) {
        return;
      }
      const source = reviewMutationSource(
        contextId,
        gitRootPath,
        resolved.entry
      );
      if (source === null) {
        return;
      }
      const action = stageState === "staged" ? "unstage" : "stage";
      const anchor = captureReadingAnchorRef.current?.(itemId);
      const lease = onMutationStartRef.current();
      if (lease === null) {
        return;
      }
      withReviewMutationPending(
        setPendingFileActions,
        pendingFileActionsRef,
        itemId,
        action,
        async () => {
          try {
            const result = await context.git.applyReviewMutation({
              action,
              expectedRevision,
              operationId: crypto.randomUUID(),
              source,
              target: { kind: "file", sectionKey: targetSectionKey },
            });
            if (result.kind !== "ok") {
              const authorityRefresh =
                onMutationCommittedRef.current?.(null) ?? Promise.resolve();
              await showReviewMutationFailure(
                context,
                stageState === "staged"
                  ? pluginText(
                      context,
                      "reviewTreeUnstageFailed",
                      "Unable to Unstage"
                    )
                  : pluginText(
                      context,
                      "reviewTreeStageFailed",
                      "Unable to Stage"
                    ),
                result
              );
              await authorityRefresh;
              return;
            }
            await onMutationCommittedRef.current?.(result, {
              ...(anchor === undefined || anchor === null
                ? {}
                : {
                    anchorOffset: anchor.offset,
                    sourceItemId: anchor.id,
                  }),
              entryKey: resolved.entry.entryKey,
              minimumIndexGeneration: Math.max(
                lease.minimumIndexGeneration,
                result.stateSequence ?? 0
              ),
              path: resolved.entry.path,
              targetSurface: action === "stage" ? "staged" : "index",
            });
          } catch (error) {
            const authorityRefresh =
              onMutationCommittedRef.current?.(null) ?? Promise.resolve();
            await showReviewMutationFailure(
              context,
              stageState === "staged"
                ? pluginText(
                    context,
                    "reviewTreeUnstageFailed",
                    "Unable to Unstage"
                  )
                : pluginText(
                    context,
                    "reviewTreeStageFailed",
                    "Unable to Stage"
                  ),
              error
            );
            await authorityRefresh;
          }
        }
      ).catch((error) => {
        console.error("Failed to report Git review mutation.", error);
      });
    },
    [context, gitRootPath, contextId]
  );

  // Capability owns callback presence. The authority barrier is a transient
  // busy state: keep controls mounted and disable them through displayItems.
  const canMutate = Boolean(entries && gitRootPath);

  /** Stable changeKey → main-side semantic mutation; renderer never rebuilds a patch. */
  const onHunkAction = useCallback(
    (event: PierHunkActionEvent) => {
      if (
        mutationBlockedRef.current ||
        !(entriesRef.current && gitRootPath) ||
        pendingFileActionsRef.current.has(event.itemId) ||
        pendingChangeActionsRef.current.has(event.changeKey)
      ) {
        return;
      }
      const item = itemsRef.current.find(
        (candidate) => candidate.id === event.itemId
      );
      const changeControl = item?.changeControls?.find(
        (candidate) => candidate.changeKey === event.changeKey
      );
      const resolved = resolveReviewMutationSection(
        entriesRef.current,
        itemsRef.current,
        event.itemId
      );
      const expectedRevision = revisionBySectionIdRef.current.get(event.itemId);
      const source =
        resolved === null
          ? null
          : reviewMutationSource(contextId, gitRootPath, resolved.entry);
      if (!(item && changeControl && resolved && expectedRevision && source)) {
        notifyError(
          context,
          pluginText(
            context,
            "reviewHunkNotReady",
            "This change is still loading. Try again in a moment."
          )
        );
        return;
      }
      const failedTitle = (action: typeof event.action): string => {
        if (action === "revert") {
          return pluginText(
            context,
            "reviewRevertHunkFailed",
            "Unable to revert hunk"
          );
        }
        if (action === "unstage") {
          return pluginText(
            context,
            "reviewUnstageHunkFailed",
            "Unable to unstage hunk"
          );
        }
        return pluginText(
          context,
          "reviewStageHunkFailed",
          "Unable to stage hunk"
        );
      };

      const run = async () => {
        if (event.action === "revert") {
          const confirmed = await context.dialogs.confirm({
            body: pluginText(
              context,
              "reviewRevertHunkBody",
              "Discard this hunk in the working tree? This cannot be undone."
            ),
            confirmLabel: pluginText(
              context,
              "reviewRevertHunkConfirm",
              "Revert"
            ),
            intent: "destructive",
            title: pluginText(
              context,
              "reviewRevertHunkTitle",
              "Revert this hunk?"
            ),
          });
          if (!confirmed) {
            return;
          }
        }
        const lease = onMutationStartRef.current();
        if (lease === null) {
          return;
        }
        const anchor = captureReadingAnchorRef.current?.(event.itemId);

        await withReviewMutationPending(
          setPendingChangeActions,
          pendingChangeActionsRef,
          event.changeKey,
          event.action,
          async () => {
            try {
              const result = await context.git.applyReviewMutation({
                action: event.action,
                expectedRevision,
                operationId: crypto.randomUUID(),
                source,
                target: {
                  changeKey: changeControl.changeKey,
                  kind: "change",
                  sectionKey: changeControl.targetSectionKey ?? event.itemId,
                },
              });
              if (result.kind !== "ok") {
                const authorityRefresh =
                  onMutationCommittedRef.current?.(null) ?? Promise.resolve();
                await showReviewMutationFailure(
                  context,
                  failedTitle(event.action),
                  result
                );
                await authorityRefresh;
                return;
              }
              await onMutationCommittedRef.current?.(
                result,
                event.action === "revert"
                  ? undefined
                  : {
                      ...(anchor === undefined || anchor === null
                        ? {}
                        : {
                            anchorOffset: anchor.offset,
                            sourceItemId: anchor.id,
                          }),
                      entryKey: resolved.entry.entryKey,
                      minimumIndexGeneration: Math.max(
                        lease.minimumIndexGeneration,
                        result.stateSequence ?? 0
                      ),
                      path: resolved.entry.path,
                      targetSurface:
                        event.action === "stage" ? "staged" : "index",
                    }
              );
            } catch (error) {
              const authorityRefresh =
                onMutationCommittedRef.current?.(null) ?? Promise.resolve();
              await showReviewMutationFailure(
                context,
                failedTitle(event.action),
                error
              );
              await authorityRefresh;
            }
          }
        );
      };

      run().catch((error) => {
        console.error("Failed to report Git review mutation.", error);
      });
    },
    [context, gitRootPath, contextId]
  );

  const onDiscardFile = useCallback(
    (itemId: string) => {
      if (
        mutationBlockedRef.current ||
        !(entriesRef.current && gitRootPath) ||
        pendingFileActionsRef.current.has(itemId)
      ) {
        return;
      }
      const item = itemsRef.current.find(
        (candidate) => candidate.id === itemId
      );
      if (
        item?.stageControl?.state !== "unstaged" ||
        item.stageControl.canDiscard !== true
      ) {
        return;
      }
      const targetSectionKey = item.stageControl.targetSectionKey ?? itemId;
      const resolved = resolveReviewMutationSection(
        entriesRef.current,
        itemsRef.current,
        targetSectionKey
      );
      const expectedRevision = revisionBySectionIdRef.current.get(itemId);
      if (!(resolved && expectedRevision)) {
        return;
      }
      const source = reviewMutationSource(
        contextId,
        gitRootPath,
        resolved.entry
      );
      if (source === null) {
        return;
      }
      const selection = partitionDiscardPaths({
        paths: [resolved.entry.path],
        uniformStatus: resolved.slot?.status ?? resolved.entry.status,
      });
      // Confirm first (no busy chrome); busy only during the write.
      (async () => {
        const decision = await confirmGitDiscard(context, selection);
        if (decision.kind !== "proceed" || decision.paths.length === 0) {
          return;
        }
        if (onMutationStartRef.current() === null) {
          return;
        }
        await withReviewMutationPending(
          setPendingFileActions,
          pendingFileActionsRef,
          itemId,
          "discard",
          async () => {
            try {
              const result = await context.git.applyReviewMutation({
                action: "revert",
                expectedRevision,
                operationId: crypto.randomUUID(),
                source,
                target: {
                  kind: "file",
                  sectionKey: targetSectionKey,
                },
              });
              if (result.kind !== "ok") {
                const authorityRefresh =
                  onMutationCommittedRef.current?.(null) ?? Promise.resolve();
                await showReviewMutationFailure(
                  context,
                  pluginText(
                    context,
                    "reviewDiscardFailed",
                    "Unable to discard changes"
                  ),
                  result
                );
                await authorityRefresh;
                return;
              }
              await onMutationCommittedRef.current?.(result);
            } catch (error) {
              const authorityRefresh =
                onMutationCommittedRef.current?.(null) ?? Promise.resolve();
              await showReviewMutationFailure(
                context,
                pluginText(
                  context,
                  "reviewDiscardFailed",
                  "Unable to discard changes"
                ),
                error
              );
              await authorityRefresh;
            }
          }
        );
      })().catch((error) => {
        console.error("Failed to report Git review mutation.", error);
      });
    },
    [context, gitRootPath, contextId]
  );

  const onOpenFile = useGitReviewOpenFile({
    context,
    contextId,
    ...(gitRootPath === undefined ? {} : { gitRootPath }),
    itemsRef,
  });

  return {
    canMutate,
    displayItems,
    onDiscardFile,
    onHunkAction,
    onOpenFile,
    onToggleStage,
  };
}

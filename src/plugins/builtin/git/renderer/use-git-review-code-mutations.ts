import type {
  PierDiffViewItem,
  PierHunkActionEvent,
} from "@pier/ui/diff-view.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { GitReviewIndexEntry } from "@shared/contracts/git-review.ts";
import { useCallback, useMemo, useState } from "react";
import { notifyError } from "./git-command-helpers.ts";
import { pluginText } from "./git-plugin-text.ts";
import {
  confirmGitDiscard,
  partitionDiscardPaths,
} from "./git-review-discard.ts";
import { applyHunkGitAction } from "./git-review-hunk-actions.ts";

function basename(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments.at(-1) ?? path;
}

export function useGitReviewCodeMutations(options: {
  readonly context: RendererPluginContext;
  readonly contextId: string;
  readonly entries?: readonly GitReviewIndexEntry[];
  readonly gitRootPath?: string;
  readonly items: readonly PierDiffViewItem[];
}): {
  readonly canMutate: boolean;
  readonly displayItems: readonly PierDiffViewItem[];
  readonly onDiscardFile: (itemId: string) => void;
  readonly onHunkAction: (event: PierHunkActionEvent) => void;
  readonly onOpenFile: (itemId: string) => void;
  readonly onToggleStage: (itemId: string) => void;
} {
  const { context, contextId, entries, gitRootPath, items } = options;
  const [busySectionKeys, setBusySectionKeys] = useState(
    () => new Set<string>()
  );

  const displayItems = useMemo(() => {
    if (busySectionKeys.size === 0) {
      return items;
    }
    return items.map((item) => {
      if (!(item.stageControl && busySectionKeys.has(item.id))) {
        return item;
      }
      return {
        ...item,
        stageControl: { ...item.stageControl, busy: true },
      };
    });
  }, [busySectionKeys, items]);

  const resolveSlot = useCallback(
    (itemId: string) => {
      if (!entries) {
        return null;
      }
      for (const entry of entries) {
        const slot = entry.renderSlots.find(
          (candidate) => candidate.sectionKey === itemId
        );
        if (slot) {
          return { entry, slot };
        }
      }
      return null;
    },
    [entries]
  );

  const withBusy = useCallback((itemId: string, run: Promise<unknown>) => {
    // 正文高度变化交给 Pierre 行级 scroll anchoring；勿钉 raw scrollTop。
    setBusySectionKeys((prev) => {
      const next = new Set(prev);
      next.add(itemId);
      return next;
    });
    return run.finally(() => {
      setBusySectionKeys((prev) => {
        if (!prev.has(itemId)) {
          return prev;
        }
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
    });
  }, []);

  const onToggleStage = useCallback(
    (itemId: string) => {
      if (!(entries && gitRootPath) || busySectionKeys.has(itemId)) {
        return;
      }
      const item = items.find((candidate) => candidate.id === itemId);
      const stageState = item?.stageControl?.state;
      if (!stageState) {
        return;
      }
      const resolved = resolveSlot(itemId);
      if (!resolved) {
        return;
      }
      const { entry, slot } = resolved;
      const paths = [
        slot.targetPath,
        ...entry.oldPaths.filter((path) => path !== slot.targetPath),
      ];
      withBusy(
        itemId,
        (async () => {
          try {
            const ok =
              stageState === "staged"
                ? await context.git.unstage(gitRootPath, paths)
                : await context.git.stage(gitRootPath, paths);
            // 成功路径静默：watch/index 以 delta 对齐；不 toast、不抬 failure 面。
            if (!ok) {
              notifyError(
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
                    )
              );
            }
          } catch (error) {
            // 仅 write 真失败时一次稳定错误（终态：禁止中间态闪错）。
            notifyError(
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
          }
        })()
      ).catch(() => undefined);
    },
    [
      busySectionKeys,
      context,
      entries,
      gitRootPath,
      items,
      resolveSlot,
      withBusy,
    ]
  );

  const canMutate = Boolean(entries && gitRootPath);

  /**
   * Codex review path: per-hunk toolbar → extract hunk patch → git.applyPatch.
   */
  const onHunkAction = useCallback(
    (event: PierHunkActionEvent) => {
      if (!(canMutate && gitRootPath) || busySectionKeys.has(event.itemId)) {
        return;
      }
      const item = items.find((candidate) => candidate.id === event.itemId);
      const stageState = item?.stageControl?.state;
      const patch = item?.patch;
      if (!(item && stageState && patch && patch.length > 0)) {
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

      const resultTitle = (
        action: typeof event.action,
        errorCode: string | undefined
      ): string => {
        if (errorCode === "extract-failed") {
          return pluginText(
            context,
            "reviewHunkPatchBuildFailed",
            "Unable to build patch for this change"
          );
        }
        if (errorCode === "partial-revert-worktree") {
          return pluginText(
            context,
            "reviewRevertHunkPartialFailed",
            "Unstaged from the index, but could not discard from the working tree"
          );
        }
        return failedTitle(action);
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

        await withBusy(
          event.itemId,
          (async () => {
            try {
              const result = await applyHunkGitAction({
                action: event.action,
                applyPatch: context.git.applyPatch.bind(context.git),
                changeBlockIndex: event.changeBlockIndex,
                cwd: gitRootPath,
                filePatch: patch,
                hunkIndex: event.hunkIndex,
                variant: stageState,
              });
              if (!result.ok) {
                const title = resultTitle(event.action, result.errorCode);
                if (result.message) {
                  await context.dialogs.alert({
                    body: result.message,
                    title,
                  });
                } else {
                  notifyError(context, title);
                }
              }
            } catch (error) {
              notifyError(context, failedTitle(event.action), error);
            }
          })()
        );
      };

      run().catch(() => undefined);
    },
    [busySectionKeys, canMutate, context, gitRootPath, items, withBusy]
  );

  const onDiscardFile = useCallback(
    (itemId: string) => {
      if (!(entries && gitRootPath) || busySectionKeys.has(itemId)) {
        return;
      }
      const item = items.find((candidate) => candidate.id === itemId);
      if (
        item?.stageControl?.state !== "unstaged" ||
        item.stageControl.canDiscard !== true
      ) {
        return;
      }
      const resolved = resolveSlot(itemId);
      if (!resolved) {
        return;
      }
      const path = resolved.slot.targetPath;
      const selection = partitionDiscardPaths({
        paths: [path],
        uniformStatus: resolved.slot.status,
      });
      // Confirm first (no busy chrome); busy only during the write.
      (async () => {
        const decision = await confirmGitDiscard(context, selection);
        if (decision.kind !== "proceed" || decision.paths.length === 0) {
          return;
        }
        await withBusy(
          itemId,
          (async () => {
            try {
              const ok = await context.git.discardChanges(gitRootPath, [
                ...decision.paths,
              ]);
              if (!ok) {
                notifyError(
                  context,
                  pluginText(
                    context,
                    "reviewDiscardFailed",
                    "Unable to discard changes"
                  )
                );
              }
            } catch (error) {
              notifyError(
                context,
                pluginText(
                  context,
                  "reviewDiscardFailed",
                  "Unable to discard changes"
                ),
                error
              );
            }
          })()
        );
      })().catch(() => undefined);
    },
    [
      busySectionKeys,
      context,
      entries,
      gitRootPath,
      items,
      resolveSlot,
      withBusy,
    ]
  );

  const onOpenFile = useCallback(
    (itemId: string) => {
      if (!gitRootPath) {
        return;
      }
      const item = items.find((entry) => entry.id === itemId);
      const path = item?.fileDisplay?.path;
      if (!path) {
        return;
      }
      const opened = context.files.openInEditor({
        context: {
          contextId,
          gitRoot: gitRootPath,
          projectRootPath: gitRootPath,
          source: "panel",
          updatedAt: Date.now(),
        },
        path,
        root: gitRootPath,
        title: basename(path),
      });
      if (!opened) {
        context.notifications.error(
          pluginText(context, "reviewTreeOpenFileFailed", "Unable to open file")
        );
      }
    },
    [context, contextId, gitRootPath, items]
  );

  return {
    canMutate,
    displayItems,
    onDiscardFile,
    onHunkAction,
    onOpenFile,
    onToggleStage,
  };
}

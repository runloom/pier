/**
 * Discard working-tree changes — VS Code Source Control `clean` dialogs.
 *
 * - Tracked modified/deleted → `git restore` (via `git.discardChanges`)
 * - Untracked (added) → OS Trash when possible (main falls back to `git clean`)
 * - Single file: confirm / cancel only
 * - Multi tracked-only or untracked-only: confirm / cancel
 * - Mixed multi: choice — tracked only | all | cancel
 */
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { GitReviewFileStatus } from "@shared/contracts/git-review.ts";
import { notifyError } from "./git-command-helpers.ts";
import { pluginText } from "./git-plugin-text.ts";

export interface GitDiscardSelection {
  /** Every tracked path is a deleted working-tree file (restore, not discard edits). */
  readonly allTrackedDeleted?: boolean;
  readonly trackedPaths: readonly string[];
  readonly untrackedPaths: readonly string[];
}

export type GitDiscardConfirmResult =
  | { readonly kind: "cancel" }
  | {
      readonly kind: "proceed";
      readonly paths: readonly string[];
    };

function basename(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments.at(-1) ?? path;
}

/** Unstaged `added` is untracked; modified/deleted are tracked working-tree. */
export function isUntrackedDiscardStatus(
  status: GitReviewFileStatus | null | undefined
): boolean {
  return status === "added";
}

export function isTrackedDiscardStatus(
  status: GitReviewFileStatus | null | undefined
): boolean {
  return status === "modified" || status === "deleted";
}

export function canDiscardUnstagedStatus(
  status: GitReviewFileStatus | null | undefined
): boolean {
  return isTrackedDiscardStatus(status) || isUntrackedDiscardStatus(status);
}

export function partitionDiscardPaths(options: {
  readonly paths: readonly string[];
  readonly statuses?: ReadonlyMap<string, GitReviewFileStatus>;
  /** When every path shares one status (single-file or homogeneous list). */
  readonly uniformStatus?: GitReviewFileStatus | null;
}): GitDiscardSelection {
  const trackedPaths: string[] = [];
  const untrackedPaths: string[] = [];
  let trackedDeletedCount = 0;
  for (const path of options.paths) {
    const status = options.statuses?.get(path) ?? options.uniformStatus ?? null;
    if (isUntrackedDiscardStatus(status)) {
      untrackedPaths.push(path);
    } else if (isTrackedDiscardStatus(status)) {
      trackedPaths.push(path);
      if (status === "deleted") {
        trackedDeletedCount += 1;
      }
    }
  }
  return {
    allTrackedDeleted:
      trackedPaths.length > 0 && trackedDeletedCount === trackedPaths.length,
    trackedPaths,
    untrackedPaths,
  };
}

/**
 * Confirm discard. Returns paths the user accepted (tracked-only or all).
 * Always prompts — including single-file — per product requirement.
 */
export async function confirmGitDiscard(
  context: RendererPluginContext,
  selection: GitDiscardSelection
): Promise<GitDiscardConfirmResult> {
  const tracked = selection.trackedPaths;
  const untracked = selection.untrackedPaths;
  const trackedCount = tracked.length;
  const untrackedCount = untracked.length;

  if (trackedCount + untrackedCount === 0) {
    return { kind: "cancel" };
  }

  // —— Untracked only ——
  if (trackedCount === 0) {
    if (untrackedCount === 1) {
      const name = basename(untracked[0] ?? "");
      const confirmed = await context.dialogs.confirm({
        body: pluginText(
          context,
          "reviewDiscardConfirmUntrackedSingle",
          "Delete new file {{name}}? You can restore it from the Trash.",
          { name }
        ),
        confirmLabel: pluginText(
          context,
          "reviewDiscardMoveToTrash",
          "Move to Trash"
        ),
        intent: "destructive",
        size: "sm",
        title: pluginText(context, "reviewDiscardTitleTrash", "Move to Trash"),
      });
      return confirmed
        ? { kind: "proceed", paths: untracked }
        : { kind: "cancel" };
    }
    const confirmed = await context.dialogs.confirm({
      body: pluginText(
        context,
        "reviewDiscardConfirmUntrackedMulti",
        "Delete {{count}} new files? You can restore them from the Trash.",
        { count: untrackedCount }
      ),
      confirmLabel: pluginText(
        context,
        "reviewDiscardMoveToTrashMulti",
        "Move All to Trash"
      ),
      intent: "destructive",
      size: "sm",
      title: pluginText(context, "reviewDiscardTitleTrash", "Move to Trash"),
    });
    return confirmed
      ? { kind: "proceed", paths: untracked }
      : { kind: "cancel" };
  }

  // —— Tracked only ——
  if (untrackedCount === 0) {
    const restoreDeleted = selection.allTrackedDeleted === true;
    if (trackedCount === 1) {
      const name = basename(tracked[0] ?? "");
      const confirmed = await context.dialogs.confirm({
        body: restoreDeleted
          ? pluginText(
              context,
              "reviewDiscardConfirmRestoreSingle",
              "Restore deleted file {{name}}?",
              { name }
            )
          : pluginText(
              context,
              "reviewDiscardConfirmTrackedSingle",
              "Discard local changes in {{name}}? This cannot be undone.",
              { name }
            ),
        confirmLabel: restoreDeleted
          ? pluginText(context, "reviewDiscardRestoreFileButton", "Restore")
          : pluginText(context, "reviewDiscardConfirmButtonSingle", "Discard"),
        intent: "destructive",
        size: "sm",
        title: restoreDeleted
          ? pluginText(context, "reviewDiscardTitleRestore", "Restore File")
          : pluginText(context, "reviewDiscardTitle", "Discard Changes"),
      });
      return confirmed
        ? { kind: "proceed", paths: tracked }
        : { kind: "cancel" };
    }
    const confirmed = await context.dialogs.confirm({
      body: restoreDeleted
        ? pluginText(
            context,
            "reviewDiscardConfirmRestoreMulti",
            "Restore {{count}} deleted files?",
            { count: trackedCount }
          )
        : pluginText(
            context,
            "reviewDiscardConfirmTrackedMulti",
            "Discard local changes in {{count}} files? This cannot be undone.",
            { count: trackedCount }
          ),
      confirmLabel: restoreDeleted
        ? pluginText(context, "reviewDiscardRestoreMultiButton", "Restore All")
        : pluginText(context, "reviewDiscardConfirmButtonMulti", "Discard All"),
      intent: "destructive",
      size: "sm",
      title: restoreDeleted
        ? pluginText(context, "reviewDiscardTitleRestore", "Restore File")
        : pluginText(context, "reviewDiscardTitle", "Discard Changes"),
    });
    return confirmed ? { kind: "proceed", paths: tracked } : { kind: "cancel" };
  }

  // —— Mixed tracked + untracked (VS Code _cleanAll) ——
  // buttonOrder confirm-alt-cancel：主=放弃已跟踪 | 次=全部放弃 | 取消
  // confirm → tracked only；alt → all（含未跟踪删除）
  const body = pluginText(
    context,
    "reviewDiscardMixedBody",
    "This will delete {{untracked}} new file(s) (recoverable from Trash) and discard changes in {{tracked}} existing file(s). This cannot be undone.",
    { tracked: trackedCount, untracked: untrackedCount }
  );

  const choice = await context.dialogs.choice({
    altLabel: pluginText(
      context,
      "reviewDiscardAllFilesButton",
      "Discard All {{count}}",
      { count: trackedCount + untrackedCount }
    ),
    body,
    buttonOrder: "confirm-alt-cancel",
    confirmLabel: pluginText(
      context,
      "reviewDiscardTrackedOnlyButton",
      "Discard {{count}} Changes",
      { count: trackedCount }
    ),
    intent: "destructive",
    size: "default",
    title: pluginText(context, "reviewDiscardTitle", "Discard Changes"),
  });

  if (choice === "confirm") {
    return { kind: "proceed", paths: tracked };
  }
  if (choice === "alt") {
    return { kind: "proceed", paths: [...tracked, ...untracked] };
  }
  return { kind: "cancel" };
}

/** Confirm + execute discard. Returns whether the operation ran successfully. */
export async function confirmAndDiscardGitChanges(
  context: RendererPluginContext,
  gitRootPath: string,
  selection: GitDiscardSelection
): Promise<"cancelled" | "failed" | "ok"> {
  const decision = await confirmGitDiscard(context, selection);
  if (decision.kind === "cancel") {
    return "cancelled";
  }
  if (decision.paths.length === 0) {
    return "cancelled";
  }
  try {
    const ok = await context.git.discardChanges(gitRootPath, [
      ...decision.paths,
    ]);
    if (!ok) {
      notifyError(
        context,
        pluginText(context, "reviewDiscardFailed", "Unable to discard changes")
      );
      return "failed";
    }
    return "ok";
  } catch (error) {
    notifyError(
      context,
      pluginText(context, "reviewDiscardFailed", "Unable to discard changes"),
      error
    );
    return "failed";
  }
}

import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type {
  GitMergeAbortResult,
  GitRebaseAbortResult,
  GitRebaseContinueResult,
  GitUndoCommitResult,
} from "@shared/contracts/git.ts";
import { GitBranch, GitMerge, Undo2 } from "lucide-react";
import {
  activeCwdOrMessage,
  commandTitle,
  confirmDialog,
  confirmOpenReview,
  disabledReasonForActiveGit,
  enabledForActiveGit,
  showError,
  showLoading,
  showUnavailable,
} from "./git-command-helpers.ts";
import { pluginText } from "./git-plugin-text.ts";

export function registerMergeAbortAction(
  context: RendererPluginContext
): () => void {
  return context.actions.register({
    category: "Git",
    disabledReason: () => disabledReasonForActiveGit(context),
    enabled: () => enabledForActiveGit(context),
    handler: async () => {
      const title = commandTitle(
        context,
        "pier.git.mergeAbort",
        "Git: Abort Merge"
      );
      const cwd = activeCwdOrMessage(context, title);
      if (!cwd) {
        return;
      }
      const loading = showLoading(
        context,
        pluginText(context, "gitLoadingMergeAbort", "Aborting merge...")
      );
      let result: GitMergeAbortResult;
      try {
        result = await context.git.abortMerge(cwd);
      } catch (err) {
        loading.dismiss();
        await showError(context, title, err);
        return;
      }
      if (result.kind === "ok") {
        loading.success(
          pluginText(context, "gitMergeAbortSuccess", "Merge aborted")
        );
      } else {
        loading.dismiss();
        await showUnavailable(context, title, result.message?.trim());
      }
    },
    id: "pier.git.mergeAbort",
    metadata: {
      categoryKey: "git",
      group: "2_git",
      iconComponent: GitMerge,
      sortOrder: 11,
    },
    surfaces: ["command-palette"],
    title: () =>
      commandTitle(context, "pier.git.mergeAbort", "Git: Abort Merge"),
  });
}

export function registerRebaseAbortAction(
  context: RendererPluginContext
): () => void {
  return context.actions.register({
    category: "Git",
    disabledReason: () => disabledReasonForActiveGit(context),
    enabled: () => enabledForActiveGit(context),
    handler: async () => {
      const title = commandTitle(
        context,
        "pier.git.rebaseAbort",
        "Git: Abort Rebase"
      );
      const cwd = activeCwdOrMessage(context, title);
      if (!cwd) {
        return;
      }
      const loading = showLoading(
        context,
        pluginText(context, "gitLoadingRebaseAbort", "Aborting rebase...")
      );
      let result: GitRebaseAbortResult;
      try {
        result = await context.git.abortRebase(cwd);
      } catch (err) {
        loading.dismiss();
        await showError(context, title, err);
        return;
      }
      if (result.kind === "ok") {
        loading.success(
          pluginText(context, "gitRebaseAbortSuccess", "Rebase aborted")
        );
      } else {
        loading.dismiss();
        await showUnavailable(context, title, result.message?.trim());
      }
    },
    id: "pier.git.rebaseAbort",
    metadata: {
      categoryKey: "git",
      group: "2_git",
      iconComponent: GitBranch,
      sortOrder: 18,
    },
    surfaces: ["command-palette"],
    title: () =>
      commandTitle(context, "pier.git.rebaseAbort", "Git: Abort Rebase"),
  });
}

export function registerRebaseContinueAction(
  context: RendererPluginContext
): () => void {
  return context.actions.register({
    category: "Git",
    disabledReason: () => disabledReasonForActiveGit(context),
    enabled: () => enabledForActiveGit(context),
    handler: async () => {
      const title = commandTitle(
        context,
        "pier.git.rebaseContinue",
        "Git: Continue Rebase"
      );
      const cwd = activeCwdOrMessage(context, title);
      if (!cwd) {
        return;
      }
      const loading = showLoading(
        context,
        pluginText(context, "gitLoadingRebaseContinue", "Continuing rebase...")
      );
      let result: GitRebaseContinueResult;
      try {
        result = await context.git.continueRebase(cwd);
      } catch (err) {
        loading.dismiss();
        await showError(context, title, err);
        return;
      }
      if (result.kind === "ok") {
        loading.success(
          pluginText(context, "gitRebaseContinueSuccess", "Rebase continued")
        );
      } else if (result.kind === "conflict") {
        loading.dismiss();
        await confirmOpenReview(
          context,
          pluginText(context, "gitRebaseConflictTitle", "Rebase Conflicts"),
          pluginText(
            context,
            "gitRebaseContinueConflict",
            "Rebase still has conflicts. Resolve them, then continue."
          ),
          result.message
        );
      } else {
        loading.dismiss();
        await showUnavailable(context, title, result.message?.trim());
      }
    },
    id: "pier.git.rebaseContinue",
    metadata: {
      categoryKey: "git",
      group: "2_git",
      iconComponent: GitBranch,
      sortOrder: 19,
    },
    surfaces: ["command-palette"],
    title: () =>
      commandTitle(context, "pier.git.rebaseContinue", "Git: Continue Rebase"),
  });
}

export function registerUndoCommitAction(
  context: RendererPluginContext
): () => void {
  return context.actions.register({
    category: "Git",
    disabledReason: () => disabledReasonForActiveGit(context),
    enabled: () => enabledForActiveGit(context),
    handler: async () => {
      const title = commandTitle(
        context,
        "pier.git.undoLastCommit",
        "Git: Undo Last Commit"
      );
      const cwd = activeCwdOrMessage(context, title);
      if (!cwd) {
        return;
      }
      const confirmed = await confirmDialog(
        context,
        title,
        pluginText(
          context,
          "gitUndoCommitConfirm",
          "Undo the last commit? Changes will be preserved as staged."
        ),
        pluginText(context, "gitUndoCommitConfirmButton", "Undo")
      );
      if (!confirmed) {
        return;
      }
      const loading = showLoading(
        context,
        pluginText(context, "gitLoadingUndoCommit", "Undoing commit...")
      );
      let result: GitUndoCommitResult;
      try {
        result = await context.git.undoLastCommit(cwd);
      } catch (err) {
        loading.dismiss();
        await showError(context, title, err);
        return;
      }
      if (result.kind === "ok") {
        loading.success(
          pluginText(
            context,
            "gitUndoCommitSuccess",
            "Last commit undone (changes preserved as staged)"
          )
        );
      } else if (result.kind === "nothing_to_undo") {
        loading.info(
          pluginText(context, "gitUndoCommitNothing", "No commits to undo")
        );
      } else {
        loading.dismiss();
        await showUnavailable(context, title, result.message?.trim());
      }
    },
    id: "pier.git.undoLastCommit",
    metadata: {
      categoryKey: "git",
      group: "2_git",
      iconComponent: Undo2,
      sortOrder: 20,
    },
    surfaces: ["command-palette"],
    title: () =>
      commandTitle(context, "pier.git.undoLastCommit", "Git: Undo Last Commit"),
  });
}

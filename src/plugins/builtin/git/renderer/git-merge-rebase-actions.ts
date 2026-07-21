import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type {
  GitMergeAbortResult,
  GitRebaseAbortResult,
  GitRebaseContinueResult,
} from "@shared/contracts/git.ts";
import { GitBranch, GitMerge } from "lucide-react";
import {
  activeCwdOrMessage,
  commandTitle,
  disabledReasonForActiveGit,
  enabledForActiveGit,
  showConflictDetails,
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
        await showConflictDetails(
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

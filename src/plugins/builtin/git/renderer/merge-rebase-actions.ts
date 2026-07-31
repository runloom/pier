import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { GitBranch, GitMerge } from "lucide-react";
import {
  activeCwdOrMessage,
  commandTitle,
  disabledReasonForActiveGit,
  enabledForActiveGit,
} from "./command-helpers.ts";
import {
  runAbortPausedOperation,
  runContinuePausedOperation,
} from "./operation-runners.ts";

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
      await runAbortPausedOperation(context, {
        cwd,
        kind: "merging",
        title,
      });
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
      await runAbortPausedOperation(context, {
        cwd,
        kind: "rebasing",
        title,
      });
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
      await runContinuePausedOperation(context, {
        cwd,
        kind: "rebasing",
        title,
      });
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

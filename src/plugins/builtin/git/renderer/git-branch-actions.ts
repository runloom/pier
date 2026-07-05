import type {
  RendererPluginContext,
  RendererPluginQuickPickItem,
} from "@plugins/api/renderer.ts";
import type {
  GitDiffBranchesResult,
  GitDiffBranchOption,
  GitMergeResult,
  GitRebaseResult,
} from "@shared/contracts/git.ts";
import { GitBranch, GitMerge } from "lucide-react";
import { createElement } from "react";
import { GitBranchQuickPickRow } from "./git-branch-quick-pick-row.tsx";
import {
  activeCwdOrMessage,
  commandTitle,
  confirmOpenReview,
  disabledReasonForActiveGit,
  enabledForActiveGit,
  showError,
  showInfo,
  showLoading,
  showUnavailable,
} from "./git-command-helpers.ts";
import { pluginText } from "./git-plugin-text.ts";

type BranchOperation = "merge" | "rebase";

interface BranchItem extends RendererPluginQuickPickItem {
  data: GitDiffBranchOption;
}

function branchItem(branch: GitDiffBranchOption): BranchItem {
  return {
    data: branch,
    id: branch.id,
    label: branch.name,
    searchTerms: [branch.name, branch.refName],
  };
}

async function openBranchPick(
  context: RendererPluginContext,
  operation: BranchOperation,
  title: string
): Promise<void> {
  const cwd = activeCwdOrMessage(context, title);
  if (!cwd) {
    return;
  }

  // 拉全量候选(上限为 IPC 安全阀):quick pick 靠本地过滤,截断会让
  // 排序靠后的分支永远无法被选中。
  const loading = showLoading(
    context,
    pluginText(context, "gitLoadingBranches", "Loading branches...")
  );
  let result: GitDiffBranchesResult;
  try {
    result = await context.git.searchBranches(cwd, { limit: 1000, query: "" });
  } catch (err) {
    loading.dismiss();
    await showError(context, title, err);
    return;
  }
  loading.dismiss();
  if (result.status !== "ok") {
    await showUnavailable(context, title, result.message?.trim());
    return;
  }
  const items = result.items
    .filter((branch) => !branch.current && branch.name !== result.currentBranch)
    .map(branchItem);
  if (items.length === 0) {
    showInfo(
      context,
      title,
      pluginText(context, "gitNoOtherBranches", "No other branches found")
    );
    return;
  }

  const branchesById = new Map(items.map((item) => [item.id, item]));
  const defaultLabel = pluginText(context, "branchDefault", "default");
  const remoteLabel = pluginText(context, "branchRemote", "remote");
  context.commandPalette.openQuickPick({
    items,
    onAccept: async (selected) => {
      const item = branchesById.get(selected.id);
      if (!item) {
        return;
      }
      await runBranchOperation(context, operation, title, cwd, item.data.name);
    },
    placeholder:
      operation === "rebase"
        ? pluginText(
            context,
            "gitRebaseSelectBranch",
            "Select a branch to rebase onto"
          )
        : pluginText(
            context,
            "gitMergeSelectBranch",
            "Select a branch to merge into the current branch"
          ),
    renderItem: (item) =>
      createElement(GitBranchQuickPickRow, {
        branch: item.data as GitDiffBranchOption,
        defaultLabel,
        remoteLabel,
      }),
    title,
  });
}

async function runBranchOperation(
  context: RendererPluginContext,
  operation: BranchOperation,
  title: string,
  cwd: string,
  branch: string
): Promise<void> {
  try {
    if (operation === "rebase") {
      await runRebase(context, title, cwd, branch);
      return;
    }
    await runMerge(context, title, cwd, branch);
  } catch (err) {
    await showError(context, title, err);
  }
}

async function runMerge(
  context: RendererPluginContext,
  title: string,
  cwd: string,
  branch: string
): Promise<void> {
  const loading = showLoading(
    context,
    pluginText(context, "gitLoadingMerge", "Merging...")
  );
  let result: GitMergeResult;
  try {
    result = await context.git.merge(cwd, branch);
  } catch (err) {
    loading.dismiss();
    await showError(context, title, err);
    return;
  }
  if (result.kind === "ok") {
    loading.success(
      pluginText(
        context,
        "gitMergeSuccess",
        "Successfully merged branch {{branch}}",
        {
          branch,
        }
      )
    );
  } else if (result.kind === "already_up_to_date") {
    loading.info(
      pluginText(
        context,
        "gitMergeAlreadyUpToDate",
        "Branch {{branch}} has no new commits to merge.",
        { branch }
      )
    );
  } else if (result.kind === "conflict") {
    loading.dismiss();
    await confirmOpenReview(
      context,
      pluginText(context, "gitMergeConflictTitle", "Merge Conflicts"),
      pluginText(
        context,
        "gitMergeConflictBody",
        "Merge resulted in {{count}} conflict(s) that need to be resolved.",
        { count: result.conflictCount }
      )
    );
  } else {
    loading.dismiss();
    await showUnavailable(context, title, result.message?.trim());
  }
}

async function runRebase(
  context: RendererPluginContext,
  title: string,
  cwd: string,
  branch: string
): Promise<void> {
  const loading = showLoading(
    context,
    pluginText(context, "gitLoadingRebase", "Rebasing...")
  );
  let result: GitRebaseResult;
  try {
    result = await context.git.rebase(cwd, branch);
  } catch (err) {
    loading.dismiss();
    await showError(context, title, err);
    return;
  }
  if (result.kind === "ok") {
    loading.success(
      pluginText(
        context,
        "gitRebaseSuccess",
        "Successfully rebased onto {{branch}}",
        {
          branch,
        }
      )
    );
  } else if (result.kind === "already_up_to_date") {
    loading.info(
      pluginText(
        context,
        "gitRebaseAlreadyUpToDate",
        "Current branch is already up to date with {{branch}}.",
        { branch }
      )
    );
  } else if (result.kind === "conflict") {
    loading.dismiss();
    await confirmOpenReview(
      context,
      pluginText(context, "gitRebaseConflictTitle", "Rebase Conflicts"),
      pluginText(
        context,
        "gitRebaseConflict",
        "Rebase paused due to conflicts. Resolve them, then continue."
      ),
      result.message
    );
  } else {
    loading.dismiss();
    await showUnavailable(context, title, result.message?.trim());
  }
}

export function registerMergeAction(
  context: RendererPluginContext
): () => void {
  return context.actions.register({
    category: "Git",
    disabledReason: () => disabledReasonForActiveGit(context),
    enabled: () => enabledForActiveGit(context),
    handler: async () =>
      openBranchPick(
        context,
        "merge",
        commandTitle(context, "pier.git.merge", "Git: Merge Branch...")
      ),
    id: "pier.git.merge",
    metadata: {
      categoryKey: "git",
      group: "2_git",
      iconComponent: GitMerge,
      sortOrder: 10,
    },
    surfaces: ["command-palette"],
    title: () =>
      commandTitle(context, "pier.git.merge", "Git: Merge Branch..."),
  });
}

export function registerRebaseAction(
  context: RendererPluginContext
): () => void {
  return context.actions.register({
    category: "Git",
    disabledReason: () => disabledReasonForActiveGit(context),
    enabled: () => enabledForActiveGit(context),
    handler: async () =>
      openBranchPick(
        context,
        "rebase",
        commandTitle(context, "pier.git.rebase", "Git: Rebase Branch...")
      ),
    id: "pier.git.rebase",
    metadata: {
      categoryKey: "git",
      group: "2_git",
      iconComponent: GitBranch,
      sortOrder: 17,
    },
    surfaces: ["command-palette"],
    title: () =>
      commandTitle(context, "pier.git.rebase", "Git: Rebase Branch..."),
  });
}

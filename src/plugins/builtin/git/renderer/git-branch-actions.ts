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
import {
  GitBranchQueryQuickPickRow,
  GitBranchQuickPickRow,
} from "./git-branch-quick-pick-row.tsx";
import {
  activeCwdOrMessage,
  commandTitle,
  disabledReasonForActiveGit,
  enabledForActiveGit,
  showConflictDetails,
  showError,
  showInfo,
  showLoading,
  showUnavailable,
} from "./git-command-helpers.ts";
import { pluginText } from "./git-plugin-text.ts";
import {
  collectLocalBranchNames,
  readSwitchBranchQueryItem,
  switchBranchQueryItem,
} from "./git-switch-branch-query.ts";

type BranchOperation = "merge" | "rebase" | "switch";

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

function canUseBranchForOperation(
  branch: GitDiffBranchOption,
  currentBranch: null | string,
  operation: BranchOperation
): boolean {
  if (branch.current || branch.name === currentBranch) {
    return false;
  }
  return operation === "switch" ? branch.kind === "local" : true;
}

function branchPickPlaceholder(
  context: RendererPluginContext,
  operation: BranchOperation
): string {
  if (operation === "rebase") {
    return pluginText(
      context,
      "gitRebaseSelectBranch",
      "Select a branch to rebase onto"
    );
  }
  if (operation === "switch") {
    return pluginText(
      context,
      "gitSwitchSelectBranch",
      "Enter a branch name to switch or create"
    );
  }
  return pluginText(
    context,
    "gitMergeSelectBranch",
    "Select a branch to merge into the current branch"
  );
}

async function openBranchPick(
  context: RendererPluginContext,
  operation: BranchOperation,
  title: string,
  cwdOverride?: string
): Promise<void> {
  const cwd = cwdOverride ?? activeCwdOrMessage(context, title);
  if (!cwd) {
    return;
  }

  const loading = showLoading(
    context,
    pluginText(context, "gitLoadingBranches", "Loading branches...")
  );
  let result: GitDiffBranchesResult;
  let allLocalBranchNames = new Set<string>();
  try {
    const [searchResult, localBranches] = await Promise.all([
      context.git.searchBranches(cwd, {
        ...(operation === "merge" && {
          diffMode: "mergeIntoCurrent" as const,
        }),
        limit: 1000,
        query: "",
      }),
      operation === "switch"
        ? context.git.listBranches(cwd, { kind: "local" })
        : Promise.resolve([]),
    ]);
    result = searchResult;
    allLocalBranchNames = new Set(localBranches.map((branch) => branch.name));
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
    .filter((branch) =>
      canUseBranchForOperation(branch, result.currentBranch, operation)
    )
    .map(branchItem);
  if (items.length === 0 && operation !== "switch") {
    showInfo(
      context,
      title,
      pluginText(context, "gitNoOtherBranches", "No other branches found")
    );
    return;
  }

  const branchesById = new Map(items.map((item) => [item.id, item]));
  const presentedLocalBranchNames = collectLocalBranchNames(
    result.items,
    result.currentBranch
  );
  const defaultLabel = pluginText(context, "branchDefault", "default");
  const graphCaveatTitle = pluginText(
    context,
    "branchGraphCaveatTitle",
    "Commit graph counts only. Squash or rebase merges may show already-applied commits as branch-only."
  );
  const graphLabel = pluginText(context, "branchGraph", "graph");
  const remoteLabel = pluginText(context, "branchRemote", "remote");
  context.commandPalette.openQuickPick({
    ...(operation === "switch"
      ? {
          getQueryItem: (query: string) =>
            switchBranchQueryItem(
              context,
              presentedLocalBranchNames,
              allLocalBranchNames,
              result.currentBranch,
              query
            ),
        }
      : {}),
    items,
    onAccept: async (selected) => {
      const queryItem = readSwitchBranchQueryItem(selected);
      if (operation === "switch" && queryItem?.kind === "create") {
        await runCreateAndSwitchBranch(context, title, cwd, queryItem.name);
        return;
      }
      if (operation === "switch" && queryItem?.kind === "existing") {
        await runSwitchBranch(context, title, cwd, queryItem.name);
        return;
      }
      const item = branchesById.get(selected.id);
      if (!item) {
        return;
      }
      await runBranchOperation(context, operation, title, cwd, item.data.name);
    },
    placeholder: branchPickPlaceholder(context, operation),
    renderItem: (item) => {
      const queryItem = readSwitchBranchQueryItem(item);
      if (queryItem) {
        return createElement(GitBranchQueryQuickPickRow, {
          ...(item.detail ? { detail: item.detail } : {}),
          kind: queryItem.kind,
          label: item.label,
        });
      }
      const branch = branchesById.get(item.id)?.data;
      if (!branch) {
        return null;
      }
      return createElement(GitBranchQuickPickRow, {
        branch,
        defaultLabel,
        graphCaveatTitle,
        graphLabel,
        remoteLabel,
      });
    },
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
    if (operation === "switch") {
      await runSwitchBranch(context, title, cwd, branch);
      return;
    }
    await runMerge(context, title, cwd, branch);
  } catch (err) {
    await showError(context, title, err);
  }
}

async function runSwitchBranch(
  context: RendererPluginContext,
  title: string,
  cwd: string,
  branch: string
): Promise<void> {
  const loading = showLoading(
    context,
    pluginText(context, "gitLoadingSwitchBranch", "Switching branch...")
  );
  try {
    await context.git.checkoutBranch(cwd, branch);
  } catch (err) {
    loading.dismiss();
    await showError(context, title, err);
    return;
  }
  loading.success(
    pluginText(context, "gitSwitchSuccess", "Switched to branch {{branch}}", {
      branch,
    })
  );
}

async function runCreateAndSwitchBranch(
  context: RendererPluginContext,
  title: string,
  cwd: string,
  branch: string
): Promise<void> {
  const loading = showLoading(
    context,
    pluginText(
      context,
      "gitLoadingCreateAndSwitchBranch",
      "Creating and switching branch..."
    )
  );
  try {
    await context.git.createAndSwitchBranch(cwd, branch);
  } catch (err) {
    loading.dismiss();
    await showError(context, title, err);
    return;
  }
  loading.success(
    pluginText(
      context,
      "gitCreateAndSwitchSuccess",
      "Created and switched to branch {{branch}}",
      { branch }
    )
  );
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
    await showConflictDetails(
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
    await showConflictDetails(
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

export function openSwitchBranchPick(
  context: RendererPluginContext,
  options: { cwd?: string } = {}
): Promise<void> {
  return openBranchPick(
    context,
    "switch",
    commandTitle(context, "pier.git.switchBranch", "Git: Switch Branch..."),
    options.cwd
  );
}

export function registerSwitchBranchAction(
  context: RendererPluginContext
): () => void {
  return context.actions.register({
    category: "Git",
    disabledReason: () => disabledReasonForActiveGit(context),
    enabled: () => enabledForActiveGit(context),
    handler: async () => openSwitchBranchPick(context),
    id: "pier.git.switchBranch",
    metadata: {
      categoryKey: "git",
      group: "2_git",
      iconComponent: GitBranch,
      sortOrder: 8,
    },
    surfaces: ["command-palette"],
    title: () =>
      commandTitle(context, "pier.git.switchBranch", "Git: Switch Branch..."),
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

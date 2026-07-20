import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { WorktreeItem } from "@shared/contracts/worktree.ts";
import { BrushCleaning, FolderGit2, GitBranch, Trash2 } from "lucide-react";
import { openWorktreeCreateOverlay } from "./worktree-create-overlay.tsx";
import {
  activeWorktreeTarget,
  basename,
  confirmQuickPick,
  errorMessage,
  itemLabel,
  openUnavailablePick,
  operationFailedReason,
  pluginText,
  showWorktreeMessage,
  unsupportedReason,
  WORKTREE_UNAVAILABLE_MESSAGES,
  worktreeSearchTerms,
} from "./worktree-operation-helpers.ts";

function registerWorktreeCreateAction(
  context: RendererPluginContext
): () => void {
  return context.actions.register({
    category: "Worktree",
    disabledReason: () => {
      const target = activeWorktreeTarget(context);
      return target.enabled ? null : target.reason;
    },
    enabled: () => activeWorktreeTarget(context).enabled,
    handler: async (invocation) => {
      const target = activeWorktreeTarget(context);
      if (!target.enabled) {
        openUnavailablePick(context, target.reason);
        return;
      }
      try {
        const listResult = await context.worktrees.list({ path: target.path });
        if (listResult.status !== "available") {
          const message = WORKTREE_UNAVAILABLE_MESSAGES[listResult.reason];
          await context.dialogs.alert({
            body: pluginText(context, message.key, message.fallback),
            title: operationFailedReason(context),
          });
          return;
        }
        const [branches, defaults] = await Promise.all([
          context.git.listBranches(listResult.mainPath, { kind: "all" }),
          context.worktrees.creationDefaults({ path: listResult.mainPath }),
        ]);
        openWorktreeCreateOverlay(
          context,
          {
            branches,
            defaults,
            existingBranches: branches.map((ref) => ref.name),
            existingNames: listResult.worktrees.map((item) =>
              basename(item.path)
            ),
            mainPath: listResult.mainPath,
          },
          invocation?.sourcePanelGroupId
        );
      } catch (err) {
        await context.dialogs.alert({
          body: errorMessage(err),
          title: operationFailedReason(context),
        });
      }
    },
    id: "pier.worktree.create",
    metadata: {
      categoryKey: "worktree",
      group: "1_worktree",
      iconComponent: GitBranch,
      sortOrder: 2,
    },
    surfaces: ["command-palette", "create-menu"],
    title: () =>
      context.i18n.commandTitle("pier.worktree.create", "Create Worktree"),
  });
}

function registerWorktreeDeleteAction(
  context: RendererPluginContext
): () => void {
  return context.actions.register({
    category: "Worktree",
    disabledReason: () => {
      const target = activeWorktreeTarget(context);
      return target.enabled ? null : target.reason;
    },
    enabled: () => activeWorktreeTarget(context).enabled,
    handler: async () => {
      const title = context.i18n.commandTitle(
        "pier.worktree.delete",
        "Delete Worktrees..."
      );
      const target = activeWorktreeTarget(context);
      if (!target.enabled) {
        openUnavailablePick(context, target.reason);
        return;
      }
      const result = await context.worktrees.list({ path: target.path });
      if (result.status !== "available") {
        openUnavailablePick(context, unsupportedReason(context));
        return;
      }
      const candidates = result.worktrees.filter(
        (item) => !(item.bare || item.prunable || item.isMain || item.isCurrent)
      );
      if (candidates.length === 0) {
        showWorktreeMessage(
          context,
          title,
          pluginText(
            context,
            "noWorktreeToDelete",
            "No worktree can be deleted"
          )
        );
        return;
      }
      const items = candidates.map((worktree) => ({
        detail: worktree.path,
        icon: FolderGit2,
        id: `delete:${worktree.path}`,
        label: itemLabel(worktree),
        searchTerms: worktreeSearchTerms(worktree),
      }));
      const worktreesById = new Map(
        candidates.map((worktree) => [`delete:${worktree.path}`, worktree])
      );
      context.commandPalette.openQuickPick({
        items,
        onAccept: async (selected) => {
          const worktree = worktreesById.get(selected.id);
          if (!worktree) {
            return;
          }
          await deleteSelectedWorktree(
            context,
            title,
            target.path,
            result.currentPath,
            worktree
          );
        },
        placeholder: pluginText(
          context,
          "deletePlaceholder",
          "Select a worktree"
        ),
        title,
      });
    },
    id: "pier.worktree.delete",
    metadata: {
      categoryKey: "worktree",
      group: "1_worktree",
      iconComponent: Trash2,
      sortOrder: 3,
    },
    surfaces: ["command-palette"],
    title: () =>
      context.i18n.commandTitle("pier.worktree.delete", "Delete Worktrees..."),
  });
}

type WorktreeDeleteChoice = "cancel" | "delete" | "deleteWithBranch";

/** 删除确认;worktree 挂着本地分支时额外提供「同时安全删除分支」选项。 */
async function confirmWorktreeDelete(
  context: RendererPluginContext,
  title: string,
  message: string,
  branch: string | null
): Promise<WorktreeDeleteChoice> {
  return await new Promise((resolve) => {
    context.commandPalette.openQuickPick({
      items: [
        { id: "cancel", label: pluginText(context, "cancel", "Cancel") },
        {
          // 与既有确认流保持同一 id("confirm"),下方分支删除项为增量选项。
          id: "confirm",
          label: pluginText(context, "deleteConfirmButton", "Delete"),
          variant: "destructive",
        },
        ...(branch
          ? [
              {
                detail: pluginText(
                  context,
                  "deleteBranchSafeDetail",
                  "Runs git branch -d; fails if the branch is not merged."
                ),
                id: "delete-with-branch",
                label: pluginText(
                  context,
                  "deleteWithBranchButton",
                  "Delete and remove branch {{branch}}",
                  { branch }
                ),
                variant: "destructive" as const,
              },
            ]
          : []),
      ],
      onAccept: (item) => {
        if (item.id === "confirm") {
          resolve("delete");
        } else if (item.id === "delete-with-branch") {
          resolve("deleteWithBranch");
        } else {
          resolve("cancel");
        }
      },
      onDismiss: () => {
        resolve("cancel");
      },
      placeholder: message,
      title,
    });
  });
}

async function deleteSelectedWorktree(
  context: RendererPluginContext,
  title: string,
  targetPath: string,
  currentPath: string | undefined,
  worktree: WorktreeItem
): Promise<void> {
  let confirmMessage = pluginText(
    context,
    "deleteConfirm",
    "Delete worktree {{name}}?",
    { name: itemLabel(worktree) }
  );
  const binding = await context.environments
    .worktreeBinding({ worktreePath: worktree.path })
    .catch(() => null);
  if (binding?.hasCleanupScript) {
    const projectName = basename(binding.projectRootPath);
    confirmMessage +=
      "\n" +
      pluginText(
        context,
        "deleteCleanupWarning",
        "Cleanup will run for project \u201c{{name}}\u201d.",
        { name: projectName }
      );
  }

  const choice = await confirmWorktreeDelete(
    context,
    title,
    confirmMessage,
    worktree.branch
  );
  if (choice === "cancel") {
    return;
  }
  try {
    const result = await context.worktrees.remove({
      currentPath: currentPath ?? targetPath,
      ...(choice === "deleteWithBranch" ? { deleteBranch: true } : {}),
      path: worktree.path,
    });
    if (result.branchDeletion && !result.branchDeletion.deleted) {
      showWorktreeMessage(
        context,
        title,
        pluginText(
          context,
          "worktreeDeleteBranchFailed",
          "Worktree deleted, but branch {{branch}} could not be removed",
          { branch: result.branchDeletion.branch }
        ),
        result.branchDeletion.message ?? undefined
      );
      return;
    }
    showWorktreeMessage(
      context,
      title,
      result.branchDeletion?.deleted
        ? pluginText(
            context,
            "worktreeDeleteWithBranchSuccess",
            "Worktree and branch {{branch}} deleted",
            { branch: result.branchDeletion.branch }
          )
        : pluginText(context, "worktreeDeleteSuccess", "Worktree deleted"),
      worktree.path
    );
  } catch (err) {
    showWorktreeMessage(
      context,
      title,
      operationFailedReason(context),
      errorMessage(err)
    );
  }
}

function registerWorktreePruneAction(
  context: RendererPluginContext
): () => void {
  return context.actions.register({
    category: "Worktree",
    disabledReason: () => {
      const target = activeWorktreeTarget(context);
      return target.enabled ? null : target.reason;
    },
    enabled: () => activeWorktreeTarget(context).enabled,
    handler: async () => {
      const title = context.i18n.commandTitle(
        "pier.worktree.prune",
        "Prune Stale Worktrees"
      );
      const target = activeWorktreeTarget(context);
      if (!target.enabled) {
        openUnavailablePick(context, target.reason);
        return;
      }
      const before = await context.worktrees.list({ path: target.path });
      if (before.status !== "available") {
        openUnavailablePick(context, unsupportedReason(context));
        return;
      }
      const prunableCount = before.worktrees.filter(
        (item) => item.prunable
      ).length;
      if (prunableCount === 0) {
        showWorktreeMessage(
          context,
          title,
          pluginText(context, "noPrunableWorktrees", "No stale worktrees found")
        );
        return;
      }
      await pruneWorktrees(context, title, target.path);
    },
    id: "pier.worktree.prune",
    metadata: {
      categoryKey: "worktree",
      group: "1_worktree",
      iconComponent: BrushCleaning,
      sortOrder: 4,
    },
    surfaces: ["command-palette"],
    title: () =>
      context.i18n.commandTitle("pier.worktree.prune", "Prune Stale Worktrees"),
  });
}

async function pruneWorktrees(
  context: RendererPluginContext,
  title: string,
  path: string
): Promise<void> {
  const confirmed = await confirmQuickPick(
    context,
    title,
    pluginText(context, "pruneConfirm", "Prune stale worktree entries?"),
    pluginText(context, "pruneConfirmButton", "Prune")
  );
  if (!confirmed) {
    return;
  }
  try {
    const result = await context.worktrees.prune({ path });
    // main 侧仓库不可用时以 unavailable 结果(而非异常)返回,不能当成功报。
    if (result.status === "unavailable") {
      showWorktreeMessage(
        context,
        title,
        operationFailedReason(context),
        result.reason
      );
      return;
    }
    showWorktreeMessage(
      context,
      title,
      pluginText(context, "worktreePruneSuccess", "Stale worktrees pruned")
    );
  } catch (err) {
    showWorktreeMessage(
      context,
      title,
      operationFailedReason(context),
      errorMessage(err)
    );
  }
}

export function registerWorktreeOperationActions(
  context: RendererPluginContext
): () => void {
  const disposers = [
    registerWorktreeCreateAction(context),
    registerWorktreeDeleteAction(context),
    registerWorktreePruneAction(context),
  ];
  return () => {
    for (const dispose of disposers) {
      dispose();
    }
  };
}

import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { WorktreeItem } from "@shared/contracts/worktree.ts";
import { BrushCleaning, FolderGit2, GitBranch, Trash2 } from "lucide-react";
import { openWorktreeCreateOverlay } from "./worktree-create-overlay.tsx";

const PATH_SEPARATOR_RE = /[\\/]/;

function basename(path: string): string {
  const parts = path.split(PATH_SEPARATOR_RE).filter(Boolean);
  return parts.at(-1) ?? path;
}

function pluginText(
  context: RendererPluginContext,
  key: string,
  fallback: string,
  values?: Record<string, number | string>
): string {
  return context.i18n.t(`ui.${key}`, values, fallback);
}

function unsupportedReason(context: RendererPluginContext): string {
  return pluginText(
    context,
    "unsupported",
    "Current directory does not support Git worktrees"
  );
}

function operationFailedReason(context: RendererPluginContext): string {
  return pluginText(
    context,
    "worktreeOperationFailed",
    "Worktree operation failed"
  );
}

function activeWorktreeTarget(
  context: RendererPluginContext
):
  | { enabled: true; path: string }
  | { enabled: false; path: null | string; reason: string } {
  const panelContext = context.panels.getActiveContext();
  const path =
    panelContext?.worktreeRoot ??
    panelContext?.gitRoot ??
    panelContext?.projectRootPath ??
    panelContext?.cwd ??
    null;
  if (!(path && (panelContext?.worktreeRoot || panelContext?.gitRoot))) {
    return { enabled: false, path, reason: unsupportedReason(context) };
  }
  if (panelContext.worktreeSupported === false) {
    return { enabled: false, path, reason: unsupportedReason(context) };
  }
  return { enabled: true, path };
}

function itemLabel(worktree: WorktreeItem): string {
  return worktree.branch ?? basename(worktree.path);
}

function worktreeSearchTerms(worktree: WorktreeItem): readonly string[] {
  return [
    worktree.path,
    basename(worktree.path),
    worktree.branch ?? "",
    worktree.head ?? "",
  ].filter(Boolean);
}

function openUnavailablePick(
  context: RendererPluginContext,
  reason: string
): void {
  context.commandPalette.openQuickPick({
    items: [{ disabled: true, id: "worktree-unavailable", label: reason }],
    onAccept: () => undefined,
    placeholder: reason,
    title: pluginText(context, "title", "Worktrees"),
  });
}

function showWorktreeMessage(
  context: RendererPluginContext,
  title: string,
  message: string,
  detail?: string
): void {
  context.commandPalette.openQuickPick({
    items: [
      {
        ...(detail ? { detail } : {}),
        disabled: true,
        id: "worktree-message",
        label: message,
      },
    ],
    onAccept: () => undefined,
    placeholder: message,
    title,
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function confirmQuickPick(
  context: RendererPluginContext,
  title: string,
  message: string,
  confirmLabel: string
): Promise<boolean> {
  return await new Promise((resolve) => {
    context.commandPalette.openQuickPick({
      items: [
        { id: "cancel", label: pluginText(context, "cancel", "Cancel") },
        // 两个调用方 (删除/清理 worktree) 都是破坏性操作, 确认项统一警示色。
        { id: "confirm", label: confirmLabel, variant: "destructive" },
      ],
      onAccept: (item) => {
        resolve(item.id === "confirm");
      },
      onDismiss: () => {
        resolve(false);
      },
      placeholder: message,
      title,
    });
  });
}

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
    handler: async () => {
      const target = activeWorktreeTarget(context);
      if (!target.enabled) {
        openUnavailablePick(context, target.reason);
        return;
      }
      try {
        const listResult = await context.worktrees.list({ path: target.path });
        if (listResult.status !== "available") {
          context.notifications.error(
            pluginText(
              context,
              "worktreeCreate.unavailable",
              "Worktrees are unavailable: {{message}}",
              { message: listResult.reason }
            )
          );
          return;
        }
        const [branches, defaults] = await Promise.all([
          context.git.listBranches(listResult.mainPath, { kind: "all" }),
          context.worktrees.creationDefaults({ path: listResult.mainPath }),
        ]);
        openWorktreeCreateOverlay(context, {
          branches,
          defaults,
          existingBranches: branches.map((ref) => ref.name),
          existingNames: listResult.worktrees.map((item) =>
            basename(item.path)
          ),
          mainPath: listResult.mainPath,
        });
      } catch (err) {
        context.notifications.error(
          pluginText(
            context,
            "worktreeCreate.openFailed",
            "Couldn't open worktree creation: {{message}}",
            { message: errorMessage(err) }
          )
        );
      }
    },
    id: "pier.worktree.create",
    metadata: {
      categoryKey: "worktree",
      group: "1_worktree",
      iconComponent: GitBranch,
      sortOrder: 2,
    },
    surfaces: ["command-palette"],
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

  const confirmed = await confirmQuickPick(
    context,
    title,
    confirmMessage,
    pluginText(context, "deleteConfirmButton", "Delete")
  );
  if (!confirmed) {
    return;
  }
  try {
    await context.worktrees.remove({
      currentPath: currentPath ?? targetPath,
      path: worktree.path,
    });
    showWorktreeMessage(
      context,
      title,
      pluginText(context, "worktreeDeleteSuccess", "Worktree deleted"),
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

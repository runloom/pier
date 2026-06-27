import type {
  RendererPluginContext,
  RendererPluginQuickPickItem,
  RendererPluginQuickPickSection,
} from "@plugins/api/renderer.ts";
import type {
  WorktreeItem,
  WorktreeListResult,
} from "@shared/contracts/worktree.ts";
import { GitBranch, GitFork, Trash2 } from "lucide-react";

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

function worktreeTitle(context: RendererPluginContext): string {
  return pluginText(context, "title", "Worktrees");
}

function unsupportedReason(context: RendererPluginContext): string {
  return pluginText(
    context,
    "unsupported",
    "Current directory does not support Git worktrees"
  );
}

function createDisabledReason(context: RendererPluginContext): string {
  return pluginText(
    context,
    "createUnavailable",
    "Worktree creation is not available yet"
  );
}

function deleteDisabledReason(context: RendererPluginContext): string {
  return pluginText(
    context,
    "deleteUnavailable",
    "Worktree deletion is not available yet"
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
    panelContext?.projectRoot ??
    panelContext?.cwd ??
    null;
  if (!(path && (panelContext?.worktreeRoot || panelContext?.gitRoot))) {
    return {
      enabled: false,
      path,
      reason: unsupportedReason(context),
    };
  }
  return { enabled: true, path };
}

function itemLabel(
  context: RendererPluginContext,
  worktree: WorktreeItem
): string {
  if (worktree.isMain) {
    return worktree.branch
      ? pluginText(context, "mainWithBranch", "main ({{branch}})", {
          branch: worktree.branch,
        })
      : pluginText(context, "main", "main");
  }
  return worktree.branch ?? basename(worktree.path);
}

function buildWorktreeSections(
  context: RendererPluginContext,
  result: Extract<WorktreeListResult, { status: "available" }>
): RendererPluginQuickPickSection[] {
  const items = result.worktrees
    .filter((worktree) => !(worktree.bare || worktree.prunable))
    .map((worktree) => ({
      checked: worktree.isCurrent,
      ...(worktree.locked
        ? {
            description:
              worktree.lockedReason ?? pluginText(context, "locked", "Locked"),
          }
        : {}),
      detail: worktree.path,
      disabled: false,
      id: `worktree:${worktree.path}`,
      keywords: [worktree.path, worktree.branch ?? ""].filter(Boolean),
      label: itemLabel(context, worktree),
    }));
  return [
    {
      heading: worktreeTitle(context),
      id: "worktrees",
      items,
    },
  ];
}

function unavailableItems(reason: string): RendererPluginQuickPickItem[] {
  return [
    {
      disabled: true,
      id: "worktree-unavailable",
      label: reason,
    },
  ];
}

function openUnavailablePick(
  context: RendererPluginContext,
  reason: string
): void {
  context.commandPalette.openQuickPick({
    items: unavailableItems(reason),
    onAccept: () => undefined,
    placeholder: reason,
    title: worktreeTitle(context),
  });
}

export async function openWorktreeListQuickPick(
  context: RendererPluginContext,
  path: string
): Promise<void> {
  const capability = await context.worktrees.check({ path });
  if (capability.status === "unsupported") {
    openUnavailablePick(context, unsupportedReason(context));
    return;
  }

  const result = await context.worktrees.list({ path });
  const panelsByItemId = new Map<string, WorktreeItem>();
  if (result.status === "available") {
    for (const worktree of result.worktrees.filter(
      (item) => !(item.bare || item.prunable)
    )) {
      panelsByItemId.set(`worktree:${worktree.path}`, worktree);
    }
  }

  context.commandPalette.openQuickPick({
    ...(result.status === "available"
      ? { sections: buildWorktreeSections(context, result) }
      : { items: unavailableItems(unsupportedReason(context)) }),
    onAccept: async (item) => {
      const worktree = panelsByItemId.get(item.id);
      if (!worktree) {
        return;
      }
      await context.worktrees.open({ path: worktree.path });
    },
    placeholder: pluginText(
      context,
      "selectPlaceholder",
      "Select a worktree..."
    ),
    title: worktreeTitle(context),
  });
}

function registerWorktreeListAction(
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

      await openWorktreeListQuickPick(context, target.path);
    },
    id: "pier.worktree.list",
    metadata: {
      group: "1_worktree",
      iconComponent: GitFork,
      keywords: ["worktree", "git", "list", "workspace", "工作树", "列表"],
      sortOrder: 1,
    },
    surfaces: ["command-palette"],
    title: () =>
      context.i18n.commandTitle("pier.worktree.list", "Worktree: List"),
  });
}

function registerDisabledWorktreeCreateAction(
  context: RendererPluginContext
): () => void {
  return context.actions.register({
    category: "Worktree",
    disabledReason: () => createDisabledReason(context),
    enabled: () => false,
    handler: () => undefined,
    id: "pier.worktree.create",
    metadata: {
      group: "1_worktree",
      iconComponent: GitBranch,
      keywords: ["worktree", "git", "create", "new", "工作树", "创建"],
      sortOrder: 2,
    },
    surfaces: ["command-palette"],
    title: () =>
      context.i18n.commandTitle("pier.worktree.create", "Worktree: Create"),
  });
}

function registerDisabledWorktreeDeleteAction(
  context: RendererPluginContext
): () => void {
  return context.actions.register({
    category: "Worktree",
    disabledReason: () => deleteDisabledReason(context),
    enabled: () => false,
    handler: () => undefined,
    id: "pier.worktree.delete",
    metadata: {
      group: "1_worktree",
      iconComponent: Trash2,
      keywords: ["worktree", "git", "delete", "remove", "工作树", "删除"],
      sortOrder: 3,
    },
    surfaces: ["command-palette"],
    title: () =>
      context.i18n.commandTitle("pier.worktree.delete", "Worktree: Delete..."),
  });
}

export function registerWorktreeActions(
  context: RendererPluginContext
): () => void {
  const disposers = [
    registerWorktreeListAction(context),
    registerDisabledWorktreeCreateAction(context),
    registerDisabledWorktreeDeleteAction(context),
  ];
  return () => {
    for (const dispose of disposers) {
      dispose();
    }
  };
}

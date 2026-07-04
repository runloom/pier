import type {
  RendererPluginContext,
  RendererPluginQuickPickItem,
  RendererPluginQuickPickItemBadge,
  RendererPluginQuickPickSection,
} from "@plugins/api/renderer.ts";
import type {
  WorktreeItem,
  WorktreeListResult,
} from "@shared/contracts/worktree.ts";
import { FolderGit2 } from "lucide-react";
import { registerWorktreeOperationActions } from "./worktree-operation-actions.ts";

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
    return {
      enabled: false,
      path,
      reason: unsupportedReason(context),
    };
  }
  if (panelContext.worktreeSupported === false) {
    return {
      enabled: false,
      path,
      reason: unsupportedReason(context),
    };
  }
  return { enabled: true, path };
}

function itemLabel(worktree: WorktreeItem): string {
  // 标题直接用分支名(和分支列表同语言);"主工作树" 语义交给 badge, 避免重复。
  return worktree.branch ?? basename(worktree.path);
}

function itemDescription(
  context: RendererPluginContext,
  worktree: WorktreeItem
): string | undefined {
  if (worktree.locked) {
    return worktree.lockedReason ?? pluginText(context, "locked", "Locked");
  }
  return;
}

function itemBadges(
  context: RendererPluginContext,
  worktree: WorktreeItem
): RendererPluginQuickPickItemBadge[] {
  const badges: RendererPluginQuickPickItemBadge[] = [];
  if (worktree.isMain) {
    badges.push({
      label: pluginText(context, "mainBadge", "main"),
      variant: "outline",
    });
  }
  if (worktree.locked) {
    badges.push({
      label: pluginText(context, "locked", "Locked"),
      variant: "outline",
    });
  }
  return badges;
}

function worktreeSearchTerms(worktree: WorktreeItem): readonly string[] {
  return [
    worktree.path,
    basename(worktree.path),
    worktree.branch ?? "",
    worktree.head ?? "",
  ].filter(Boolean);
}

function buildWorktreeSections(
  context: RendererPluginContext,
  result: Extract<WorktreeListResult, { status: "available" }>
): RendererPluginQuickPickSection[] {
  const items = result.worktrees
    .filter((worktree) => !(worktree.bare || worktree.prunable))
    .map((worktree) => {
      const description = itemDescription(context, worktree);
      return {
        badges: itemBadges(context, worktree),
        checked: worktree.isCurrent,
        ...(description ? { description } : {}),
        detail: worktree.path,
        disabled: false,
        icon: FolderGit2,
        id: `worktree:${worktree.path}`,
        label: itemLabel(worktree),
        searchTerms: worktreeSearchTerms(worktree),
      };
    });
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
      if (result.status !== "available") {
        return;
      }
      try {
        await context.worktrees.open({ path: worktree.path });
      } catch (err) {
        // 面板只把 onAccept 的 rejection 记到 console,必须自己给用户反馈。
        context.notifications.error(
          pluginText(
            context,
            "worktreeOperationFailed",
            "Worktree operation failed"
          ),
          { description: err instanceof Error ? err.message : String(err) }
        );
      }
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
      categoryKey: "git",
      group: "1_worktree",
      iconComponent: FolderGit2,
      sortOrder: 1,
    },
    surfaces: ["command-palette"],
    title: () =>
      context.i18n.commandTitle("pier.worktree.list", "List Worktrees"),
  });
}

export function registerWorktreeActions(
  context: RendererPluginContext
): () => void {
  const disposers = [
    registerWorktreeListAction(context),
    registerWorktreeOperationActions(context),
  ];
  return () => {
    for (const dispose of disposers) {
      dispose();
    }
  };
}

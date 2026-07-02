import type {
  RendererPluginContext,
  RendererPluginQuickPickItem,
} from "@plugins/api/renderer.ts";
import type {
  GitStashEntry,
  GitStashPopResult,
  GitStashResult,
} from "@shared/contracts/git.ts";
import { Package } from "lucide-react";
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

interface StashItem extends RendererPluginQuickPickItem {
  index: number;
}

function stashItem(entry: GitStashEntry): StashItem {
  return {
    detail: entry.date,
    id: String(entry.index),
    index: entry.index,
    label: `stash@{${entry.index}}`,
    searchTerms: [entry.message, entry.hash],
    ...(entry.message ? { description: entry.message } : {}),
  };
}

async function openStashPick(
  context: RendererPluginContext,
  title: string
): Promise<void> {
  const cwd = activeCwdOrMessage(context, title);
  if (!cwd) {
    return;
  }
  let entries: GitStashEntry[];
  try {
    const result = await context.git.listStashes(cwd);
    if (result.kind === "unavailable") {
      await showUnavailable(context, title, result.message?.trim());
      return;
    }
    entries = result.entries;
  } catch (err) {
    await showError(context, title, err);
    return;
  }
  if (entries.length === 0) {
    showInfo(
      context,
      title,
      pluginText(context, "gitStashListEmpty", "No stashes found")
    );
    return;
  }
  const items = entries.map(stashItem);
  const itemsById = new Map(items.map((item) => [item.id, item]));
  context.commandPalette.openQuickPick({
    items,
    onAccept: async (selected) => {
      const item = itemsById.get(selected.id);
      if (!item) {
        return;
      }
      await runPopStash(context, title, cwd, item.index);
    },
    placeholder: pluginText(context, "gitStashSelect", "Select a stash to pop"),
    title,
  });
}

async function runPopStash(
  context: RendererPluginContext,
  title: string,
  cwd: string,
  index: number
): Promise<void> {
  const loading = showLoading(
    context,
    pluginText(context, "gitLoadingStashPop", "Applying stash...")
  );
  let result: GitStashPopResult;
  try {
    result = await context.git.popStash(cwd, index);
  } catch (err) {
    loading.dismiss();
    await showError(context, title, err);
    return;
  }
  if (result.kind === "ok") {
    loading.success(
      pluginText(context, "gitStashPopSuccess", "Stash applied and removed")
    );
  } else if (result.kind === "conflict") {
    loading.dismiss();
    await confirmOpenReview(
      context,
      pluginText(context, "gitStashConflictTitle", "Stash Conflicts"),
      pluginText(
        context,
        "gitStashConflictBody",
        "Stash was applied but resulted in conflicts that need to be resolved."
      )
    );
  } else {
    loading.dismiss();
    await showUnavailable(context, title, result.message?.trim());
  }
}

export function registerStashAction(
  context: RendererPluginContext
): () => void {
  return context.actions.register({
    category: "Git",
    disabledReason: () => disabledReasonForActiveGit(context),
    enabled: () => enabledForActiveGit(context),
    handler: async () => {
      const title = commandTitle(context, "pier.git.stash", "Stash");
      const cwd = activeCwdOrMessage(context, title);
      if (!cwd) {
        return;
      }
      const loading = showLoading(
        context,
        pluginText(context, "gitLoadingStash", "Stashing changes...")
      );
      let result: GitStashResult;
      try {
        result = await context.git.stash(cwd, { includeUntracked: true });
      } catch (err) {
        loading.dismiss();
        await showError(context, title, err);
        return;
      }
      if (result.kind === "ok") {
        loading.success(
          pluginText(context, "gitStashSuccess", "Changes stashed")
        );
      } else if (result.kind === "nothing_to_stash") {
        loading.info(
          pluginText(context, "gitStashNothing", "No local changes to stash")
        );
      } else {
        loading.dismiss();
        await showUnavailable(context, title, result.message?.trim());
      }
    },
    id: "pier.git.stash",
    metadata: {
      categoryKey: "git",
      group: "2_git",
      iconComponent: Package,
      sortOrder: 12,
    },
    surfaces: ["command-palette"],
    title: () => commandTitle(context, "pier.git.stash", "Stash"),
  });
}

export function registerStashPopAction(
  context: RendererPluginContext
): () => void {
  return context.actions.register({
    category: "Git",
    disabledReason: () => disabledReasonForActiveGit(context),
    enabled: () => enabledForActiveGit(context),
    handler: async () =>
      openStashPick(
        context,
        commandTitle(context, "pier.git.stashPop", "Pop Stash...")
      ),
    id: "pier.git.stashPop",
    metadata: {
      categoryKey: "git",
      group: "2_git",
      iconComponent: Package,
      sortOrder: 13,
    },
    surfaces: ["command-palette"],
    title: () => commandTitle(context, "pier.git.stashPop", "Pop Stash..."),
  });
}

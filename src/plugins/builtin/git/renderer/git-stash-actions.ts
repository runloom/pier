import type {
  RendererPluginContext,
  RendererPluginQuickPickItem,
} from "@plugins/api/renderer.ts";
import type {
  GitStashApplyResult,
  GitStashDropResult,
  GitStashEntry,
  GitStashPopResult,
  GitStashResult,
} from "@shared/contracts/git.ts";
import { Package } from "lucide-react";
import { formatRelativeTime } from "./format-relative-time.ts";
import {
  activeCwdOrMessage,
  commandTitle,
  confirmDialog,
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
  // message 是主要信息, 放第二行(空间足); 日期作次要信息靠右, 与分支列表的相对时间同位。
  return {
    description: formatRelativeTime(entry.date) || entry.date,
    icon: Package,
    id: String(entry.index),
    index: entry.index,
    label: `stash@{${entry.index}}`,
    searchTerms: [entry.message, entry.hash],
    ...(entry.message ? { detail: entry.message } : {}),
  };
}

/** pop / apply / drop 共用的储藏选择器：仅回调不同。 */
async function openStashPick(
  context: RendererPluginContext,
  title: string,
  placeholder: string,
  onPick: (cwd: string, item: StashItem) => Promise<void>
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
      await onPick(cwd, item);
    },
    placeholder,
    title,
  });
}

/** 与 VS Code 语义对齐：裸 Stash 只存已跟踪变更；含未跟踪走独立命令。 */
async function runStash(
  context: RendererPluginContext,
  title: string,
  includeUntracked: boolean
): Promise<void> {
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
    result = await context.git.stash(cwd, { includeUntracked });
  } catch (err) {
    loading.dismiss();
    await showError(context, title, err);
    return;
  }
  if (result.kind === "ok") {
    loading.success(pluginText(context, "gitStashSuccess", "Changes stashed"));
  } else if (result.kind === "nothing_to_stash") {
    loading.info(
      pluginText(context, "gitStashNothing", "No local changes to stash")
    );
  } else {
    loading.dismiss();
    await showUnavailable(context, title, result.message?.trim());
  }
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

async function runApplyStash(
  context: RendererPluginContext,
  title: string,
  cwd: string,
  index: number
): Promise<void> {
  const loading = showLoading(
    context,
    pluginText(
      context,
      "gitLoadingStashApply",
      "Applying stash (keeping it in the list)..."
    )
  );
  let result: GitStashApplyResult;
  try {
    result = await context.git.applyStash(cwd, index);
  } catch (err) {
    loading.dismiss();
    await showError(context, title, err);
    return;
  }
  if (result.kind === "ok") {
    loading.success(
      pluginText(
        context,
        "gitStashApplySuccess",
        "Stash applied (kept in stash list)"
      )
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

async function runDropStash(
  context: RendererPluginContext,
  title: string,
  cwd: string,
  item: StashItem
): Promise<void> {
  const confirmed = await confirmDialog(
    context,
    title,
    pluginText(
      context,
      "gitStashDropConfirmBody",
      "Drop {{stash}}? This cannot be undone.",
      { stash: item.label }
    ),
    pluginText(context, "gitStashDropConfirmLabel", "Drop"),
    item.detail
  );
  if (!confirmed) {
    return;
  }
  const loading = showLoading(
    context,
    pluginText(context, "gitLoadingStashDrop", "Dropping stash...")
  );
  let result: GitStashDropResult;
  try {
    result = await context.git.dropStash(cwd, item.index);
  } catch (err) {
    loading.dismiss();
    await showError(context, title, err);
    return;
  }
  if (result.kind === "ok") {
    loading.success(
      pluginText(context, "gitStashDropSuccess", "Stash dropped")
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
    handler: async () =>
      runStash(
        context,
        commandTitle(context, "pier.git.stash", "Git: Stash"),
        false
      ),
    id: "pier.git.stash",
    metadata: {
      categoryKey: "git",
      group: "2_git",
      iconComponent: Package,
      sortOrder: 12,
    },
    surfaces: ["command-palette"],
    title: () => commandTitle(context, "pier.git.stash", "Git: Stash"),
  });
}

export function registerStashIncludeUntrackedAction(
  context: RendererPluginContext
): () => void {
  return context.actions.register({
    category: "Git",
    disabledReason: () => disabledReasonForActiveGit(context),
    enabled: () => enabledForActiveGit(context),
    handler: async () =>
      runStash(
        context,
        commandTitle(
          context,
          "pier.git.stashIncludeUntracked",
          "Git: Stash (Include Untracked)"
        ),
        true
      ),
    id: "pier.git.stashIncludeUntracked",
    metadata: {
      categoryKey: "git",
      group: "2_git",
      iconComponent: Package,
      sortOrder: 13,
    },
    surfaces: ["command-palette"],
    title: () =>
      commandTitle(
        context,
        "pier.git.stashIncludeUntracked",
        "Git: Stash (Include Untracked)"
      ),
  });
}

export function registerStashPopAction(
  context: RendererPluginContext
): () => void {
  return context.actions.register({
    category: "Git",
    disabledReason: () => disabledReasonForActiveGit(context),
    enabled: () => enabledForActiveGit(context),
    handler: async () => {
      const title = commandTitle(
        context,
        "pier.git.stashPop",
        "Git: Pop Stash..."
      );
      await openStashPick(
        context,
        title,
        pluginText(context, "gitStashSelect", "Select a stash to pop"),
        (cwd, item) => runPopStash(context, title, cwd, item.index)
      );
    },
    id: "pier.git.stashPop",
    metadata: {
      categoryKey: "git",
      group: "2_git",
      iconComponent: Package,
      sortOrder: 14,
    },
    surfaces: ["command-palette"],
    title: () =>
      commandTitle(context, "pier.git.stashPop", "Git: Pop Stash..."),
  });
}

export function registerStashApplyAction(
  context: RendererPluginContext
): () => void {
  return context.actions.register({
    category: "Git",
    disabledReason: () => disabledReasonForActiveGit(context),
    enabled: () => enabledForActiveGit(context),
    handler: async () => {
      const title = commandTitle(
        context,
        "pier.git.stashApply",
        "Git: Apply Stash..."
      );
      await openStashPick(
        context,
        title,
        pluginText(context, "gitStashSelectApply", "Select a stash to apply"),
        (cwd, item) => runApplyStash(context, title, cwd, item.index)
      );
    },
    id: "pier.git.stashApply",
    metadata: {
      categoryKey: "git",
      group: "2_git",
      iconComponent: Package,
      sortOrder: 15,
    },
    surfaces: ["command-palette"],
    title: () =>
      commandTitle(context, "pier.git.stashApply", "Git: Apply Stash..."),
  });
}

export function registerStashDropAction(
  context: RendererPluginContext
): () => void {
  return context.actions.register({
    category: "Git",
    disabledReason: () => disabledReasonForActiveGit(context),
    enabled: () => enabledForActiveGit(context),
    handler: async () => {
      const title = commandTitle(
        context,
        "pier.git.stashDrop",
        "Git: Drop Stash..."
      );
      await openStashPick(
        context,
        title,
        pluginText(context, "gitStashSelectDrop", "Select a stash to drop"),
        (cwd, item) => runDropStash(context, title, cwd, item)
      );
    },
    id: "pier.git.stashDrop",
    metadata: {
      categoryKey: "git",
      group: "2_git",
      iconComponent: Package,
      sortOrder: 16,
    },
    surfaces: ["command-palette"],
    title: () =>
      commandTitle(context, "pier.git.stashDrop", "Git: Drop Stash..."),
  });
}

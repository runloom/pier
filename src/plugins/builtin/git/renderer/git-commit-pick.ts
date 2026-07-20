import type {
  RendererPluginContext,
  RendererPluginQuickPickItem,
} from "@plugins/api/renderer.ts";
import type { GitCommit } from "@shared/contracts/git.ts";
import { createElement } from "react";
import {
  GitCommitQuickPickRow,
  shortCommitHash,
} from "./git-commit-quick-pick-row.tsx";
import { pluginText } from "./git-plugin-text.ts";

const COMMIT_PICK_LIMIT = 50;

function readCommitItem(item: RendererPluginQuickPickItem): GitCommit | null {
  const data = item.data;
  if (
    typeof data !== "object" ||
    data === null ||
    !("hash" in data) ||
    !("message" in data) ||
    typeof data.hash !== "string" ||
    typeof data.message !== "string"
  ) {
    return null;
  }
  return data as GitCommit;
}

function commitItem(commit: GitCommit): RendererPluginQuickPickItem {
  return {
    data: commit,
    id: `commit:${commit.hash}`,
    label: commit.message || shortCommitHash(commit.hash),
    searchTerms: [commit.hash, commit.author, commit.message],
  };
}

/**
 * commit 选择 quick-pick。查询走 main 侧结构化搜索
 * (hash/@author/:path/~pickaxe/since:/until:/all:)而非本地过滤,
 * 每次输入变化取消上一次请求(signal)后回填 items。
 */
export function openCommitPick(
  context: RendererPluginContext,
  options: {
    cwd: string;
    onPick: (commit: GitCommit) => Promise<void> | void;
    placeholder?: string;
    title: string;
  }
): void {
  const searchFailedText = pluginText(
    context,
    "gitCommitSearchFailed",
    "Commit search failed"
  );
  context.commandPalette.openQuickPick({
    items: [],
    loading: true,
    onAccept: async (selected) => {
      const commit = readCommitItem(selected);
      if (commit) {
        await options.onPick(commit);
      }
    },
    onQueryChange: async (query, signal) => {
      context.commandPalette.updateQuickPick({ loading: true }, { signal });
      const result = await context.git.searchCommits(options.cwd, {
        limit: COMMIT_PICK_LIMIT,
        query,
      });
      if (signal.aborted) {
        return;
      }
      if (result.status !== "ok") {
        context.commandPalette.updateQuickPick(
          {
            errorText: result.message?.trim() || searchFailedText,
            items: [],
            loading: false,
          },
          { signal }
        );
        return;
      }
      context.commandPalette.updateQuickPick(
        {
          errorText: "",
          items: result.items.map(commitItem),
          loading: false,
        },
        { signal }
      );
    },
    placeholder:
      options.placeholder ??
      pluginText(
        context,
        "gitCommitSearchPlaceholder",
        "Search commits: text, hash, @author, :path, ~code, since:/until:"
      ),
    preserveItemOrder: true,
    renderItem: (item) => {
      const commit = readCommitItem(item);
      if (!commit) {
        return null;
      }
      return createElement(GitCommitQuickPickRow, { commit });
    },
    title: options.title,
  });
}

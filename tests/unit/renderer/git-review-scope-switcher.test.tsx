import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  DEFAULT_UNCOMMITTED_FILTER,
  GitReviewScopeSwitcher,
} from "@plugins/builtin/git/renderer/git-review-scope-switcher.tsx";
import type {
  GitCommit,
  GitCommitSearchResult,
  GitDiffBranchesResult,
  GitDiffBranchOption,
} from "@shared/contracts/git.ts";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalScrollIntoView = Element.prototype.scrollIntoView;

const HASH = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0";

function commitsResult(
  items: readonly GitCommit[],
  status: GitCommitSearchResult["status"] = "ok"
): GitCommitSearchResult {
  return { durationMs: 1, items: [...items], message: null, status };
}

function branchOption(name: string, current = false): GitDiffBranchOption {
  return {
    aheadFromCurrent: null,
    authorName: null,
    behindFromCurrent: null,
    commit: null,
    committerDate: null,
    current,
    id: `refs/heads/${name}`,
    kind: "local",
    label: name,
    name,
    pinReason: null,
    refName: `refs/heads/${name}`,
    subject: null,
  };
}

function branchesResult(
  items: readonly GitDiffBranchOption[],
  status: GitDiffBranchesResult["status"] = "ok"
): GitDiffBranchesResult {
  return {
    currentBranch: "feature",
    durationMs: 1,
    items: [...items],
    message: null,
    status,
  };
}

function switcherContext(git: {
  searchBranches?: () => Promise<GitDiffBranchesResult>;
  searchCommits?: () => Promise<GitCommitSearchResult>;
}) {
  const notifyError = vi.fn();
  const context = {
    git: {
      searchBranches: git.searchBranches ?? (async () => branchesResult([])),
      searchCommits: git.searchCommits ?? (async () => commitsResult([])),
    },
    i18n: {
      language: () => "en",
      t: (_key: string, values: unknown, fallback = "") => {
        if (!(values && typeof values === "object")) {
          return fallback;
        }
        return Object.entries(values).reduce(
          (text, [key, value]) => text.replace(`{{${key}}}`, String(value)),
          fallback
        );
      },
    },
    notifications: { error: notifyError },
  } as unknown as RendererPluginContext;
  return { context, notifyError };
}

function renderSwitcher(context: RendererPluginContext) {
  const onSelectTarget = vi.fn();
  render(
    <GitReviewScopeSwitcher
      context={context}
      gitRootPath="/repo"
      onSelectTarget={onSelectTarget}
      onUncommittedFilterChange={vi.fn()}
      target={{ kind: "uncommitted" }}
      uncommittedFilter={DEFAULT_UNCOMMITTED_FILTER}
    />
  );
  return { onSelectTarget };
}

async function selectScope(name: string) {
  fireEvent.click(screen.getByTestId("git-review-scope-switcher"));
  fireEvent.click(await screen.findByRole("option", { name }));
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (originalScrollIntoView) {
    Element.prototype.scrollIntoView = originalScrollIntoView;
  } else {
    Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  }
});

describe("GitReviewScopeSwitcher 自动选取", () => {
  it("切到 commit scope 时自动选中最新提交", async () => {
    const { context, notifyError } = switcherContext({
      searchCommits: async () =>
        commitsResult([
          { author: "dev", date: "2026-07-20", hash: HASH, message: "feat" },
        ]),
    });
    const { onSelectTarget } = renderSwitcher(context);

    await selectScope("Commit");

    await waitFor(() => {
      expect(onSelectTarget).toHaveBeenCalledWith({
        kind: "commit",
        oid: HASH,
      });
    });
    expect(notifyError).not.toHaveBeenCalled();
  });

  it("commit 搜索失败时回退到原 scope 并提示", async () => {
    const { context, notifyError } = switcherContext({
      searchCommits: async () => commitsResult([], "error"),
    });
    const { onSelectTarget } = renderSwitcher(context);

    await selectScope("Commit");

    await waitFor(() => {
      expect(notifyError).toHaveBeenCalledWith(
        "Couldn't load commits. Try again."
      );
    });
    expect(onSelectTarget).not.toHaveBeenCalled();
    expect(screen.getByTestId("git-review-scope-switcher")).toHaveTextContent(
      "Uncommitted"
    );
    expect(screen.queryByTestId("git-review-commit-combobox")).toBeNull();
  });

  it("仓库没有提交时回退并提示无可审阅提交", async () => {
    const { context, notifyError } = switcherContext({
      searchCommits: async () => commitsResult([]),
    });
    const { onSelectTarget } = renderSwitcher(context);

    await selectScope("Commit");

    await waitFor(() => {
      expect(notifyError).toHaveBeenCalledWith(
        "This repository has no commits to review."
      );
    });
    expect(onSelectTarget).not.toHaveBeenCalled();
    expect(screen.getByTestId("git-review-scope-switcher")).toHaveTextContent(
      "Uncommitted"
    );
  });

  it("切到 branch scope 时自动选中默认分支", async () => {
    const { context, notifyError } = switcherContext({
      searchBranches: async () =>
        branchesResult([branchOption("feature", true), branchOption("main")]),
    });
    const { onSelectTarget } = renderSwitcher(context);

    await selectScope("Branch");

    await waitFor(() => {
      expect(onSelectTarget).toHaveBeenCalledWith({
        kind: "branch",
        ref: "main",
      });
    });
    expect(notifyError).not.toHaveBeenCalled();
  });

  it("branch 搜索抛错时回退到原 scope 并提示", async () => {
    const { context, notifyError } = switcherContext({
      searchBranches: () => Promise.reject(new Error("ipc down")),
    });
    const { onSelectTarget } = renderSwitcher(context);

    await selectScope("Branch");

    await waitFor(() => {
      expect(notifyError).toHaveBeenCalledWith(
        "Couldn't load branches. Try again."
      );
    });
    expect(onSelectTarget).not.toHaveBeenCalled();
    expect(screen.getByTestId("git-review-scope-switcher")).toHaveTextContent(
      "Uncommitted"
    );
    expect(screen.queryByTestId("git-review-branch-combobox")).toBeNull();
  });

  it("只有当前分支时回退并提示无可对比分支", async () => {
    const { context, notifyError } = switcherContext({
      searchBranches: async () =>
        branchesResult([branchOption("feature", true)]),
    });
    const { onSelectTarget } = renderSwitcher(context);

    await selectScope("Branch");

    await waitFor(() => {
      expect(notifyError).toHaveBeenCalledWith(
        "No other branches to compare against."
      );
    });
    expect(onSelectTarget).not.toHaveBeenCalled();
    expect(screen.getByTestId("git-review-scope-switcher")).toHaveTextContent(
      "Uncommitted"
    );
  });

  it("手动选取前的等待期不误报(成功路径不触发提示)", async () => {
    let resolveSearch: (result: GitCommitSearchResult) => void = () =>
      undefined;
    const { context, notifyError } = switcherContext({
      searchCommits: () =>
        new Promise<GitCommitSearchResult>((resolve) => {
          resolveSearch = resolve;
        }),
    });
    renderSwitcher(context);

    await selectScope("Commit");
    expect(screen.getByTestId("git-review-commit-combobox")).toHaveTextContent(
      "Select a commit"
    );

    resolveSearch(
      commitsResult([
        { author: "dev", date: "2026-07-20", hash: HASH, message: "feat" },
      ])
    );
    await waitFor(() => {
      expect(notifyError).not.toHaveBeenCalled();
    });
  });
});

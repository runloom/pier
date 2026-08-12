import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { GitReviewCommitCombobox } from "@plugins/builtin/git/renderer/review/scope-comboboxes.tsx";
import type {
  GitCommit,
  GitCommitSearchResult,
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
const SHORT = HASH.slice(0, 7);
const SUBJECT = "feat(workspace): disambiguate file tabs";

function commitsResult(
  items: readonly GitCommit[],
  status: GitCommitSearchResult["status"] = "ok"
): GitCommitSearchResult {
  return { durationMs: 1, items: [...items], message: null, status };
}

function commitFixture(overrides: Partial<GitCommit> = {}): GitCommit {
  return {
    author: "dev",
    date: "2026-07-20",
    hash: HASH,
    message: SUBJECT,
    ...overrides,
  };
}

function comboboxContext(
  searchCommits: (
    cwd: string,
    options?: { query?: string }
  ) => Promise<GitCommitSearchResult>
) {
  return {
    git: { searchCommits },
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
  } as unknown as RendererPluginContext;
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

describe("GitReviewCommitCombobox 触发器标签", () => {
  it("外部只给 oid 时按 hash 解析并展示 subject", async () => {
    const searchCommits = vi.fn(async () => commitsResult([commitFixture()]));
    render(
      <GitReviewCommitCombobox
        context={comboboxContext(searchCommits)}
        gitRootPath="/repo"
        onPick={vi.fn()}
        selectedOid={HASH}
      />
    );

    expect(screen.getByTestId("git-review-commit-combobox")).toHaveTextContent(
      SHORT
    );
    await waitFor(() => {
      expect(
        screen.getByTestId("git-review-commit-combobox")
      ).toHaveTextContent(SUBJECT);
    });
    expect(searchCommits).toHaveBeenCalledWith("/repo", {
      limit: 1,
      query: HASH,
    });
  });

  it("解析失败时保持短 hash 兜底", async () => {
    const searchCommits = vi.fn(async () => commitsResult([], "error"));
    render(
      <GitReviewCommitCombobox
        context={comboboxContext(searchCommits)}
        gitRootPath="/repo"
        onPick={vi.fn()}
        selectedOid={HASH}
      />
    );

    await waitFor(() => {
      expect(searchCommits).toHaveBeenCalled();
    });
    expect(screen.getByTestId("git-review-commit-combobox")).toHaveTextContent(
      SHORT
    );
    expect(
      screen.getByTestId("git-review-commit-combobox")
    ).not.toHaveTextContent(SUBJECT);
  });

  it("列表选中后立即展示 subject,不再发起解析请求", async () => {
    const listCommit = commitFixture({
      hash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      message: "fix(ui): clean file-tree list hover",
    });
    const searchCommits = vi.fn(
      async (_cwd: string, options?: { query?: string }) => {
        if (options?.query === "") {
          return commitsResult([listCommit]);
        }
        return commitsResult([]);
      }
    );
    const onPick = vi.fn();
    const { rerender } = render(
      <GitReviewCommitCombobox
        context={comboboxContext(searchCommits)}
        gitRootPath="/repo"
        onPick={onPick}
        selectedOid={null}
      />
    );

    fireEvent.click(screen.getByTestId("git-review-commit-combobox"));
    await waitFor(() => {
      expect(screen.getByText(listCommit.message)).toBeVisible();
    });
    fireEvent.click(screen.getByText(listCommit.message));
    expect(onPick).toHaveBeenCalledWith(listCommit);

    const resolveCallsBeforeRerender = searchCommits.mock.calls.filter(
      (call) => call[1]?.query === listCommit.hash
    ).length;

    rerender(
      <GitReviewCommitCombobox
        context={comboboxContext(searchCommits)}
        gitRootPath="/repo"
        onPick={onPick}
        selectedOid={listCommit.hash}
      />
    );

    expect(screen.getByTestId("git-review-commit-combobox")).toHaveTextContent(
      listCommit.message
    );
    await waitFor(() => {
      const resolveCalls = searchCommits.mock.calls.filter(
        (call) => call[1]?.query === listCommit.hash
      );
      expect(resolveCalls.length).toBe(resolveCallsBeforeRerender);
    });
  });

  it("未选中时展示占位文案", () => {
    render(
      <GitReviewCommitCombobox
        context={comboboxContext(async () => commitsResult([]))}
        gitRootPath="/repo"
        onPick={vi.fn()}
        selectedOid={null}
      />
    );
    expect(screen.getByTestId("git-review-commit-combobox")).toHaveTextContent(
      "Select a commit"
    );
  });
});

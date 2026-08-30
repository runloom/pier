import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  GitReviewCommitCombobox,
  GitReviewCommitPickerSession,
} from "@plugins/builtin/git/renderer/review/scope/comboboxes.tsx";
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
  it("外部只给 oid 时先短 hash 兜底，解析后改显示标题，不用原生 title", async () => {
    const searchCommits = vi.fn(async () => commitsResult([commitFixture()]));
    render(
      <GitReviewCommitCombobox
        context={comboboxContext(searchCommits)}
        gitRootPath="/repo"
        onSelectTarget={vi.fn()}
        selectedOid={HASH}
      />
    );

    const trigger = screen.getByTestId("git-review-commit-combobox");
    expect(
      trigger.querySelector("[data-slot='combobox-trigger-label']")
    ).toHaveTextContent(SHORT);
    expect(trigger).not.toHaveAttribute("title");
    expect(trigger).toHaveAccessibleName(`Commit ${SHORT}`);
    await waitFor(() => {
      expect(
        trigger.querySelector("[data-slot='combobox-trigger-label']")
      ).toHaveTextContent(SUBJECT);
    });
    expect(trigger).toHaveAccessibleName(`Commit ${SHORT}: ${SUBJECT}`);
    expect(trigger).not.toHaveAttribute("title");
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
        onSelectTarget={vi.fn()}
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

  it("列表点一篇立刻单选并展示 subject,不再发起解析请求", async () => {
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
    const onSelectTarget = vi.fn();
    const { rerender } = render(
      <GitReviewCommitCombobox
        context={comboboxContext(searchCommits)}
        gitRootPath="/repo"
        onSelectTarget={onSelectTarget}
        selectedOid={null}
      />
    );

    fireEvent.click(screen.getByTestId("git-review-commit-combobox"));
    await waitFor(() => {
      expect(screen.getByText(listCommit.message)).toBeVisible();
    });
    fireEvent.click(screen.getByText(listCommit.message));
    expect(onSelectTarget).not.toHaveBeenCalled();
    expect(screen.getByTestId("git-review-commit-combobox")).toHaveAttribute(
      "aria-expanded",
      "true"
    );
    fireEvent.click(
      screen.getByTestId(`git-review-commit-checkbox-${listCommit.hash}`)
    );
    expect(onSelectTarget).toHaveBeenCalledWith({
      kind: "commit",
      oid: listCommit.hash,
    });
    expect(screen.getByTestId("git-review-commit-combobox")).toHaveAttribute(
      "aria-expanded",
      "true"
    );

    const resolveCallsBeforeRerender = searchCommits.mock.calls.filter(
      (call) => call[1]?.query === listCommit.hash
    ).length;

    rerender(
      <GitReviewCommitCombobox
        context={comboboxContext(searchCommits)}
        gitRootPath="/repo"
        onSelectTarget={onSelectTarget}
        selectedOid={listCommit.hash}
      />
    );

    const trigger = screen.getByTestId("git-review-commit-combobox");
    expect(
      trigger.querySelector("[data-slot='combobox-trigger-label']")
    ).toHaveTextContent(listCommit.message);
    expect(trigger).not.toHaveAttribute("title");
    await waitFor(() => {
      const resolveCalls = searchCommits.mock.calls.filter(
        (call) => call[1]?.query === listCommit.hash
      );
      expect(resolveCalls.length).toBe(resolveCallsBeforeRerender);
    });
  });

  it("范围触发器显示最新一篇标题，计数单独一块且不被截进标题", async () => {
    const newest = commitFixture({
      hash: "b".repeat(40),
      message: "feat: newest",
    });
    const oldest = commitFixture({
      hash: "a".repeat(40),
      message: "feat: oldest",
    });
    const searchCommits = vi.fn(async () => commitsResult([newest, oldest]));
    const onSelectTarget = vi.fn();
    const context = comboboxContext(searchCommits);
    const { rerender } = render(
      <GitReviewCommitCombobox
        context={context}
        gitRootPath="/repo"
        onSelectTarget={onSelectTarget}
        selectedOid={null}
      />
    );
    fireEvent.click(screen.getByTestId("git-review-commit-combobox"));
    await waitFor(() => {
      expect(screen.getByText(newest.message)).toBeVisible();
    });
    fireEvent.click(
      screen.getByTestId(`git-review-commit-checkbox-${newest.hash}`)
    );
    fireEvent.click(
      screen.getByTestId(`git-review-commit-checkbox-${oldest.hash}`)
    );
    rerender(
      <GitReviewCommitCombobox
        context={context}
        gitRootPath="/repo"
        onSelectTarget={onSelectTarget}
        selectedFromOid={oldest.hash}
        selectedOid={newest.hash}
      />
    );
    const trigger = screen.getByTestId("git-review-commit-combobox");
    expect(
      trigger.querySelector("[data-slot='combobox-trigger-label']")
    ).toHaveTextContent(newest.message);
    const trailing = trigger.querySelector(
      "[data-slot='combobox-trigger-trailing']"
    );
    expect(trailing).toHaveTextContent("2 commits");
    expect(trailing).toHaveClass("text-muted-foreground");
    expect(
      trigger.querySelector("[data-slot='combobox-trigger-label']")
    ).not.toHaveTextContent("2 commits");
    expect(trigger).not.toHaveAttribute("title");
    expect(trigger).toHaveAccessibleName(`2 commits: ${newest.message}`);
  });

  it("外部直接给范围时标题兜底短 hash，计数槽仍标出区间", () => {
    const fromOid = "a".repeat(40);
    const oid = "b".repeat(40);
    render(
      <GitReviewCommitCombobox
        context={comboboxContext(async () => commitsResult([]))}
        gitRootPath="/repo"
        onSelectTarget={vi.fn()}
        selectedFromOid={fromOid}
        selectedOid={oid}
      />
    );
    const trigger = screen.getByTestId("git-review-commit-combobox");
    expect(
      trigger.querySelector("[data-slot='combobox-trigger-label']")
    ).toHaveTextContent(oid.slice(0, 7));
    expect(
      trigger.querySelector("[data-slot='combobox-trigger-trailing']")
    ).toHaveTextContent(`${fromOid.slice(0, 7)}–${oid.slice(0, 7)}`);
    expect(trigger).toHaveAccessibleName(
      `Commits ${fromOid.slice(0, 7)} to ${oid.slice(0, 7)}`
    );
    expect(trigger).not.toHaveAttribute("title");
  });

  it("点两篇提交后选出 oldest^..newest 范围", async () => {
    const newest = commitFixture({
      hash: "b".repeat(40),
      message: "feat: newest",
    });
    const oldest = commitFixture({
      hash: "a".repeat(40),
      message: "feat: oldest",
    });
    const searchCommits = vi.fn(async () => commitsResult([newest, oldest]));
    const onSelectTarget = vi.fn();
    render(
      <GitReviewCommitCombobox
        context={comboboxContext(searchCommits)}
        gitRootPath="/repo"
        onSelectTarget={onSelectTarget}
        selectedOid={null}
      />
    );
    fireEvent.click(screen.getByTestId("git-review-commit-combobox"));
    await waitFor(() => {
      expect(screen.getByText(newest.message)).toBeVisible();
    });
    fireEvent.click(
      screen.getByTestId(`git-review-commit-checkbox-${newest.hash}`)
    );
    expect(onSelectTarget).toHaveBeenNthCalledWith(1, {
      kind: "commit",
      oid: newest.hash,
    });
    fireEvent.click(
      screen.getByTestId(`git-review-commit-checkbox-${oldest.hash}`)
    );
    expect(onSelectTarget).toHaveBeenNthCalledWith(2, {
      fromOid: oldest.hash,
      kind: "commit",
      oid: newest.hash,
    });
    expect(
      screen.getByTestId(`git-review-commit-checkbox-${newest.hash}`)
    ).toBeVisible();
    expect(screen.getByText(oldest.message)).toBeVisible();
    expect(screen.getByTestId("git-review-commit-combobox")).toHaveAttribute(
      "aria-expanded",
      "true"
    );
  });

  it("第三击以上一击为原点扩范围且保持列表打开", async () => {
    const newest = commitFixture({
      hash: "c".repeat(40),
      message: "feat: newest",
    });
    const middle = commitFixture({
      hash: "b".repeat(40),
      message: "feat: middle",
    });
    const oldest = commitFixture({
      hash: "a".repeat(40),
      message: "feat: oldest",
    });
    const searchCommits = vi.fn(async () =>
      commitsResult([newest, middle, oldest])
    );
    const onSelectTarget = vi.fn();
    render(
      <GitReviewCommitCombobox
        context={comboboxContext(searchCommits)}
        gitRootPath="/repo"
        onSelectTarget={onSelectTarget}
        selectedOid={null}
      />
    );
    fireEvent.click(screen.getByTestId("git-review-commit-combobox"));
    await waitFor(() => {
      expect(screen.getByText(newest.message)).toBeVisible();
    });
    fireEvent.click(
      screen.getByTestId(`git-review-commit-checkbox-${newest.hash}`)
    );
    fireEvent.click(
      screen.getByTestId(`git-review-commit-checkbox-${middle.hash}`)
    );
    fireEvent.click(
      screen.getByTestId(`git-review-commit-checkbox-${oldest.hash}`)
    );
    expect(onSelectTarget).toHaveBeenLastCalledWith({
      fromOid: oldest.hash,
      kind: "commit",
      oid: middle.hash,
    });
    expect(screen.getByText(oldest.message)).toBeVisible();
    expect(screen.getByTestId("git-review-commit-combobox")).toHaveAttribute(
      "aria-expanded",
      "true"
    );
  });

  it("悬停勾选框从原点画出范围，悬停标题不画", async () => {
    const newest = commitFixture({
      hash: "c".repeat(40),
      message: "feat: newest",
    });
    const middle = commitFixture({
      hash: "b".repeat(40),
      message: "feat: middle",
    });
    const oldest = commitFixture({
      hash: "a".repeat(40),
      message: "feat: oldest",
    });
    const searchCommits = vi.fn(async () =>
      commitsResult([newest, middle, oldest])
    );
    render(
      <GitReviewCommitCombobox
        context={comboboxContext(searchCommits)}
        gitRootPath="/repo"
        onSelectTarget={vi.fn()}
        selectedOid={null}
      />
    );
    fireEvent.click(screen.getByTestId("git-review-commit-combobox"));
    await waitFor(() => {
      expect(screen.getByText(newest.message)).toBeVisible();
    });
    fireEvent.click(
      screen.getByTestId(`git-review-commit-checkbox-${newest.hash}`)
    );
    fireEvent.mouseEnter(screen.getByText(oldest.message));
    expect(
      screen.getByTestId(`git-review-commit-checkbox-${middle.hash}`)
    ).not.toHaveAttribute("data-range-role");
    fireEvent.mouseEnter(
      screen.getByTestId(`git-review-commit-checkbox-${oldest.hash}`)
    );
    expect(
      screen.getByTestId(`git-review-commit-checkbox-${newest.hash}`)
    ).toHaveAttribute("data-range-role", "start");
    expect(
      screen.getByTestId(`git-review-commit-checkbox-${middle.hash}`)
    ).toHaveAttribute("data-range-role", "middle");
    expect(
      screen.getByTestId(`git-review-commit-checkbox-${oldest.hash}`)
    ).toHaveAttribute("data-range-role", "end");
    const startGutter = screen
      .getByTestId(`git-review-commit-checkbox-${newest.hash}`)
      .closest("[data-slot='commit-range-gutter']");
    const middleGutter = screen
      .getByTestId(`git-review-commit-checkbox-${middle.hash}`)
      .closest("[data-slot='commit-range-gutter']");
    const endGutter = screen
      .getByTestId(`git-review-commit-checkbox-${oldest.hash}`)
      .closest("[data-slot='commit-range-gutter']");
    expect(middleGutter).toHaveAttribute("data-range-marker", "dot");
    expect(middleGutter).toHaveAttribute("data-range-tone", "preview");
    expect(startGutter).toHaveAttribute("data-rail-top", "false");
    expect(startGutter).toHaveAttribute("data-rail-bottom", "true");
    expect(middleGutter).toHaveAttribute("data-rail-top", "true");
    expect(middleGutter).toHaveAttribute("data-rail-bottom", "true");
    expect(endGutter).toHaveAttribute("data-rail-top", "true");
    expect(endGutter).toHaveAttribute("data-rail-bottom", "false");
    fireEvent.mouseEnter(
      screen.getByTestId(`git-review-commit-checkbox-${middle.hash}`)
    );
    expect(
      screen
        .getByTestId(`git-review-commit-checkbox-${middle.hash}`)
        .closest("[data-slot='commit-range-gutter']")
    ).toHaveAttribute("data-range-marker", "checkbox");
    expect(
      screen
        .getByTestId(`git-review-commit-checkbox-${middle.hash}`)
        .closest("[data-slot='commit-range-gutter']")
        ?.querySelector("[data-slot='checkbox']")
    ).toHaveClass("bg-muted-foreground");
    expect(
      screen
        .getByTestId(`git-review-commit-checkbox-${newest.hash}`)
        .closest("[data-slot='commit-picker-row']")?.className
    ).not.toContain("bg-accent");
    expect(
      screen.getByTestId(`git-review-commit-checkbox-${newest.hash}`)
    ).not.toHaveAttribute("title");
  });

  it("触发器重挂后弹层仍开且上一勾仍是原点", async () => {
    const newest = commitFixture({
      hash: "b".repeat(40),
      message: "feat: newest",
    });
    const oldest = commitFixture({
      hash: "a".repeat(40),
      message: "feat: oldest",
    });
    const searchCommits = vi.fn(async () => commitsResult([newest, oldest]));
    const onSelectTarget = vi.fn();
    const context = comboboxContext(searchCommits);
    function Harness({
      selectedOid,
      triggerKey,
    }: {
      readonly selectedOid: string | null;
      readonly triggerKey: string;
    }) {
      return (
        <GitReviewCommitPickerSession
          context={context}
          enabled
          gitRootPath="/repo"
          onSelectTarget={onSelectTarget}
          selectedOid={selectedOid}
        >
          <GitReviewCommitCombobox
            context={context}
            gitRootPath="/repo"
            key={triggerKey}
            onSelectTarget={onSelectTarget}
            selectedOid={selectedOid}
          />
        </GitReviewCommitPickerSession>
      );
    }
    const { rerender } = render(
      <Harness selectedOid={null} triggerKey="one" />
    );
    fireEvent.click(screen.getByTestId("git-review-commit-combobox"));
    await waitFor(() => {
      expect(screen.getByText(newest.message)).toBeVisible();
    });
    fireEvent.click(
      screen.getByTestId(`git-review-commit-checkbox-${newest.hash}`)
    );
    rerender(<Harness selectedOid={newest.hash} triggerKey="two" />);
    expect(screen.getByTestId("git-review-commit-combobox")).toHaveAttribute(
      "aria-expanded",
      "true"
    );
    expect(screen.getByText(oldest.message)).toBeVisible();
    fireEvent.click(
      screen.getByTestId(`git-review-commit-checkbox-${oldest.hash}`)
    );
    expect(onSelectTarget).toHaveBeenLastCalledWith({
      fromOid: oldest.hash,
      kind: "commit",
      oid: newest.hash,
    });
  });

  it("方向键高亮后回车与勾选同一篇", async () => {
    const newest = commitFixture({
      hash: "c".repeat(40),
      message: "feat: newest",
    });
    const middle = commitFixture({
      hash: "b".repeat(40),
      message: "feat: middle",
    });
    const oldest = commitFixture({
      hash: "a".repeat(40),
      message: "feat: oldest",
    });
    const searchCommits = vi.fn(async () =>
      commitsResult([newest, middle, oldest])
    );
    const onSelectTarget = vi.fn();
    render(
      <GitReviewCommitCombobox
        context={comboboxContext(searchCommits)}
        gitRootPath="/repo"
        onSelectTarget={onSelectTarget}
        selectedOid={null}
      />
    );
    fireEvent.click(screen.getByTestId("git-review-commit-combobox"));
    await waitFor(() => {
      expect(screen.getByText(newest.message)).toBeVisible();
    });
    fireEvent.click(
      screen.getByTestId(`git-review-commit-checkbox-${newest.hash}`)
    );
    const search = screen.getByPlaceholderText(
      "Search: text, #hash, @author, :path"
    );
    fireEvent.keyDown(search, { key: "ArrowDown" });
    const highlightedRow = screen
      .getByTestId(`git-review-commit-checkbox-${middle.hash}`)
      .closest("[data-slot='commit-picker-row']");
    expect(highlightedRow).toHaveAttribute("data-highlighted", "true");
    expect(highlightedRow).not.toHaveClass("ring-1");
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onSelectTarget).toHaveBeenLastCalledWith({
      fromOid: middle.hash,
      kind: "commit",
      oid: newest.hash,
    });
    expect(screen.getByTestId("git-review-commit-combobox")).toHaveAttribute(
      "aria-expanded",
      "true"
    );
  });

  it("关掉再开仍以上一勾为原点", async () => {
    const newest = commitFixture({
      hash: "b".repeat(40),
      message: "feat: newest",
    });
    const oldest = commitFixture({
      hash: "a".repeat(40),
      message: "feat: oldest",
    });
    const searchCommits = vi.fn(async () => commitsResult([newest, oldest]));
    const onSelectTarget = vi.fn();
    render(
      <GitReviewCommitCombobox
        context={comboboxContext(searchCommits)}
        gitRootPath="/repo"
        onSelectTarget={onSelectTarget}
        selectedOid={null}
      />
    );
    fireEvent.click(screen.getByTestId("git-review-commit-combobox"));
    await waitFor(() => {
      expect(screen.getByText(newest.message)).toBeVisible();
    });
    fireEvent.click(
      screen.getByTestId(`git-review-commit-checkbox-${newest.hash}`)
    );
    fireEvent.click(screen.getByTestId("git-review-commit-combobox"));
    expect(screen.getByTestId("git-review-commit-combobox")).toHaveAttribute(
      "aria-expanded",
      "false"
    );
    fireEvent.click(screen.getByTestId("git-review-commit-combobox"));
    await waitFor(() => {
      expect(screen.getByText(oldest.message)).toBeVisible();
    });
    fireEvent.click(
      screen.getByTestId(`git-review-commit-checkbox-${oldest.hash}`)
    );
    expect(onSelectTarget).toHaveBeenLastCalledWith({
      fromOid: oldest.hash,
      kind: "commit",
      oid: newest.hash,
    });
  });

  it("未选中时展示占位文案", () => {
    render(
      <GitReviewCommitCombobox
        context={comboboxContext(async () => commitsResult([]))}
        gitRootPath="/repo"
        onSelectTarget={vi.fn()}
        selectedOid={null}
      />
    );
    expect(screen.getByTestId("git-review-commit-combobox")).toHaveTextContent(
      "Select a commit"
    );
  });

  it("勾选走 aria-selected，沟槽不是嵌套 button", async () => {
    const newest = commitFixture({
      hash: "b".repeat(40),
      message: "feat: newest",
    });
    const oldest = commitFixture({
      hash: "a".repeat(40),
      message: "feat: oldest",
    });
    render(
      <GitReviewCommitCombobox
        context={comboboxContext(async () => commitsResult([newest, oldest]))}
        gitRootPath="/repo"
        onSelectTarget={vi.fn()}
        selectedOid={null}
      />
    );
    fireEvent.click(screen.getByTestId("git-review-commit-combobox"));
    await waitFor(() => {
      expect(screen.getByText(newest.message)).toBeVisible();
    });
    const newestHit = screen.getByTestId(
      `git-review-commit-checkbox-${newest.hash}`
    );
    expect(newestHit.tagName).toBe("SPAN");
    expect(
      newestHit
        .closest("[data-slot='commit-range-gutter']")
        ?.querySelector("[data-slot='checkbox']")?.tagName
    ).toBe("SPAN");
    fireEvent.click(newestHit);
    expect(
      newestHit.closest("[data-slot='commit-picker-row']")
    ).toHaveAttribute("aria-selected", "true");
    expect(
      screen
        .getByTestId(`git-review-commit-checkbox-${oldest.hash}`)
        .closest("[data-slot='commit-picker-row']")
    ).toHaveAttribute("aria-selected", "false");
  });

  it("Esc 关闭后焦点回到触发器", async () => {
    const newest = commitFixture();
    render(
      <GitReviewCommitCombobox
        context={comboboxContext(async () => commitsResult([newest]))}
        gitRootPath="/repo"
        onSelectTarget={vi.fn()}
        selectedOid={null}
      />
    );
    const trigger = screen.getByTestId("git-review-commit-combobox");
    fireEvent.click(trigger);
    await waitFor(() => {
      expect(screen.getByText(newest.message)).toBeVisible();
    });
    const search = screen.getByPlaceholderText(
      "Search: text, #hash, @author, :path"
    );
    search.focus();
    fireEvent.keyDown(search, { key: "Escape" });
    await waitFor(() => {
      expect(trigger).toHaveAttribute("aria-expanded", "false");
    });
    expect(trigger).toHaveFocus();
  });

  it("搜索把原点滤掉后再勾另一篇仍扩成范围", async () => {
    const newest = commitFixture({
      hash: "b".repeat(40),
      message: "feat: newest",
    });
    const oldest = commitFixture({
      hash: "a".repeat(40),
      message: "feat: oldest-only",
    });
    const searchCommits = vi.fn(
      async (_cwd: string, options?: { query?: string }) => {
        if (options?.query === "oldest-only") {
          return commitsResult([oldest]);
        }
        return commitsResult([newest, oldest]);
      }
    );
    const onSelectTarget = vi.fn();
    render(
      <GitReviewCommitCombobox
        context={comboboxContext(searchCommits)}
        gitRootPath="/repo"
        onSelectTarget={onSelectTarget}
        selectedOid={null}
      />
    );
    fireEvent.click(screen.getByTestId("git-review-commit-combobox"));
    await waitFor(() => {
      expect(screen.getByText(newest.message)).toBeVisible();
    });
    fireEvent.click(
      screen.getByTestId(`git-review-commit-checkbox-${newest.hash}`)
    );
    const search = screen.getByPlaceholderText(
      "Search: text, #hash, @author, :path"
    );
    fireEvent.change(search, { target: { value: "oldest-only" } });
    await waitFor(() => {
      expect(
        screen.queryByTestId(`git-review-commit-checkbox-${newest.hash}`)
      ).toBeNull();
      expect(
        screen.getByTestId(`git-review-commit-checkbox-${oldest.hash}`)
      ).toBeVisible();
    });
    fireEvent.click(
      screen.getByTestId(`git-review-commit-checkbox-${oldest.hash}`)
    );
    expect(onSelectTarget).toHaveBeenLastCalledWith({
      fromOid: oldest.hash,
      kind: "commit",
      oid: newest.hash,
    });
  });
});

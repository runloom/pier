import { GitChangesPanel } from "@plugins/builtin/git/renderer/git-changes-panel.tsx";
import type {
  GitChangeEvent,
  GitDiffPatch,
  GitStatus,
} from "@shared/contracts/git.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { IDockviewPanelProps } from "dockview-react";
import { describe, expect, it, vi } from "vitest";

const GIT_ROOT = "/workspace/pier";
const APP_FILE_PATTERN = /App\.tsx/;
const NEW_NAME_FILE_PATTERN = /NewName\.tsx/;
const LOGO_FILE_PATTERN = /logo\.png/;
const TODO_FILE_PATTERN = /todo\.md/;

const activePanelContext: PanelContext = {
  branch: "main",
  contextId: "ctx-pier",
  cwd: `${GIT_ROOT}/packages/app`,
  gitRoot: GIT_ROOT,
  openedPath: `${GIT_ROOT}/packages/app`,
  projectRootPath: GIT_ROOT,
  source: "panel",
  updatedAt: 1_772_000_000_000,
  worktreeKey: GIT_ROOT,
  worktreeRoot: GIT_ROOT,
};

interface GitPanelApi {
  getDiffPatch(
    root: string,
    options: { path: string; staged?: boolean }
  ): Promise<GitDiffPatch>;
  getStatus(root: string): Promise<GitStatus>;
  watch?(root: string, listener: (event: GitChangeEvent) => void): () => void;
}

interface GitChangesPanelTestParams {
  context: PanelContext;
  git?: GitPanelApi;
  heading?: string;
  hint?: string;
}

function makeStatus(files: GitStatus["files"]): GitStatus {
  return {
    branch: {
      ahead: 0,
      behind: 0,
      branch: "main",
      oid: "abc123",
      mergedIntoDefault: null,
      upstream: null,
      upstreamGone: false,
    },
    counts: { conflict: 0, modified: files.length, staged: 0, untracked: 0 },
    delta: { deletions: 1, insertions: 2 },
    files,
    remoteSync: null,
    repoState: { kind: "clean" },
    stashCount: 0,
  };
}

function makeProps(
  params: GitChangesPanelTestParams
): IDockviewPanelProps<{ heading?: string; hint?: string }> {
  return {
    api: { id: "pier.git.changes", setTitle: vi.fn() },
    containerApi: {},
    params,
  } as unknown as IDockviewPanelProps<{ heading?: string; hint?: string }>;
}

function makePatch(files: GitDiffPatch["files"]): GitDiffPatch {
  return { files };
}

async function findFileTree(container: HTMLElement): Promise<HTMLElement> {
  await waitFor(() => {
    expect(
      container
        .querySelector('file-tree-container[data-slot="pier-file-tree"]')
        ?.shadowRoot?.querySelector('[role="tree"]')
    ).toBeInstanceOf(HTMLElement);
  });
  const tree = container
    .querySelector('file-tree-container[data-slot="pier-file-tree"]')
    ?.shadowRoot?.querySelector('[role="tree"]');
  return tree as HTMLElement;
}

async function renderAndOpen(
  git: GitPanelApi,
  fileName: RegExp
): Promise<HTMLElement> {
  const { container } = render(
    <GitChangesPanel {...makeProps({ context: activePanelContext, git })} />
  );
  const tree = within(await findFileTree(container));
  fireEvent.click(await tree.findByRole("treeitem", { name: fileName }));
  return container;
}

describe("GitChangesPanel diff preview", () => {
  it("shows the select-file empty state in the diff pane before any file is opened", async () => {
    const git: GitPanelApi = {
      getDiffPatch: vi.fn(async () => makePatch([])),
      getStatus: vi.fn(async () =>
        makeStatus([
          { index: ".", origPath: null, path: "src/App.tsx", worktree: "M" },
        ])
      ),
    };

    const { container } = render(
      <GitChangesPanel {...makeProps({ context: activePanelContext, git })} />
    );

    await findFileTree(container);
    expect(
      screen.getByText("Select a file to preview its changes")
    ).toBeVisible();
    expect(git.getDiffPatch).not.toHaveBeenCalled();
  });

  it("renders hunk headers with add/del lines after a file is opened", async () => {
    const git: GitPanelApi = {
      getDiffPatch: vi.fn(async () =>
        makePatch([
          {
            binary: false,
            hunks: [
              {
                lines: [
                  { kind: "context", text: "const kept = 0;" },
                  { kind: "del", text: "const removed = 1;" },
                  { kind: "add", text: "const added = 2;" },
                ],
                newLines: 2,
                newStart: 1,
                oldLines: 2,
                oldStart: 1,
              },
            ],
            oldPath: null,
            path: "src/App.tsx",
          },
        ])
      ),
      getStatus: vi.fn(async () =>
        makeStatus([
          { index: ".", origPath: null, path: "src/App.tsx", worktree: "M" },
        ])
      ),
    };

    await renderAndOpen(git, APP_FILE_PATTERN);

    const addLine = await screen.findByText("+const added = 2;");
    expect(addLine).toBeVisible();
    expect(addLine).toHaveAttribute("data-diff-line", "add");
    const delLine = screen.getByText("-const removed = 1;");
    expect(delLine).toBeVisible();
    expect(delLine).toHaveAttribute("data-diff-line", "del");
    const contextLine = screen.getByText("const kept = 0;", { exact: false });
    expect(contextLine).toHaveAttribute("data-diff-line", "context");
    expect(screen.getByText("@@ -1,2 +1,2 @@")).toBeVisible();
    expect(git.getDiffPatch).toHaveBeenCalledWith(GIT_ROOT, {
      path: "src/App.tsx",
    });
  });

  it("labels a renamed file patch resolved through oldPath with both paths", async () => {
    const git: GitPanelApi = {
      getDiffPatch: vi.fn(async () =>
        makePatch([
          {
            binary: false,
            hunks: [
              {
                lines: [{ kind: "add", text: "renamed content" }],
                newLines: 1,
                newStart: 1,
                oldLines: 0,
                oldStart: 0,
              },
            ],
            oldPath: "src/OldName.tsx",
            path: "src/NewName.tsx",
          },
        ])
      ),
      getStatus: vi.fn(async () =>
        makeStatus([
          {
            index: "R",
            origPath: "src/OldName.tsx",
            path: "src/NewName.tsx",
            worktree: ".",
          },
        ])
      ),
    };

    await renderAndOpen(git, NEW_NAME_FILE_PATTERN);

    expect(
      await screen.findByText("src/OldName.tsx → src/NewName.tsx")
    ).toBeVisible();
    expect(screen.getByText("+renamed content")).toBeVisible();
  });

  it("renders a destructive alert without an unhandled rejection when the diff request fails", async () => {
    const onUnhandledRejection = vi.fn();
    process.on("unhandledRejection", onUnhandledRejection);
    const git: GitPanelApi = {
      getDiffPatch: vi.fn(() =>
        Promise.reject<GitDiffPatch>(new Error("diff backend exploded"))
      ),
      getStatus: vi.fn(async () =>
        makeStatus([
          { index: ".", origPath: null, path: "src/App.tsx", worktree: "M" },
        ])
      ),
    };

    try {
      await renderAndOpen(git, APP_FILE_PATTERN);

      const alert = await screen.findByRole("alert");
      expect(within(alert).getByText("Unable to load diff")).toBeVisible();
      expect(within(alert).getByText("diff backend exploded")).toBeVisible();

      // unhandledRejection 在微任务清空后的下一个宏任务才发射,等一拍再断言。
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await act(async () => {
        await promise;
      });
      expect(onUnhandledRejection).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }
  });

  it("shows the binary notice for a binary file patch", async () => {
    const git: GitPanelApi = {
      getDiffPatch: vi.fn(async () =>
        makePatch([
          { binary: true, hunks: [], oldPath: null, path: "assets/logo.png" },
        ])
      ),
      getStatus: vi.fn(async () =>
        makeStatus([
          {
            index: ".",
            origPath: null,
            path: "assets/logo.png",
            worktree: "M",
          },
        ])
      ),
    };

    await renderAndOpen(git, LOGO_FILE_PATTERN);

    expect(
      await screen.findByText("Binary file cannot be previewed")
    ).toBeVisible();
  });

  it("shows the no-changes notice when the patch does not contain the opened file", async () => {
    const git: GitPanelApi = {
      getDiffPatch: vi.fn(async () => makePatch([])),
      getStatus: vi.fn(async () =>
        makeStatus([
          { index: "?", origPath: null, path: "notes/todo.md", worktree: "?" },
        ])
      ),
    };

    await renderAndOpen(git, TODO_FILE_PATTERN);

    expect(await screen.findByText("No changes to display")).toBeVisible();
  });

  it("refetches the diff after a watch refresh keeps the selected file, and clears the selection once it disappears", async () => {
    let watchListener: ((event: GitChangeEvent) => void) | undefined;
    const selectedStatus = makeStatus([
      { index: ".", origPath: null, path: "src/App.tsx", worktree: "M" },
    ]);
    const git: GitPanelApi = {
      getDiffPatch: vi.fn(async () =>
        makePatch([
          {
            binary: false,
            hunks: [
              {
                lines: [{ kind: "add", text: "const added = 2;" }],
                newLines: 1,
                newStart: 1,
                oldLines: 0,
                oldStart: 0,
              },
            ],
            oldPath: null,
            path: "src/App.tsx",
          },
        ])
      ),
      getStatus: vi.fn(async () => selectedStatus),
      watch: vi.fn((_root, listener) => {
        watchListener = listener;
        return vi.fn();
      }),
    };

    await renderAndOpen(git, APP_FILE_PATTERN);
    expect(await screen.findByText("+const added = 2;")).toBeVisible();
    expect(git.getDiffPatch).toHaveBeenCalledTimes(1);
    expect(watchListener).toBeDefined();

    // 选中文件仍在刷新后的列表里 → 重拉 diff。
    act(() => {
      watchListener?.({
        changeKind: "worktree",
        gitRoot: GIT_ROOT,
        status: makeStatus([
          { index: "M", origPath: null, path: "src/App.tsx", worktree: "M" },
        ]),
      });
    });
    await waitFor(() => {
      expect(git.getDiffPatch).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText("+const added = 2;")).toBeVisible();

    // 选中文件从列表消失 → 清选中,回到空态提示。
    act(() => {
      watchListener?.({
        changeKind: "worktree",
        gitRoot: GIT_ROOT,
        status: makeStatus([
          { index: ".", origPath: null, path: "src/Other.tsx", worktree: "M" },
        ]),
      });
    });
    expect(
      await screen.findByText("Select a file to preview its changes")
    ).toBeVisible();
    expect(screen.queryByText("+const added = 2;")).toBeNull();
    expect(git.getDiffPatch).toHaveBeenCalledTimes(2);
  });
});

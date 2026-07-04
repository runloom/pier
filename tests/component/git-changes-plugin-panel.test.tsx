import type {
  PluginPanelRegistration,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import { GitChangesPanel } from "@plugins/builtin/git/renderer/git-changes-panel.tsx";
import { registerGitPluginContributions } from "@plugins/builtin/git/renderer/index.ts";
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

const APP_PATH_BUTTON_PATTERN = fileNamePattern("src/App.tsx");
const STAGED_ONLY_PATH_BUTTON_PATTERN = fileNamePattern("src/StagedOnly.tsx");
const README_PATH_BUTTON_PATTERN = fileNamePattern("README.md");
const OLD_ROOT_PATH_BUTTON_PATTERN = fileNamePattern("src/OldRoot.tsx");
const STALE_AFTER_WATCH_BUTTON_PATTERN = fileNamePattern(
  "src/StaleAfterWatch.tsx"
);
const SUPERSEDED_SAME_ROOT_BUTTON_PATTERN = fileNamePattern(
  "src/SupersededSameRoot.tsx"
);
const FROM_WATCH_PATH_BUTTON_PATTERN = fileNamePattern("src/FromWatch.tsx");
const RESTORED_PANEL_PATH_BUTTON_PATTERN = fileNamePattern(
  "src/RestoredPanel.tsx"
);
const PENDING_GIT_STATUS = new Promise<GitStatus>(() => {
  // Intentionally never resolves: keeps the next-root loading state pending.
});

const activePanelContext: PanelContext = {
  branch: "main",
  contextId: "ctx-pier",
  cwd: "/workspace/pier/packages/app",
  gitRoot: "/workspace/pier",
  openedPath: "/workspace/pier/packages/app",
  projectRootPath: "/workspace/pier",
  source: "panel",
  updatedAt: 1_772_000_000_000,
  worktreeKey: "/workspace/pier",
  worktreeRoot: "/workspace/pier",
};

interface GitPanelApi {
  getDiffPatch(
    root: string,
    options: { path: string; staged?: boolean }
  ): Promise<GitDiffPatch>;
  getFileContent(root: string, options: { path: string }): Promise<string>;
  getStatus(root: string): Promise<GitStatus>;
  watch?(root: string, listener: (event: GitChangeEvent) => void): () => void;
}

interface GitChangesPanelTestParams {
  context: PanelContext;
  git?: GitPanelApi;
  heading?: string;
  hint?: string;
}

function fileNamePattern(path: string): RegExp {
  const fileName = path.split("/").at(-1) ?? path;

  return new RegExp(fileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

function getFileTreeHost(container: HTMLElement): HTMLElement {
  const host = container.querySelector(
    'file-tree-container[data-slot="pier-file-tree"]'
  );

  expect(host).toBeInstanceOf(HTMLElement);
  return host as HTMLElement;
}

function getFileTree(container: HTMLElement): HTMLElement {
  const tree =
    getFileTreeHost(container).shadowRoot?.querySelector('[role="tree"]');

  expect(tree).toBeInstanceOf(HTMLElement);
  return tree as HTMLElement;
}

async function findFileTree(container: HTMLElement): Promise<HTMLElement> {
  await waitFor(() => {
    expect(
      getFileTreeHost(container).shadowRoot?.querySelector('[role="tree"]')
    ).toBeInstanceOf(HTMLElement);
  });

  return getFileTree(container);
}

function queryFileTreeRow(
  container: HTMLElement,
  name: RegExp
): HTMLElement | null {
  const host = container.querySelector(
    'file-tree-container[data-slot="pier-file-tree"]'
  );
  const tree = host?.shadowRoot?.querySelector('[role="tree"]');

  if (!(tree instanceof HTMLElement)) {
    return null;
  }

  return within(tree).queryByRole("treeitem", { name });
}

function queryFileTreeText(
  container: HTMLElement,
  text: RegExp
): HTMLElement | null {
  const host = container.querySelector(
    'file-tree-container[data-slot="pier-file-tree"]'
  );
  const tree = host?.shadowRoot?.querySelector('[role="tree"]');

  if (!(tree instanceof HTMLElement)) {
    return null;
  }

  return within(tree).queryByText(text);
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
    counts: { conflict: 0, modified: files.length, staged: 1, untracked: 1 },
    delta: { deletions: 2, insertions: 5 },
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

function makeRendererPluginContext(git: GitPanelApi): {
  context: RendererPluginContext;
  registeredPanels: PluginPanelRegistration[];
} {
  const registeredPanels: PluginPanelRegistration[] = [];
  const context = {
    actions: { register: vi.fn(() => vi.fn()) },
    git,
    i18n: {
      commandDescription: vi.fn(() => undefined),
      commandTitle: vi.fn((_commandId: string, fallback?: string) => fallback),
      language: vi.fn(() => "en"),
      t: vi.fn(
        (
          _key: string,
          _values?: Record<string, number | string>,
          fallback?: string
        ) => fallback ?? _key
      ),
    },
    panels: {
      getActiveContext: vi.fn(() => activePanelContext),
      open: vi.fn(),
      register: vi.fn((registration: PluginPanelRegistration) => {
        registeredPanels.push(registration);
        return vi.fn();
      }),
    },
    terminalStatusItems: { register: vi.fn(() => vi.fn()) },
  } as unknown as RendererPluginContext;

  return { context, registeredPanels };
}

describe("GitChangesPanel (plugin)", () => {
  it("renders the active Git context status as a file tree instead of placeholder copy", async () => {
    const git: GitPanelApi = {
      getDiffPatch: vi.fn(async () => ({ files: [] })),
      getFileContent: vi.fn(async () => ""),
      getStatus: vi.fn(async () =>
        makeStatus([
          { index: ".", origPath: null, path: "src/App.tsx", worktree: "M" },
          { index: "A", origPath: null, path: "README.md", worktree: "." },
        ])
      ),
    };

    const { container } = render(
      <GitChangesPanel {...makeProps({ context: activePanelContext, git })} />
    );

    await waitFor(() => {
      expect(git.getStatus).toHaveBeenCalledWith("/workspace/pier");
    });

    const tree = within(await findFileTree(container));
    expect(screen.queryByText("Change preview coming soon")).toBeNull();
    expect(
      tree.getByRole("treeitem", { name: APP_PATH_BUTTON_PATTERN })
    ).toBeVisible();
    expect(
      tree.getByRole("treeitem", { name: README_PATH_BUTTON_PATTERN })
    ).toBeVisible();
  });

  it("renders an explicit Git status load failure instead of the generic empty hint", async () => {
    const emptyHint = "No changes in this worktree";
    const git: GitPanelApi = {
      getDiffPatch: vi.fn(async () => ({ files: [] })),
      getFileContent: vi.fn(async () => ""),
      getStatus: vi.fn().mockRejectedValue(new Error("git status unavailable")),
    };

    render(
      <GitChangesPanel
        {...makeProps({ context: activePanelContext, git, hint: emptyHint })}
      />
    );

    await waitFor(() => {
      expect(git.getStatus).toHaveBeenCalledWith("/workspace/pier");
    });
    expect(await screen.findByText("Unable to load Git changes")).toBeVisible();
    expect(screen.queryByText(emptyHint)).toBeNull();
  });

  it("loads restored registered Git Changes panels from the runtime Git API when params omit git", async () => {
    const git: GitPanelApi = {
      getDiffPatch: vi.fn(async () => ({ files: [] })),
      getFileContent: vi.fn(async () => ""),
      getStatus: vi.fn(async () =>
        makeStatus([
          {
            index: ".",
            origPath: null,
            path: "src/RestoredPanel.tsx",
            worktree: "M",
          },
        ])
      ),
      watch: vi.fn(() => vi.fn()),
    };
    const { context, registeredPanels } = makeRendererPluginContext(git);

    registerGitPluginContributions(context);
    const registeredPanel = registeredPanels.find(
      (registration) => registration.id === "pier.git.changes"
    );
    expect(registeredPanel).toBeDefined();

    const RegisteredGitChangesPanel = registeredPanel?.component;
    if (!RegisteredGitChangesPanel) {
      throw new Error("Git Changes panel was not registered");
    }

    const { container } = render(
      <RegisteredGitChangesPanel
        {...makeProps({ context: activePanelContext })}
      />
    );

    await waitFor(() => {
      expect(git.getStatus).toHaveBeenCalledWith("/workspace/pier");
    });
    expect(git.watch).toHaveBeenCalledWith(
      "/workspace/pier",
      expect.any(Function)
    );

    const tree = within(await findFileTree(container));
    expect(
      tree.getByRole("treeitem", { name: RESTORED_PANEL_PATH_BUTTON_PATTERN })
    ).toBeVisible();
  });

  it("renders the changes tree as a flex child while leaving scrollbars to @pierre/trees", async () => {
    const git: GitPanelApi = {
      getDiffPatch: vi.fn(async () => ({ files: [] })),
      getFileContent: vi.fn(async () => ""),
      getStatus: vi.fn(async () =>
        makeStatus([
          { index: ".", origPath: null, path: "src/App.tsx", worktree: "M" },
        ])
      ),
    };

    const { container } = render(
      <GitChangesPanel {...makeProps({ context: activePanelContext, git })} />
    );

    const tree = within(await findFileTree(container));
    expect(
      await tree.findByRole("treeitem", { name: APP_PATH_BUTTON_PATTERN })
    ).toBeVisible();
    const treeHost = getFileTreeHost(container);
    expect(treeHost).toHaveClass("min-h-0", "flex-1", "w-full");
    expect(treeHost).not.toHaveClass("overflow-auto");
    expect(
      treeHost.shadowRoot?.querySelector(
        '[data-file-tree-virtualized-scroll="true"]'
      )
    ).toBeInstanceOf(HTMLElement);
  });

  it("uses @pierre/trees built-in Git status lane and activates a changed file through the diff/content path", async () => {
    const git: GitPanelApi = {
      getDiffPatch: vi.fn(async () => ({ files: [] })),
      getFileContent: vi.fn(async () => "export function App() {}"),
      getStatus: vi.fn(async () =>
        makeStatus([
          { index: "M", origPath: null, path: "src/App.tsx", worktree: "." },
          { index: "?", origPath: null, path: "notes/todo.md", worktree: "?" },
        ])
      ),
    };

    const { container } = render(
      <GitChangesPanel {...makeProps({ context: activePanelContext, git })} />
    );

    const tree = within(await findFileTree(container));
    const appRow = await tree.findByRole("treeitem", {
      name: APP_PATH_BUTTON_PATTERN,
    });
    expect(appRow).toHaveAttribute("data-item-git-status", "modified");
    const appGitLane = appRow.querySelector('[data-item-section="git"]');
    expect(appGitLane).toBeInstanceOf(HTMLElement);
    expect(within(appGitLane as HTMLElement).getByText("M")).toBeVisible();
    expect(
      appRow.querySelector('[data-item-section="decoration"]')?.textContent ??
        ""
    ).not.toContain("M");

    const untrackedRow = await tree.findByRole("treeitem", {
      name: fileNamePattern("notes/todo.md"),
    });
    expect(untrackedRow).toHaveAttribute("data-item-git-status", "untracked");
    const untrackedGitLane = untrackedRow.querySelector(
      '[data-item-section="git"]'
    );
    expect(untrackedGitLane).toBeInstanceOf(HTMLElement);
    expect(
      within(untrackedGitLane as HTMLElement).getByText("U")
    ).toBeVisible();

    fireEvent.click(appRow);

    await waitFor(() => {
      expect(git.getDiffPatch).toHaveBeenCalledWith("/workspace/pier", {
        path: "src/App.tsx",
        staged: true,
      });
    });
    expect(git.getFileContent).toHaveBeenCalledWith("/workspace/pier", {
      path: "src/App.tsx",
    });
  });

  it("opens a staged-only modified file through the staged diff path", async () => {
    const git: GitPanelApi = {
      getDiffPatch: vi.fn(async () => ({ files: [] })),
      getFileContent: vi.fn(async () => "HEAD content"),
      getStatus: vi.fn(async () =>
        makeStatus([
          {
            index: "M",
            origPath: null,
            path: "src/StagedOnly.tsx",
            worktree: ".",
          },
        ])
      ),
    };

    const { container } = render(
      <GitChangesPanel {...makeProps({ context: activePanelContext, git })} />
    );

    const tree = within(await findFileTree(container));
    fireEvent.click(
      await tree.findByRole("treeitem", {
        name: STAGED_ONLY_PATH_BUTTON_PATTERN,
      })
    );

    await waitFor(() => {
      expect(git.getDiffPatch).toHaveBeenCalledTimes(1);
    });
    expect(git.getDiffPatch).toHaveBeenCalledWith("/workspace/pier", {
      path: "src/StagedOnly.tsx",
      staged: true,
    });
  });

  it.each([
    {
      label: "staged renamed",
      newPath: "src/NewName.tsx",
      oldPath: "src/OldName.tsx",
      stagedDiff: true,
      status: {
        index: "R",
        origPath: "src/OldName.tsx",
        path: "src/NewName.tsx",
        worktree: ".",
      },
    },
    {
      label: "unstaged copied",
      newPath: "src/CopiedName.tsx",
      oldPath: "src/OriginalName.tsx",
      stagedDiff: false,
      status: {
        index: ".",
        origPath: "src/OriginalName.tsx",
        path: "src/CopiedName.tsx",
        worktree: "C",
      },
    },
  ] satisfies Array<{
    label: string;
    newPath: string;
    oldPath: string;
    stagedDiff: boolean;
    status: GitStatus["files"][number];
  }>)("loads HEAD content from the original path for a $label row", async ({
    newPath,
    oldPath,
    stagedDiff,
    status,
  }) => {
    const git: GitPanelApi = {
      getDiffPatch: vi.fn(async () => ({ files: [] })),
      getFileContent: vi.fn(async () => "old HEAD content"),
      getStatus: vi.fn(async () => makeStatus([status])),
    };

    const { container } = render(
      <GitChangesPanel {...makeProps({ context: activePanelContext, git })} />
    );

    const tree = within(await findFileTree(container));
    fireEvent.click(
      await tree.findByRole("treeitem", {
        name: fileNamePattern(newPath),
      })
    );

    await waitFor(() => {
      expect(git.getDiffPatch).toHaveBeenCalledWith("/workspace/pier", {
        path: newPath,
        ...(stagedDiff ? { staged: true } : {}),
      });
    });
    await waitFor(() => {
      expect(git.getFileContent).toHaveBeenCalledWith("/workspace/pier", {
        path: oldPath,
      });
    });
    expect(git.getFileContent).not.toHaveBeenCalledWith("/workspace/pier", {
      path: newPath,
    });
  });

  it.each([
    {
      label: "added",
      path: "src/NewFile.ts",
      stagedDiff: true,
      status: {
        index: "A",
        origPath: null,
        path: "src/NewFile.ts",
        worktree: ".",
      },
    },
    {
      label: "untracked",
      path: "notes/todo.md",
      stagedDiff: false,
      status: {
        index: "?",
        origPath: null,
        path: "notes/todo.md",
        worktree: "?",
      },
    },
  ] satisfies Array<{
    label: string;
    path: string;
    stagedDiff: boolean;
    status: GitStatus["files"][number];
  }>)("opens an $label file through the diff path without requesting HEAD content", async ({
    path,
    stagedDiff,
    status,
  }) => {
    const git: GitPanelApi = {
      getDiffPatch: vi.fn(async () => ({ files: [] })),
      getFileContent: vi.fn(async () => "HEAD content should not be loaded"),
      getStatus: vi.fn(async () => makeStatus([status])),
    };

    const { container } = render(
      <GitChangesPanel {...makeProps({ context: activePanelContext, git })} />
    );

    const tree = within(await findFileTree(container));
    fireEvent.click(
      await tree.findByRole("treeitem", {
        name: fileNamePattern(path),
      })
    );

    await waitFor(() => {
      expect(git.getDiffPatch).toHaveBeenCalledWith("/workspace/pier", {
        path,
        ...(stagedDiff ? { staged: true } : {}),
      });
    });
    expect(git.getFileContent).not.toHaveBeenCalled();
  });

  it("applies a watch event status snapshot without refetching the root status", async () => {
    let watchListener: ((event: GitChangeEvent) => void) | undefined;
    const activeRoot = "/workspace/pier";
    const getStatus = vi
      .fn<GitPanelApi["getStatus"]>()
      .mockResolvedValueOnce(makeStatus([]))
      .mockRejectedValue(new Error("status should not be refetched"));
    const git: GitPanelApi = {
      getDiffPatch: vi.fn(async () => ({ files: [] })),
      getFileContent: vi.fn(async () => "from watch content"),
      getStatus,
      watch: vi.fn((_root, listener) => {
        watchListener = listener;
        return vi.fn();
      }),
    };

    const { container } = render(
      <GitChangesPanel {...makeProps({ context: activePanelContext, git })} />
    );

    await waitFor(() => {
      expect(git.getStatus).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(watchListener).toBeDefined();
    });

    act(() => {
      watchListener?.({
        changeKind: "worktree",
        gitRoot: activeRoot,
        status: makeStatus([
          {
            index: ".",
            origPath: null,
            path: "src/FromWatch.tsx",
            worktree: "M",
          },
        ]),
      });
    });

    const tree = within(await findFileTree(container));
    expect(
      await tree.findByRole("treeitem", {
        name: FROM_WATCH_PATH_BUTTON_PATTERN,
      })
    ).toBeVisible();
    expect(git.getStatus).toHaveBeenCalledTimes(1);
  });

  it("clears stale rows when a watch-triggered status refresh fails", async () => {
    let watchListener: ((event: GitChangeEvent) => void) | undefined;
    const stalePath = "src/StaleAfterWatch.tsx";
    const activeGitRoot = "/workspace/pier";
    const initialStatus = makeStatus([
      { index: "M", origPath: null, path: stalePath, worktree: "." },
    ]);
    const getStatus = vi
      .fn<GitPanelApi["getStatus"]>()
      .mockResolvedValue(initialStatus);
    const git: GitPanelApi = {
      getDiffPatch: vi.fn(async () => ({ files: [] })),
      getFileContent: vi.fn(async () => "stale content"),
      getStatus,
      watch: vi.fn((_root, listener) => {
        watchListener = listener;
        return vi.fn();
      }),
    };

    const { container } = render(
      <GitChangesPanel {...makeProps({ context: activePanelContext, git })} />
    );

    const tree = within(await findFileTree(container));
    expect(
      await tree.findByRole("treeitem", {
        name: STALE_AFTER_WATCH_BUTTON_PATTERN,
      })
    ).toBeVisible();

    getStatus.mockRejectedValueOnce(
      new Error("status unavailable after watch")
    );
    expect(watchListener).toBeDefined();
    act(() => {
      watchListener?.({
        changeKind: "worktree",
        gitRoot: activeGitRoot,
      });
    });

    await waitFor(() => {
      expect(git.getStatus).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(
        queryFileTreeText(container, fileNamePattern(stalePath))
      ).toBeNull();
    });
    expect(
      queryFileTreeRow(container, STALE_AFTER_WATCH_BUTTON_PATTERN)
    ).toBeNull();
  });

  it("ignores an older same-root status result after a newer watch refresh fails", async () => {
    let watchListener: ((event: GitChangeEvent) => void) | undefined;
    let resolveInitialStatus!: (status: GitStatus) => void;
    let rejectWatchStatus!: (error: Error) => void;
    const stalePath = "src/SupersededSameRoot.tsx";
    const stalePathButtonPattern = SUPERSEDED_SAME_ROOT_BUTTON_PATTERN;
    const activeGitRoot = "/workspace/pier";
    const emptyHint = "No changes after failed refresh";
    const initialStatusPromise = new Promise<GitStatus>((resolve) => {
      resolveInitialStatus = resolve;
    });
    const watchStatusPromise = new Promise<GitStatus>((_resolve, reject) => {
      rejectWatchStatus = reject;
    });
    const git: GitPanelApi = {
      getDiffPatch: vi.fn(async () => ({ files: [] })),
      getFileContent: vi.fn(async () => "stale content"),
      getStatus: vi
        .fn<GitPanelApi["getStatus"]>()
        .mockReturnValueOnce(initialStatusPromise)
        .mockReturnValueOnce(watchStatusPromise),
      watch: vi.fn((_root, listener) => {
        watchListener = listener;
        return vi.fn();
      }),
    };

    const { container } = render(
      <GitChangesPanel
        {...makeProps({ context: activePanelContext, git, hint: emptyHint })}
      />
    );

    await waitFor(() => {
      expect(git.getStatus).toHaveBeenCalledTimes(1);
    });
    expect(watchListener).toBeDefined();

    act(() => {
      watchListener?.({
        changeKind: "worktree",
        gitRoot: activeGitRoot,
      });
    });

    await waitFor(() => {
      expect(git.getStatus).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      rejectWatchStatus(new Error("status unavailable after watch"));
      await watchStatusPromise.catch(() => undefined);
    });
    const loadFailure = await screen.findByRole("alert");
    expect(
      within(loadFailure).getByText("Unable to load Git changes")
    ).toBeVisible();
    expect(
      within(loadFailure).getByText("status unavailable after watch")
    ).toBeVisible();
    expect(screen.queryByText(emptyHint)).toBeNull();
    await waitFor(() => {
      expect(queryFileTreeRow(container, stalePathButtonPattern)).toBeNull();
    });

    await act(async () => {
      resolveInitialStatus(
        makeStatus([
          { index: "M", origPath: null, path: stalePath, worktree: "." },
        ])
      );
      await initialStatusPromise;
    });

    await waitFor(() => {
      expect(queryFileTreeRow(container, stalePathButtonPattern)).toBeNull();
    });
  });

  it("clears old-root rows while the next root status is still pending", async () => {
    const oldRoot = "/workspace/pier";
    const nextRoot = "/workspace/other";
    const oldPath = "src/OldRoot.tsx";
    const oldPathButtonPattern = OLD_ROOT_PATH_BUTTON_PATTERN;
    const nextContext: PanelContext = {
      ...activePanelContext,
      contextId: "ctx-other",
      cwd: `${nextRoot}/packages/app`,
      gitRoot: nextRoot,
      openedPath: nextRoot,
      projectRootPath: nextRoot,
      updatedAt: activePanelContext.updatedAt + 1,
      worktreeKey: nextRoot,
      worktreeRoot: nextRoot,
    };
    const git: GitPanelApi = {
      getDiffPatch: vi.fn(async () => ({ files: [] })),
      getFileContent: vi.fn(async () => "old root content"),
      getStatus: vi.fn((root: string) => {
        if (root === oldRoot) {
          return Promise.resolve(
            makeStatus([
              { index: "M", origPath: null, path: oldPath, worktree: "." },
            ])
          );
        }
        return PENDING_GIT_STATUS;
      }),
    };

    const { rerender, container } = render(
      <GitChangesPanel {...makeProps({ context: activePanelContext, git })} />
    );

    const tree = within(await findFileTree(container));
    expect(
      await tree.findByRole("treeitem", { name: oldPathButtonPattern })
    ).toBeVisible();

    rerender(<GitChangesPanel {...makeProps({ context: nextContext, git })} />);
    expect(queryFileTreeRow(container, oldPathButtonPattern)).toBeNull();

    await waitFor(() => {
      expect(git.getStatus).toHaveBeenCalledWith(nextRoot);
    });
    await waitFor(() => {
      expect(queryFileTreeRow(container, oldPathButtonPattern)).toBeNull();
    });
    expect(git.getDiffPatch).not.toHaveBeenCalledWith(nextRoot, {
      path: oldPath,
    });
  });
});

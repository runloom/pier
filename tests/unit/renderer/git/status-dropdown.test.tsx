import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { GitStatusDropdown } from "@plugins/builtin/git/renderer/status-dropdown.tsx";
import type {
  GitStatusDropdownModel,
  GitStatusDropdownRowIcon,
} from "@plugins/builtin/git/renderer/status-dropdown-model.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const PANEL_CONTEXT = {
  branch: "main",
  contextId: "ctx-pier",
  cwd: "/workspace/pier",
  gitRoot: "/workspace/pier",
  openedPath: "/workspace/pier",
  projectRootPath: "/workspace/pier",
  source: "panel",
  updatedAt: 1_772_000_000_000,
  worktreeKey: "/workspace/pier",
  worktreeRoot: "/workspace/pier",
} as const satisfies PanelContext;

function model(
  overrides: Partial<GitStatusDropdownModel>
): GitStatusDropdownModel {
  return {
    branchLabel: "feature/terminal-status",
    contextLine: "pier · fetched 1m ago",
    operationKind: null,
    rows: [
      {
        action: null,
        icon: "clean",
        id: "clean",
        label: "No local changes",
        tone: "muted",
      },
    ],
    tasks: [{ id: "switchBranch" }, { id: "switchWorktree" }],
    variant: "normal",
    gitRoot: "/workspace/pier",
    ...overrides,
  };
}

const DIRTY_MODEL = model({
  rows: [
    {
      action: "viewChanges",
      assistiveLabel: "128 insertions, 42 deletions",
      icon: "changed",
      id: "changes",
      label: "Changes",
      lineDelta: { deletions: 42, insertions: 128 },
      tone: "default",
      value: "7",
    },
    {
      action: "syncChanges",
      assistiveLabel: "2 ahead, 1 behind",
      icon: "sync",
      id: "sync",
      label: "Sync",
      tone: "default",
      value: "↑2 ↓1",
    },
  ],
});

const REBASE_MODEL = model({
  operationKind: "rebasing",
  rows: [
    {
      action: "viewChanges",
      icon: "rebase",
      id: "operation",
      label: "Rebase paused",
      tone: "danger",
      value: "3 conflicts",
    },
    {
      action: "continueOperation",
      icon: "continue",
      id: "continueOperation",
      label: "Continue Rebase",
      tone: "default",
    },
    {
      action: "abortOperation",
      icon: "abort",
      id: "abortOperation",
      label: "Abort Rebase",
      tone: "default",
    },
  ],
});

const AHEAD_MODEL = model({
  rows: [
    {
      action: null,
      icon: "clean",
      id: "clean",
      label: "No local changes",
      tone: "muted",
    },
    {
      action: "push",
      icon: "push",
      id: "sync",
      label: "Push",
      tone: "default",
      value: "↑2",
    },
  ],
});

const BEHIND_MODEL = model({
  rows: [
    {
      action: null,
      icon: "clean",
      id: "clean",
      label: "No local changes",
      tone: "muted",
    },
    {
      action: "pull",
      icon: "pull",
      id: "sync",
      label: "Pull",
      tone: "default",
      value: "↓2",
    },
  ],
});

const DIVERGED_MODEL = model({
  rows: [
    {
      action: null,
      icon: "clean",
      id: "clean",
      label: "No local changes",
      tone: "muted",
    },
    {
      action: "syncChanges",
      icon: "sync",
      id: "sync",
      label: "Sync",
      tone: "default",
      value: "↑2 ↓2",
    },
  ],
});

const LIFECYCLE_MODEL = model({
  rows: [
    {
      action: null,
      icon: "clean",
      id: "clean",
      label: "No local changes",
      tone: "muted",
    },
    {
      action: null,
      icon: "merged",
      id: "merged",
      label: "merged",
      tone: "muted",
    },
    {
      action: null,
      icon: "stash",
      id: "stash",
      label: "Stashes",
      tone: "muted",
      value: "3",
    },
  ],
});

const ROW_ICON_EXPECTATIONS: ReadonlyArray<{
  icon: GitStatusDropdownRowIcon;
  gitIcon: string;
}> = [
  { gitIcon: "git-abort", icon: "abort" },
  { gitIcon: "git-compare-arrows", icon: "bisect" },
  { gitIcon: "git-diff", icon: "changed" },
  { gitIcon: "git-commit-horizontal", icon: "cherryPick" },
  { gitIcon: "git-commit-horizontal", icon: "clean" },
  { gitIcon: "git-continue", icon: "continue" },
  { gitIcon: "git-fetch", icon: "fetch" },
  { gitIcon: "git-merge", icon: "merge" },
  { gitIcon: "git-merge", icon: "merged" },
  { gitIcon: "git-publish", icon: "publish" },
  { gitIcon: "git-pull", icon: "pull" },
  { gitIcon: "git-push", icon: "push" },
  { gitIcon: "git-pull-request-arrow", icon: "rebase" },
  { gitIcon: "git-commit-horizontal", icon: "revert" },
  { gitIcon: "git-stash", icon: "stash" },
  { gitIcon: "git-sync", icon: "sync" },
];

function singleIconModel(
  icon: GitStatusDropdownRowIcon
): GitStatusDropdownModel {
  return model({
    rows: [
      {
        action: null,
        icon,
        id: "clean",
        label: icon,
        tone: "muted",
      },
    ],
  });
}

function makePluginContext(): RendererPluginContext {
  const loading = {
    dismiss: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  };
  return {
    dialogs: {
      alert: vi.fn(() => Promise.resolve()),
      confirm: vi.fn(() => Promise.resolve(true)),
    },
    git: {},
    i18n: {
      commandDescription: vi.fn(() => undefined),
      commandTitle: vi.fn((_id: string, fallback: string) => fallback),
      language: vi.fn(() => "en"),
      t: vi.fn(
        (
          _key: string,
          _values?: Record<string, number | string>,
          fallback?: string
        ) => fallback ?? ""
      ),
    },
    notifications: {
      error: vi.fn(),
      info: vi.fn(),
      loading: vi.fn(() => loading),
      success: vi.fn(),
    },
    panels: {
      getActiveContext: vi.fn(() => PANEL_CONTEXT),
      open: vi.fn(),
    },
    worktrees: {
      check: vi.fn(() => Promise.resolve({ status: "supported" })),
      list: vi.fn(() =>
        Promise.resolve({
          status: "available",
          worktrees: [
            {
              bare: false,
              branch: "main",
              head: "abc123",
              isCurrent: true,
              isMain: true,
              locked: false,
              path: "/workspace/pier",
              prunable: false,
            },
          ],
        })
      ),
      open: vi.fn(),
    },
    commandPalette: {
      openQuickPick: vi.fn(),
    },
  } as unknown as RendererPluginContext;
}

async function openDropdown(
  pluginContext: RendererPluginContext,
  dropdownModel: GitStatusDropdownModel
): Promise<void> {
  render(
    <GitStatusDropdown
      model={dropdownModel}
      onViewChanges={vi.fn()}
      pluginContext={pluginContext}
    >
      <button type="button">trigger</button>
    </GitStatusDropdown>
  );
  fireEvent.pointerDown(screen.getByRole("button", { name: "trigger" }), {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });
  await screen.findByRole("menu");
}

describe("GitStatusDropdown", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders compact dropdown menu rows and tasks", async () => {
    const pluginContext = makePluginContext();
    await openDropdown(pluginContext, DIRTY_MODEL);

    expect(screen.getByRole("menu", { name: "git status" })).toHaveClass(
      "w-72"
    );
    expect(screen.getByTestId("git-status-row-changes")).toHaveAttribute(
      "data-slot",
      "dropdown-menu-item"
    );
    expect(
      screen.getByRole("menuitem", { name: "Switch Branch" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Switch Worktree" })
    ).toBeInTheDocument();
  });

  it("renders row values right-aligned in muted tabular numerals", async () => {
    const pluginContext = makePluginContext();
    await openDropdown(pluginContext, DIRTY_MODEL);

    const changesRow = screen.getByTestId("git-status-row-changes");
    const value = changesRow.querySelector(".ml-auto.tabular-nums");
    expect(value).not.toBeNull();
    expect(value).toHaveClass("text-muted-foreground");
    expect(screen.getByText("128 insertions, 42 deletions")).toHaveClass(
      "sr-only"
    );
  });

  it("colorizes change-row line delta like other diff summaries", async () => {
    const pluginContext = makePluginContext();
    await openDropdown(pluginContext, DIRTY_MODEL);

    const changesRow = screen.getByTestId("git-status-row-changes");
    const insertions = changesRow.querySelector(
      '[data-git-delta="insertions"]'
    );
    const deletions = changesRow.querySelector('[data-git-delta="deletions"]');
    expect(insertions).toHaveTextContent("+128");
    expect(insertions).toHaveClass("text-success");
    expect(deletions).toHaveTextContent("−42");
    expect(deletions).toHaveClass("text-status-danger-fg");
    expect(changesRow).toHaveTextContent("7");
  });

  it("renders informational rows as disabled menu items", async () => {
    const pluginContext = makePluginContext();
    await openDropdown(pluginContext, LIFECYCLE_MODEL);

    for (const id of ["clean", "merged", "stash"]) {
      expect(screen.getByTestId(`git-status-row-${id}`)).toHaveAttribute(
        "data-disabled"
      );
    }
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("opens view changes from a clean menu while keeping the clean row disabled", async () => {
    const pluginContext = makePluginContext();
    const onViewChanges = vi.fn();
    render(
      <GitStatusDropdown
        model={model({
          tasks: [
            { id: "viewChanges" },
            { id: "switchBranch" },
            { id: "switchWorktree" },
          ],
        })}
        onViewChanges={onViewChanges}
        pluginContext={pluginContext}
      >
        <button type="button">trigger</button>
      </GitStatusDropdown>
    );
    fireEvent.pointerDown(screen.getByRole("button", { name: "trigger" }), {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
    await screen.findByRole("menu");

    expect(screen.getByTestId("git-status-row-clean")).toHaveAttribute(
      "data-disabled"
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "View Changes" }));

    expect(onViewChanges).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });
  });

  it("renders Git row icons for every row icon kind", async () => {
    for (const { icon, gitIcon } of ROW_ICON_EXPECTATIONS) {
      const pluginContext = makePluginContext();
      await openDropdown(pluginContext, singleIconModel(icon));
      expect(screen.getByTestId(`git-status-row-icon-${icon}`)).toHaveAttribute(
        "data-git-icon",
        gitIcon
      );
      cleanup();
    }
  });

  it("marks the conflict operation row with danger styling", async () => {
    const pluginContext = makePluginContext();
    await openDropdown(pluginContext, REBASE_MODEL);

    const operationRow = screen.getByTestId("git-status-row-operation");
    expect(operationRow).toHaveAttribute("data-variant", "destructive");
    expect(screen.getByText("Rebase paused")).toHaveClass(
      "text-status-danger-fg"
    );
  });

  it("localizes dropdown labels through plugin text", async () => {
    const pluginContext = makePluginContext();
    const translations: Record<string, string> = {
      "ui.gitStatusLabel": "Git 状态",
      "ui.statusDropdownSwitchWorktree": "切换工作树",
    };
    vi.mocked(pluginContext.i18n.t).mockImplementation(
      (
        key: string,
        _values?: Record<string, number | string>,
        fallback?: string
      ) => translations[key] ?? fallback ?? ""
    );

    await openDropdown(pluginContext, DIRTY_MODEL);

    expect(screen.getByRole("menu", { name: "Git 状态" })).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "切换工作树" })
    ).toBeInTheDocument();
  });

  it("opens worktree quick pick from the fixed task zone", async () => {
    const pluginContext = makePluginContext();
    await openDropdown(pluginContext, LIFECYCLE_MODEL);

    fireEvent.click(screen.getByRole("menuitem", { name: "Switch Worktree" }));

    await waitFor(() => {
      expect(pluginContext.commandPalette.openQuickPick).toHaveBeenCalled();
    });
  });

  it("opens branch quick pick from the fixed task zone and switches the selected branch", async () => {
    const pluginContext = makePluginContext();
    vi.mocked(pluginContext.panels.getActiveContext).mockReturnValue({
      ...PANEL_CONTEXT,
      cwd: "/workspace/other",
      gitRoot: "/workspace/other",
      openedPath: "/workspace/other",
      projectRootPath: "/workspace/other",
      worktreeKey: "/workspace/other",
      worktreeRoot: "/workspace/other",
    });
    pluginContext.git.searchBranches = vi.fn(async () => ({
      currentBranch: "feature/terminal-status",
      durationMs: 3,
      items: [
        {
          aheadFromCurrent: null,
          authorName: null,
          behindFromCurrent: null,
          commit: "abc123",
          committerDate: null,
          current: false,
          id: "refs/heads/main",
          kind: "local" as const,
          label: "main",
          name: "main",
          pinReason: null,
          refName: "refs/heads/main",
          subject: null,
        },
      ],
      message: null,
      status: "ok" as const,
    }));
    pluginContext.git.listBranches = vi.fn(async () => []);
    pluginContext.git.checkoutBranch = vi.fn(async () => ({
      localName: "main",
      mode: "switched-local" as const,
      remoteRef: null,
    }));
    await openDropdown(pluginContext, model({}));

    fireEvent.click(screen.getByRole("menuitem", { name: "Switch Branch" }));

    await waitFor(() => {
      expect(pluginContext.commandPalette.openQuickPick).toHaveBeenCalled();
    });
    const quickPick = vi.mocked(pluginContext.commandPalette.openQuickPick).mock
      .calls[0]?.[0];
    const branchItem = quickPick?.items?.find(
      (candidate) => candidate.id === "refs/heads/main"
    );
    if (!(quickPick && branchItem)) {
      throw new Error("expected switch branch quick pick");
    }

    await quickPick.onAccept(branchItem);

    expect(pluginContext.git.searchBranches).toHaveBeenCalledWith(
      "/workspace/pier",
      { limit: 1000, query: "" }
    );
    expect(pluginContext.git.listBranches).toHaveBeenCalledWith(
      "/workspace/pier",
      { kind: "local" }
    );
    expect(pluginContext.git.checkoutBranch).toHaveBeenCalledWith(
      "/workspace/pier",
      "main"
    );
    expect(pluginContext.notifications.loading).toHaveBeenCalledWith(
      "Switching branch..."
    );
  });

  it("closes the dropdown when an action is selected", async () => {
    const pluginContext = makePluginContext();
    await openDropdown(pluginContext, DIRTY_MODEL);

    fireEvent.click(screen.getByRole("menuitem", { name: "Switch Worktree" }));

    await waitFor(() => {
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });
  });

  it("continues a paused rebase from the contextual zone", async () => {
    const pluginContext = makePluginContext();
    pluginContext.git.continueRebase = vi.fn(async () => ({
      kind: "ok" as const,
      message: "",
    }));
    await openDropdown(pluginContext, REBASE_MODEL);

    fireEvent.click(screen.getByRole("menuitem", { name: "Continue Rebase" }));

    await waitFor(() => {
      expect(pluginContext.git.continueRebase).toHaveBeenCalledWith(
        "/workspace/pier"
      );
    });
  });

  it("aborts a paused rebase only after destructive confirmation", async () => {
    const pluginContext = makePluginContext();
    pluginContext.git.abortRebase = vi.fn(async () => ({
      kind: "ok" as const,
    }));
    await openDropdown(pluginContext, REBASE_MODEL);

    fireEvent.click(screen.getByRole("menuitem", { name: "Abort Rebase" }));

    await waitFor(() => {
      expect(pluginContext.dialogs.confirm).toHaveBeenCalledWith(
        expect.objectContaining({ intent: "destructive" })
      );
    });
    await waitFor(() => {
      expect(pluginContext.git.abortRebase).toHaveBeenCalledWith(
        "/workspace/pier"
      );
    });
  });

  it("does not abort when the destructive confirmation is cancelled", async () => {
    const pluginContext = makePluginContext();
    vi.mocked(pluginContext.dialogs.confirm).mockResolvedValue(false);
    pluginContext.git.abortRebase = vi.fn(async () => ({
      kind: "ok" as const,
    }));
    await openDropdown(pluginContext, REBASE_MODEL);

    fireEvent.click(screen.getByRole("menuitem", { name: "Abort Rebase" }));

    await waitFor(() => {
      expect(pluginContext.dialogs.confirm).toHaveBeenCalled();
    });
    expect(pluginContext.git.abortRebase).not.toHaveBeenCalled();
  });

  it("runs push from an ahead-only branch", async () => {
    const pluginContext = makePluginContext();
    pluginContext.git.push = vi.fn(async () => ({ kind: "ok" as const }));
    await openDropdown(pluginContext, AHEAD_MODEL);

    fireEvent.click(screen.getByRole("menuitem", { name: /^Push/ }));

    await waitFor(() => {
      expect(pluginContext.git.push).toHaveBeenCalledWith("/workspace/pier");
    });
    expect(pluginContext.notifications.loading).toHaveBeenCalledWith(
      "Pushing changes…"
    );
  });

  it("reports remote operation failures from the dropdown", async () => {
    const pluginContext = makePluginContext();
    pluginContext.git.push = vi.fn(async () => ({
      kind: "unavailable" as const,
      message: "fatal: authentication failed",
    }));
    await openDropdown(pluginContext, AHEAD_MODEL);

    fireEvent.click(screen.getByRole("menuitem", { name: /^Push/ }));

    await waitFor(() => {
      // 鉴权类失败映射为产品文案，不直出 git stderr。
      expect(pluginContext.notifications.error).toHaveBeenCalledWith(
        "Could not authenticate with the remote. Check your credentials or network access, then try again."
      );
    });
  });

  it("opens alert with hook check output for pre-push failures", async () => {
    const pluginContext = makePluginContext();
    pluginContext.git.push = vi.fn(async () => ({
      kind: "unavailable" as const,
      message: [
        "A local Git hook rejected or stopped this operation",
        "",
        "husky - pre-push script failed (code 1)",
        "Error: typecheck failed in packages/ui",
      ].join("\n"),
    }));
    await openDropdown(pluginContext, AHEAD_MODEL);

    fireEvent.click(screen.getByRole("menuitem", { name: /^Push/ }));

    await waitFor(() => {
      expect(pluginContext.dialogs.alert).toHaveBeenCalledWith({
        body: expect.stringContaining("typecheck failed in packages/ui"),
        title: "Project check script blocked this action",
      });
    });
    expect(pluginContext.notifications.error).not.toHaveBeenCalled();
  });

  it("runs pull from a behind-only branch", async () => {
    const pluginContext = makePluginContext();
    pluginContext.git.pullFastForward = vi.fn(async () => ({
      kind: "ok" as const,
    }));
    await openDropdown(pluginContext, BEHIND_MODEL);

    fireEvent.click(screen.getByRole("menuitem", { name: /^Pull/ }));

    await waitFor(() => {
      expect(pluginContext.git.pullFastForward).toHaveBeenCalledWith(
        "/workspace/pier"
      );
    });
  });

  it("runs sync from a diverged branch", async () => {
    const pluginContext = makePluginContext();
    pluginContext.git.sync = vi.fn(async () => ({ kind: "ok" as const }));
    await openDropdown(pluginContext, DIVERGED_MODEL);

    fireEvent.click(screen.getByRole("menuitem", { name: /^Sync/ }));

    await waitFor(() => {
      expect(pluginContext.git.sync).toHaveBeenCalledWith("/workspace/pier");
    });
  });
});

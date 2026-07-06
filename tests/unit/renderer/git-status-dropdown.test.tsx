import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { GitStatusDropdown } from "@plugins/builtin/git/renderer/git-status-dropdown.tsx";
import type { GitStatusDropdownModel } from "@plugins/builtin/git/renderer/git-status-dropdown-model.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const STASH_ACTION_NAME = /stash/i;

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

const DIRTY_MODEL = model({
  actions: [{ id: "openChanges" }, { id: "switchWorktree" }],
  statusGroups: [
    { parts: [{ label: "7 changed", tone: "warning" }] },
    {
      parts: [
        { assistiveLabel: "insertions", label: "+128", tone: "success" },
        {
          assistiveLabel: "deletions",
          label: "−42",
          tone: "destructive",
        },
      ],
    },
    {
      parts: [
        { assistiveLabel: "ahead", label: "↑2", tone: "muted" },
        { assistiveLabel: "behind", label: "↓1", tone: "muted" },
      ],
    },
  ],
  variant: "dirty",
});

const COMPLETED_MODEL = model({
  actions: [{ id: "switchWorktree" }, { id: "openChanges" }],
  statusGroups: [
    { parts: [{ label: "No local changes", tone: "default" }] },
    { parts: [{ label: "merged", tone: "done" }] },
    { parts: [{ label: "upstream gone", tone: "warning" }] },
  ],
  variant: "completed",
});

const REBASE_MODEL = model({
  actions: [{ id: "openChanges" }, { id: "switchWorktree" }],
  statusGroups: [
    { parts: [{ label: "Rebase paused", tone: "info" }] },
    { parts: [{ label: "3 conflicts", tone: "danger" }] },
  ],
  variant: "active",
});

const CLEAN_MODEL = model({
  actions: [
    { id: "openChanges" },
    { id: "switchBranch" },
    { id: "switchWorktree" },
  ],
  statusGroups: [{ parts: [{ label: "No local changes", tone: "default" }] }],
  variant: "clean",
});

const AHEAD_MODEL = model({
  actions: [
    { id: "push" },
    { id: "openChanges" },
    { id: "switchBranch" },
    { id: "switchWorktree" },
  ],
  statusGroups: [
    { parts: [{ label: "No local changes", tone: "default" }] },
    { parts: [{ assistiveLabel: "ahead", label: "↑2", tone: "muted" }] },
  ],
  variant: "clean",
});

const BEHIND_MODEL = model({
  actions: [
    { id: "pull" },
    { id: "openChanges" },
    { id: "switchBranch" },
    { id: "switchWorktree" },
  ],
  statusGroups: [
    { parts: [{ label: "No local changes", tone: "default" }] },
    { parts: [{ assistiveLabel: "behind", label: "↓2", tone: "muted" }] },
  ],
  variant: "clean",
});

const DIVERGED_MODEL = model({
  actions: [
    { id: "syncChanges" },
    { id: "openChanges" },
    { id: "switchBranch" },
    { id: "switchWorktree" },
  ],
  statusGroups: [
    { parts: [{ label: "No local changes", tone: "default" }] },
    {
      parts: [
        { assistiveLabel: "ahead", label: "↑2", tone: "muted" },
        { assistiveLabel: "behind", label: "↓2", tone: "muted" },
      ],
    },
  ],
  variant: "clean",
});

function model(
  overrides: Partial<GitStatusDropdownModel>
): GitStatusDropdownModel {
  return {
    actions: [],
    branchLabel: "feature/terminal-status",
    contextLine: "pier · fetched 1m ago",
    statusGroups: [{ parts: [{ label: "Clean", tone: "default" }] }],
    variant: "clean",
    worktreePath: "/workspace/pier",
    ...overrides,
  };
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
  model: GitStatusDropdownModel
): Promise<void> {
  render(
    <GitStatusDropdown
      context={PANEL_CONTEXT}
      model={model}
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

  it("opens Git Changes from the dirty dropdown", async () => {
    const pluginContext = makePluginContext();
    await openDropdown(pluginContext, DIRTY_MODEL);

    fireEvent.click(screen.getByRole("menuitem", { name: "Open Git Changes" }));

    expect(pluginContext.panels.open).toHaveBeenCalledWith("pier.git.changes", {
      context: PANEL_CONTEXT,
    });
  });

  it("renders compact dropdown menu actions instead of primary blue pills", async () => {
    const pluginContext = makePluginContext();
    await openDropdown(pluginContext, DIRTY_MODEL);

    expect(screen.getByRole("menu", { name: "Git status" })).toHaveClass(
      "w-72"
    );
    expect(
      screen.getByRole("menuitem", { name: "Open Git Changes" })
    ).toHaveAttribute("data-slot", "dropdown-menu-item");
    expect(
      screen.getByRole("menuitem", { name: "Switch Worktree" })
    ).toHaveAttribute("data-slot", "dropdown-menu-item");
  });

  it("uses status-token colors for badge and summary details", async () => {
    const pluginContext = makePluginContext();
    await openDropdown(pluginContext, DIRTY_MODEL);

    expect(screen.getByText("changed")).toHaveClass(
      "bg-status-warning-bg",
      "border-status-warning-border",
      "text-status-warning-fg"
    );
    expect(screen.getByText("7 changed")).toHaveClass("text-status-warning-fg");
    expect(screen.getByText("+128")).toHaveClass("text-success");
    expect(screen.getByText("−42")).toHaveClass("text-destructive");
    expect(screen.getByText("↑2")).toHaveClass("text-muted-foreground");
    expect(screen.getByText("↓1")).toHaveClass("text-muted-foreground");
    expect(screen.getByText("insertions,", { exact: false })).toHaveClass(
      "sr-only"
    );
    expect(screen.getByText("deletions,", { exact: false })).toHaveClass(
      "sr-only"
    );
  });

  it("localizes dropdown labels through plugin text", async () => {
    const pluginContext = makePluginContext();
    const translations: Record<string, string> = {
      "ui.gitStatusLabel": "Git 状态",
      "ui.statusDropdownOpenChanges": "打开 Git 变更",
      "ui.statusDropdownStateDirty": "有变更",
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
      screen.getByRole("menuitem", { name: "打开 Git 变更" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "切换工作树" })
    ).toBeInTheDocument();
    expect(screen.getByText("有变更")).toBeInTheDocument();
  });

  it("opens worktree quick pick from clean completed dropdown", async () => {
    const pluginContext = makePluginContext();
    await openDropdown(pluginContext, COMPLETED_MODEL);

    fireEvent.click(screen.getByRole("menuitem", { name: "Switch Worktree" }));

    await waitFor(() => {
      expect(pluginContext.commandPalette.openQuickPick).toHaveBeenCalled();
    });
  });

  it("opens branch quick pick from the clean dropdown and switches the selected branch", async () => {
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
    pluginContext.git.checkoutBranch = vi.fn(async () => true);
    await openDropdown(pluginContext, CLEAN_MODEL);

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

    fireEvent.click(screen.getByRole("menuitem", { name: "Open Git Changes" }));

    await waitFor(() => {
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });
  });

  it("keeps write operations out of the status dropdown", async () => {
    const pluginContext = makePluginContext();
    await openDropdown(pluginContext, REBASE_MODEL);

    expect(screen.queryByRole("menuitem", { name: "Continue Rebase" })).toBe(
      null
    );
    expect(screen.queryByRole("menuitem", { name: "Abort" })).toBe(null);
    expect(screen.queryByRole("menuitem", { name: STASH_ACTION_NAME })).toBe(
      null
    );
  });

  it("runs push from an ahead-only branch", async () => {
    const pluginContext = makePluginContext();
    pluginContext.git.push = vi.fn(async () => ({ kind: "ok" as const }));
    await openDropdown(pluginContext, AHEAD_MODEL);

    fireEvent.click(screen.getByRole("menuitem", { name: "Push Changes" }));

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

    fireEvent.click(screen.getByRole("menuitem", { name: "Push Changes" }));

    await waitFor(() => {
      expect(pluginContext.notifications.error).toHaveBeenCalledWith(
        "fatal: authentication failed"
      );
    });
  });

  it("runs pull from a behind-only branch", async () => {
    const pluginContext = makePluginContext();
    pluginContext.git.pullFastForward = vi.fn(async () => ({
      kind: "ok" as const,
    }));
    await openDropdown(pluginContext, BEHIND_MODEL);

    fireEvent.click(screen.getByRole("menuitem", { name: "Pull Changes" }));

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

    fireEvent.click(screen.getByRole("menuitem", { name: "Sync Changes" }));

    await waitFor(() => {
      expect(pluginContext.git.sync).toHaveBeenCalledWith("/workspace/pier");
    });
  });
});

import type {
  RendererPluginAction,
  RendererPluginContext,
  RendererPluginQuickPick,
} from "@plugins/api/renderer.ts";
import { registerWorktreeOperationActions } from "@plugins/builtin/git/renderer/worktree-operation-actions.ts";
import type { WorktreeItem } from "@shared/contracts/worktree.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

function interpolate(
  template: string | undefined,
  values: Record<string, number | string> | undefined
): string {
  const base = template ?? "";
  if (!values) {
    return base;
  }
  return base.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => {
    const value = values[key];
    return value === undefined ? match : String(value);
  });
}

function unimplemented(name: string): () => never {
  return () => {
    throw new Error(`mock context: ${name} should not be called in this test`);
  };
}

function worktreeItem(overrides: Partial<WorktreeItem> = {}): WorktreeItem {
  return {
    bare: false,
    branch: "feature/cleanup",
    detached: false,
    head: "abc123",
    isCurrent: false,
    isMain: false,
    locked: false,
    lockedReason: null,
    path: "/repo.worktree/feature-cleanup",
    prunable: false,
    prunableReason: null,
    ...overrides,
  };
}

const listMock = vi.fn();
const removeMock = vi.fn();
const worktreeBindingMock = vi.fn();
const openQuickPickMock = vi.fn();
const alertMock = vi.fn<RendererPluginContext["dialogs"]["alert"]>(
  async () => undefined
);
const notificationErrorMock =
  vi.fn<RendererPluginContext["notifications"]["error"]>();

function createMockContext(): {
  actions: Map<string, RendererPluginAction>;
  context: RendererPluginContext;
} {
  const actions = new Map<string, RendererPluginAction>();
  const context = {
    actions: {
      register: (action: RendererPluginAction) => {
        actions.set(action.id, action);
        return vi.fn();
      },
    },
    agents: { selection: unimplemented("agents.selection") },
    ai: {
      generateText: unimplemented("ai.generateText"),
      status: unimplemented("ai.status"),
    },
    commandPalette: {
      openQuickPick: openQuickPickMock,
    },
    configuration: {
      get: <T>() => "" as T,
      onDidChange: unimplemented("configuration.onDidChange"),
      reset: unimplemented("configuration.reset"),
      set: unimplemented("configuration.set"),
    },
    missionControlWidgets: {
      register: unimplemented("missionControlWidgets.register"),
    },
    dialogs: {
      alert: alertMock,
      confirm: unimplemented("dialogs.confirm"),
    },
    environments: {
      worktreeBinding: worktreeBindingMock,
    },
    files: {
      list: unimplemented("files.list"),
      move: unimplemented("files.move"),
      readText: unimplemented("files.readText"),
      trash: unimplemented("files.trash"),
      writeText: unimplemented("files.writeText"),
    },
    git: {
      abortMerge: unimplemented("git.abortMerge"),
      abortRebase: unimplemented("git.abortRebase"),
      checkoutBranch: unimplemented("git.checkoutBranch"),
      continueRebase: unimplemented("git.continueRebase"),
      discardChanges: unimplemented("git.discardChanges"),
      getDiffPatch: unimplemented("git.getDiffPatch"),
      getFileContent: unimplemented("git.getFileContent"),
      getRepoInfo: unimplemented("git.getRepoInfo"),
      getStatus: unimplemented("git.getStatus"),
      listBranches: unimplemented("git.listBranches"),
      listStashes: unimplemented("git.listStashes"),
      merge: unimplemented("git.merge"),
      popStash: unimplemented("git.popStash"),
      pullFastForward: unimplemented("git.pullFastForward"),
      push: unimplemented("git.push"),
      applyStash: unimplemented("git.applyStash"),
      dropStash: unimplemented("git.dropStash"),
      rebase: unimplemented("git.rebase"),
      searchBranches: unimplemented("git.searchBranches"),
      stage: unimplemented("git.stage"),
      stash: unimplemented("git.stash"),
      sync: unimplemented("git.sync"),
      undoLastCommit: unimplemented("git.undoLastCommit"),
      unstage: unimplemented("git.unstage"),
      watch: unimplemented("git.watch"),
    },
    i18n: {
      commandDescription: unimplemented("i18n.commandDescription"),
      commandTitle: (_id: string, fallback?: string) => fallback ?? "",
      language: () => "en",
      t: (
        _key: string,
        values: Record<string, number | string> | undefined,
        fallback: string | undefined
      ) => interpolate(fallback, values),
    },
    notifications: {
      error: notificationErrorMock,
      info: unimplemented("notifications.info"),
      loading: unimplemented("notifications.loading"),
      success: unimplemented("notifications.success"),
      system: unimplemented("notifications.system"),
    },
    overlays: {
      close: unimplemented("overlays.close"),
      open: unimplemented("overlays.open"),
    },
    panels: {
      getActiveContext: () => ({
        cwd: "/repo",
        gitRoot: "/repo",
        projectRootPath: "/repo",
        worktreeRoot: "/repo",
        worktreeSupported: true,
      }),
      open: unimplemented("panels.open"),
      register: unimplemented("panels.register"),
    },
    terminalStatusItems: {
      register: unimplemented("terminalStatusItems.register"),
    },
    worktrees: {
      check: unimplemented("worktrees.check"),
      create: unimplemented("worktrees.create"),
      creationDefaults: unimplemented("worktrees.creationDefaults"),
      list: listMock,
      open: unimplemented("worktrees.open"),
      openTerminal: unimplemented("worktrees.openTerminal"),
      prune: unimplemented("worktrees.prune"),
      remove: removeMock,
    },
  };

  return { actions, context: context as unknown as RendererPluginContext };
}

function createAction(actions: Map<string, RendererPluginAction>) {
  const action = actions.get("pier.worktree.create");
  expect(action).toBeDefined();
  if (!action) {
    throw new Error("missing create action");
  }
  return action;
}

function deleteAction(actions: Map<string, RendererPluginAction>) {
  const action = actions.get("pier.worktree.delete");
  expect(action).toBeDefined();
  if (!action) {
    throw new Error("missing delete action");
  }
  return action;
}

async function openDeleteConfirmation(action: RendererPluginAction): Promise<{
  confirmPick: RendererPluginQuickPick;
  pendingDelete: Promise<void>;
}> {
  await action.handler();
  const candidatePick = openQuickPickMock.mock.calls[0]?.[0] as
    | RendererPluginQuickPick
    | undefined;
  const candidate = candidatePick?.items?.[0];
  if (!(candidatePick && candidate)) {
    throw new Error("delete candidate picker was not opened");
  }

  const pendingDelete = Promise.resolve(candidatePick.onAccept(candidate));
  // deleteSelectedWorktree now awaits context.environments.worktreeBinding()
  // before opening the confirmation picker — flush microtasks until it lands.
  await vi.waitFor(() => {
    if (!openQuickPickMock.mock.calls[1]) {
      throw new Error("confirmation picker not yet opened");
    }
  });

  const confirmPick = openQuickPickMock.mock.calls[1]?.[0] as
    | RendererPluginQuickPick
    | undefined;
  if (!confirmPick) {
    throw new Error("delete confirmation picker was not opened");
  }

  return { confirmPick, pendingDelete };
}

describe("worktree operation actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const candidate = worktreeItem();
    listMock.mockResolvedValue({
      currentPath: "/repo",
      mainPath: "/repo",
      path: "/repo",
      status: "available",
      worktrees: [
        worktreeItem({
          branch: "main",
          isCurrent: true,
          isMain: true,
          path: "/repo",
        }),
        candidate,
      ],
    });
    removeMock.mockResolvedValue({
      removedPath: candidate.path,
      worktrees: [],
    });
  });

  it("passes the invoking panel group into the worktree creator", async () => {
    const { actions, context } = createMockContext();
    context.git.listBranches = vi.fn(async () => []);
    context.worktrees.creationDefaults = vi.fn(async () => ({
      copyPatterns: [],
      rootPath: "/repo.worktree",
    }));
    const openOverlay = vi.fn();
    context.overlays.open = openOverlay;
    registerWorktreeOperationActions(context);

    await createAction(actions).handler({
      sourcePanelGroupId: "source-group",
    });

    const registration = openOverlay.mock.calls[0]?.[0];
    expect(registration?.render({ close: vi.fn() })).toMatchObject({
      props: { targetGroupId: "source-group" },
    });
  });

  it.each([
    ["not_git_repo", "The current directory is not a Git repository"],
    ["git_unavailable", "Git is unavailable"],
    ["invalid_path", "The worktree path is invalid"],
    ["invalid_name", "The worktree name is invalid"],
  ] as const)("localizes the %s worktree-unavailable reason", async (reason, expectedBody) => {
    listMock.mockResolvedValueOnce({
      reason,
      status: "unavailable",
    });
    const { actions, context } = createMockContext();
    registerWorktreeOperationActions(context);

    await createAction(actions).handler();

    expect(alertMock).toHaveBeenCalledWith({
      body: expectedBody,
      title: "Worktree operation failed",
    });
    expect(notificationErrorMock).not.toHaveBeenCalled();
  });

  it("shows worktree list failures in a dialog when creating a worktree", async () => {
    listMock.mockRejectedValueOnce(new Error("boom"));
    const { actions, context } = createMockContext();
    registerWorktreeOperationActions(context);

    await createAction(actions).handler();

    expect(alertMock).toHaveBeenCalledWith({
      body: "boom",
      title: "Worktree operation failed",
    });
    expect(notificationErrorMock).not.toHaveBeenCalled();
  });

  it("adds cleanup copy to the delete confirmation for a bound worktree with a cleanup script", async () => {
    worktreeBindingMock.mockResolvedValue({
      hasCleanupScript: true,
      projectRootPath: "/repo",
      worktreePath: "/repo.worktree/feature-cleanup",
    });
    const { actions, context } = createMockContext();
    registerWorktreeOperationActions(context);

    const { confirmPick, pendingDelete } = await openDeleteConfirmation(
      deleteAction(actions)
    );
    confirmPick.onDismiss?.();
    await pendingDelete;

    expect(worktreeBindingMock).toHaveBeenCalledWith({
      worktreePath: "/repo.worktree/feature-cleanup",
    });
    expect(confirmPick.placeholder).toContain(
      "Delete worktree feature/cleanup?"
    );
    expect(confirmPick.placeholder).toContain(
      "Cleanup will run for project \u201crepo\u201d."
    );
  });

  it("does not remove a bound worktree when the cleanup-aware confirmation is canceled", async () => {
    worktreeBindingMock.mockResolvedValue({
      hasCleanupScript: true,
      projectRootPath: "/repo",
      worktreePath: "/repo.worktree/feature-cleanup",
    });
    const { actions, context } = createMockContext();
    registerWorktreeOperationActions(context);

    const { confirmPick, pendingDelete } = await openDeleteConfirmation(
      deleteAction(actions)
    );
    const cancel = confirmPick.items?.find((item) => item.id === "cancel");
    if (!cancel) {
      throw new Error("cancel confirmation item was not rendered");
    }

    await confirmPick.onAccept(cancel);
    await pendingDelete;

    expect(removeMock).not.toHaveBeenCalled();
  });

  it("uses the existing delete confirmation copy for an unbound worktree", async () => {
    worktreeBindingMock.mockResolvedValue(null);
    const { actions, context } = createMockContext();
    registerWorktreeOperationActions(context);

    const { confirmPick, pendingDelete } = await openDeleteConfirmation(
      deleteAction(actions)
    );
    confirmPick.onDismiss?.();
    await pendingDelete;

    expect(worktreeBindingMock).toHaveBeenCalledWith({
      worktreePath: "/repo.worktree/feature-cleanup",
    });
    expect(confirmPick.placeholder).toBe("Delete worktree feature/cleanup?");
  });
});

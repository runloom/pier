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
      alert: unimplemented("dialogs.alert"),
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
      error: unimplemented("notifications.error"),
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

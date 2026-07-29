import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  type ScopedGitReviewMutationTransitionEvent,
  subscribeGitReviewMutationTransition,
} from "@plugins/builtin/git/renderer/git-review-mutation-transitions.ts";
import {
  GIT_REVIEW_OPEN_FILE_COMMAND_ID,
  GIT_REVIEW_TREE_ITEM_SURFACE,
  registerGitReviewTreeActions,
} from "@plugins/builtin/git/renderer/git-review-tree-actions.ts";
import { buildGitReviewTreeItemMenuFlags } from "@plugins/builtin/git/renderer/git-review-tree-context-menu.ts";
import type { GitReviewTreeFileRef } from "@plugins/builtin/git/renderer/git-review-tree-section.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { buildMenuEntries } from "@/lib/context-menu/build-entries.ts";

function collectActionIds(
  entries: ReturnType<typeof buildMenuEntries>
): string[] {
  const ids: string[] = [];
  for (const entry of entries) {
    if (entry.type === "action") {
      ids.push(entry.id);
    }
  }
  return ids;
}

describe("git review tree actions", () => {
  const openInEditor = vi.fn(() => true);
  const error = vi.fn();
  const info = vi.fn();
  const applyReviewPathMutation = vi.fn(async () => ({
    kind: "ok" as const,
    operationId: "operation:path",
  }));
  const stage = vi.fn(async () => true);
  const unstage = vi.fn(async () => true);
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    actionRegistry.clearForTests();
    openInEditor.mockClear();
    openInEditor.mockReturnValue(true);
    error.mockClear();
    info.mockClear();
    applyReviewPathMutation.mockClear();
    stage.mockClear();
    unstage.mockClear();
    const context = {
      actions: {
        register: (action: Parameters<typeof actionRegistry.register>[0]) =>
          actionRegistry.register(action),
      },
      files: { openInEditor },
      git: { applyReviewPathMutation, stage, unstage },
      i18n: {
        t: (_key: string, _values: unknown, fallback: string) => fallback,
      },
      notifications: { error, info },
      dialogs: {
        alert: vi.fn(async () => undefined),
        choice: vi.fn(async () => "cancel"),
        confirm: vi.fn(async () => false),
      },
      panels: {
        getActiveInstanceId: () => "panel-1",
      },
    } as unknown as RendererPluginContext;
    dispose = registerGitReviewTreeActions(context);
  });

  afterEach(() => {
    dispose?.();
    actionRegistry.clearForTests();
  });

  it("shows Open File only for file tree items", () => {
    const fileMenu = buildMenuEntries(GIT_REVIEW_TREE_ITEM_SURFACE, {
      metadata: {
        contextId: "ctx",
        expectedIndexRevision: "index:1",
        gitRootPath: "/repo",
        kind: "file",
        path: "src/a.ts",
      },
      surface: GIT_REVIEW_TREE_ITEM_SURFACE,
    });
    expect(collectActionIds(fileMenu)).toContain(
      GIT_REVIEW_OPEN_FILE_COMMAND_ID
    );

    const directoryMenu = buildMenuEntries(GIT_REVIEW_TREE_ITEM_SURFACE, {
      metadata: {
        contextId: "ctx",
        expectedIndexRevision: "index:1",
        gitRootPath: "/repo",
        kind: "directory",
        path: "src",
      },
      surface: GIT_REVIEW_TREE_ITEM_SURFACE,
    });
    expect(collectActionIds(directoryMenu)).not.toContain(
      GIT_REVIEW_OPEN_FILE_COMMAND_ID
    );
  });

  it("shows stage/unstage for directory when path lists are present", () => {
    const directoryMenu = buildMenuEntries(GIT_REVIEW_TREE_ITEM_SURFACE, {
      metadata: {
        contextId: "ctx",
        expectedIndexRevision: "index:1",
        gitRootPath: "/repo",
        hasStaged: true,
        hasUnstaged: true,
        kind: "directory",
        path: "src",
        stagePaths: ["src/a.ts"],
        unstagePaths: ["src/b.ts"],
        uncommitted: true,
      },
      surface: GIT_REVIEW_TREE_ITEM_SURFACE,
    });
    const ids = collectActionIds(directoryMenu);
    expect(ids).toContain("pier.git.review.stageFile");
    expect(ids).toContain("pier.git.review.unstageFile");
    expect(ids).not.toContain(GIT_REVIEW_OPEN_FILE_COMMAND_ID);
    expect(directoryMenu.some((entry) => entry.type === "separator")).toBe(
      false
    );
  });

  it("keeps review item actions in one group without separators", () => {
    const fileMenu = buildMenuEntries(GIT_REVIEW_TREE_ITEM_SURFACE, {
      metadata: {
        contextId: "ctx",
        expectedIndexRevision: "index:1",
        gitRootPath: "/repo",
        hasUnstaged: true,
        kind: "file",
        path: "src/a.ts",
        stagePaths: ["src/a.ts"],
        unstagedStatus: "modified",
        uncommitted: true,
      },
      surface: GIT_REVIEW_TREE_ITEM_SURFACE,
    });
    expect(fileMenu.some((entry) => entry.type === "separator")).toBe(false);
    expect(collectActionIds(fileMenu)).toEqual([
      GIT_REVIEW_OPEN_FILE_COMMAND_ID,
      "pier.git.review.stageFile",
      "pier.git.review.discardFile",
    ]);
  });

  it("keeps reading available while disabling every mutation during a repository write", () => {
    const menu = buildMenuEntries(GIT_REVIEW_TREE_ITEM_SURFACE, {
      metadata: {
        contextId: "ctx",
        discardTrackedPaths: ["src/a.ts"],
        expectedIndexRevision: "index:1",
        gitRootPath: "/repo",
        hasUnstaged: true,
        kind: "file",
        mutationBlocked: true,
        path: "src/a.ts",
        stagePaths: ["src/a.ts"],
        unstagedStatus: "modified",
        uncommitted: true,
      },
      surface: GIT_REVIEW_TREE_ITEM_SURFACE,
    });
    const enabledById = new Map(
      menu
        .filter((entry) => entry.type === "action")
        .map((entry) => [entry.id, entry.enabled])
    );

    expect(enabledById.get(GIT_REVIEW_OPEN_FILE_COMMAND_ID)).toBe(true);
    expect(enabledById.get("pier.git.review.stageFile")).toBe(false);
    expect(enabledById.get("pier.git.review.discardFile")).toBe(false);
  });

  it("opens the file in the files panel", async () => {
    const action = actionRegistry.get(GIT_REVIEW_OPEN_FILE_COMMAND_ID);
    expect(action).toBeDefined();
    await action?.handler({
      metadata: {
        contextId: "ctx",
        gitRootPath: "/repo",
        kind: "file",
        path: "src/a.ts",
      },
      surface: GIT_REVIEW_TREE_ITEM_SURFACE,
    });
    expect(openInEditor).toHaveBeenCalledWith({
      context: expect.objectContaining({
        contextId: "ctx",
        gitRoot: "/repo",
        projectRootPath: "/repo",
      }),
      path: "src/a.ts",
      root: "/repo",
      title: "a.ts",
    });
  });

  it("routes tree stage through the atomic path mutation command", async () => {
    const action = actionRegistry.get("pier.git.review.stageFile");
    await action?.handler({
      metadata: {
        contextId: "ctx",
        expectedIndexRevision: "index:1",
        gitRootPath: "/repo",
        hasUnstaged: true,
        kind: "directory",
        path: "src",
        stagePaths: ["src/a.ts", "src/b.ts"],
        uncommitted: true,
      },
      surface: GIT_REVIEW_TREE_ITEM_SURFACE,
    });

    expect(applyReviewPathMutation).toHaveBeenCalledOnce();
    expect(applyReviewPathMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "stage",
        expectedIndexRevision: "index:1",
        paths: ["src/a.ts", "src/b.ts"],
        source: {
          contextId: "ctx",
          gitRootPath: "/repo",
          target: { kind: "uncommitted" },
        },
      })
    );
    expect(stage).not.toHaveBeenCalled();
    expect(unstage).not.toHaveBeenCalled();
  });

  it("reports a stale native-menu race when another mutation acquired authority", async () => {
    let finishFirst!: (value: {
      kind: "ok";
      operationId: string;
      stateSequence?: number;
    }) => void;
    applyReviewPathMutation.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirst = resolve;
        })
    );
    const action = actionRegistry.get("pier.git.review.stageFile");
    const transitionEvents: ScopedGitReviewMutationTransitionEvent[] = [];
    const unsubscribeTransition = subscribeGitReviewMutationTransition(
      (event) => transitionEvents.push(event)
    );
    const invocation = {
      metadata: {
        contextId: "ctx",
        expectedIndexRevision: "index:1",
        gitRootPath: "/repo",
        hasUnstaged: true,
        kind: "file",
        path: "src/a.ts",
        stagePaths: ["src/a.ts"],
        uncommitted: true,
      },
      surface: GIT_REVIEW_TREE_ITEM_SURFACE,
    };

    const first = action?.handler(invocation);
    await Promise.resolve();
    expect(transitionEvents).toHaveLength(1);
    expect(transitionEvents[0]).toMatchObject({
      kind: "begin",
      transition: {
        contextId: "ctx",
        gitRootPath: "/repo",
        path: "src/a.ts",
        targetSurface: "staged",
      },
    });
    await action?.handler(invocation);

    expect(applyReviewPathMutation).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith("Another change is still being applied");
    finishFirst({
      kind: "ok",
      operationId: "operation:path",
      stateSequence: 9,
    });
    await first;
    expect(transitionEvents).toHaveLength(2);
    expect(transitionEvents[1]).toEqual({
      kind: "commit",
      stateSequence: 9,
      transitionId:
        transitionEvents[0]?.kind === "begin"
          ? transitionEvents[0].transition.transitionId
          : "",
    });
    unsubscribeTransition();
  });

  it("notifies when files panel is unavailable", async () => {
    openInEditor.mockReturnValue(false);
    const action = actionRegistry.get(GIT_REVIEW_OPEN_FILE_COMMAND_ID);
    await action?.handler({
      metadata: {
        contextId: "ctx",
        gitRootPath: "/repo",
        kind: "file",
        path: "src/a.ts",
      },
      surface: GIT_REVIEW_TREE_ITEM_SURFACE,
    });
    expect(error).toHaveBeenCalledWith("Unable to open file");
  });
});

describe("buildGitReviewTreeItemMenuFlags", () => {
  const halfStagedEntry = {
    entryKey: "ek:a.ts",
    oldPaths: [] as string[],
    path: "a.ts",
    renderSlots: [
      {
        group: "unstaged" as const,
        oldPath: null,
        sectionKey: "sec:u:a",
        status: "modified" as const,
        targetPath: "a.ts",
      },
      {
        group: "staged" as const,
        oldPath: null,
        sectionKey: "sec:s:a",
        status: "modified" as const,
        targetPath: "a.ts",
      },
    ],
    status: "modified" as const,
  };

  const stagedRef: GitReviewTreeFileRef = {
    entryKey: "ek:a.ts",
    group: "staged",
    path: "a.ts",
    sectionKey: "sec:s:a",
    status: "modified",
  };

  const unstagedRef: GitReviewTreeFileRef = {
    entryKey: "ek:a.ts",
    group: "unstaged",
    path: "a.ts",
    sectionKey: "sec:u:a",
    status: "modified",
  };

  it("does not set hasUnstaged for a staged row of a half-staged file", () => {
    expect(
      buildGitReviewTreeItemMenuFlags({
        entry: halfStagedEntry,
        fileRef: stagedRef,
      })
    ).toEqual({
      allDiscardTrackedDeleted: false,
      discardPaths: [],
      discardTrackedPaths: [],
      discardUntrackedPaths: [],
      hasConflict: false,
      hasStaged: true,
      hasUnstaged: false,
      stagePaths: [],
      unstagePaths: ["a.ts"],
      unstagedStatus: null,
    });
  });

  it("scopes unstaged row flags to the clicked group", () => {
    expect(
      buildGitReviewTreeItemMenuFlags({
        entry: halfStagedEntry,
        fileRef: unstagedRef,
      })
    ).toEqual({
      allDiscardTrackedDeleted: false,
      discardPaths: ["a.ts"],
      discardTrackedPaths: ["a.ts"],
      discardUntrackedPaths: [],
      hasConflict: false,
      hasStaged: false,
      hasUnstaged: true,
      stagePaths: ["a.ts"],
      unstagePaths: [],
      unstagedStatus: "modified",
    });
  });

  it("ORs slot groups when fileRef is missing (directory)", () => {
    expect(buildGitReviewTreeItemMenuFlags({ entry: halfStagedEntry })).toEqual(
      {
        allDiscardTrackedDeleted: false,
        discardPaths: ["a.ts"],
        discardTrackedPaths: ["a.ts"],
        discardUntrackedPaths: [],
        hasConflict: false,
        hasStaged: true,
        hasUnstaged: true,
        stagePaths: ["a.ts"],
        unstagePaths: ["a.ts"],
        unstagedStatus: "modified",
      }
    );
  });

  it("aggregates directory fileRefs into stage/unstage path lists", () => {
    expect(
      buildGitReviewTreeItemMenuFlags({
        fileRefs: [
          unstagedRef,
          {
            entryKey: "ek:b.ts",
            group: "unstaged",
            path: "dir/b.ts",
            sectionKey: "sec:u:b",
            status: "added",
          },
          stagedRef,
        ],
      })
    ).toEqual({
      allDiscardTrackedDeleted: false,
      discardPaths: ["a.ts", "dir/b.ts"],
      discardTrackedPaths: ["a.ts"],
      discardUntrackedPaths: ["dir/b.ts"],
      hasConflict: false,
      hasStaged: true,
      hasUnstaged: true,
      stagePaths: ["a.ts", "dir/b.ts"],
      unstagePaths: ["a.ts"],
      unstagedStatus: "modified",
    });
  });

  it("includes untracked added files in discard paths", () => {
    expect(
      buildGitReviewTreeItemMenuFlags({
        fileRef: {
          entryKey: "ek:new.ts",
          group: "unstaged",
          path: "new.ts",
          sectionKey: "sec:u:new",
          status: "added",
        },
      })
    ).toEqual({
      allDiscardTrackedDeleted: false,
      discardPaths: ["new.ts"],
      discardTrackedPaths: [],
      discardUntrackedPaths: ["new.ts"],
      hasConflict: false,
      hasStaged: false,
      hasUnstaged: true,
      stagePaths: ["new.ts"],
      unstagePaths: [],
      unstagedStatus: "added",
    });
  });
});

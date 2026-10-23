import { TooltipProvider } from "@pier/ui/tooltip.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { GitReviewPanelLayout } from "@plugins/builtin/git/renderer/review/panel-layout.tsx";
import { gitReviewTreeModel } from "@plugins/builtin/git/renderer/review/tree.tsx";
import {
  GIT_REVIEW_TREE_ITEM_SURFACE,
  registerGitReviewTreeActions,
} from "@plugins/builtin/git/renderer/review/tree-actions.ts";
import {
  collapseGitReviewTreeFolders,
  expandGitReviewTreeFolders,
} from "@plugins/builtin/git/renderer/review/tree-collapse-registry.ts";
import type { GitReviewIndexEntry } from "@shared/contracts/git/review.ts";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { actionRegistry } from "@/lib/actions/registry.ts";

const EXPAND_ALL_ID = "pier.git.review.expandAll";
const COLLAPSE_ALL_ID = "pier.git.review.collapseFolders";

function entry(index: number, path: string): GitReviewIndexEntry {
  return {
    entryKey: `entry:${index}`,
    oldPaths: [],
    path,
    renderSlots: [
      {
        group: "unstaged",
        oldPath: null,
        sectionKey: `section:${index}`,
        status: "modified",
        targetPath: path,
      },
    ],
    status: "modified",
  };
}

const entries = [
  entry(0, "crates/client-sessions/src/a.ts"),
  entry(1, "crates/editor/src/view/layout/b.ts"),
];

const labels = {
  committed: "Changed Files",
  conflict: "Merge Changes",
  staged: "Staged Changes",
  unstaged: "Changes",
};

const notificationError = vi.fn();

function pluginContext(): RendererPluginContext {
  return {
    actions: {
      register: (action: Parameters<typeof actionRegistry.register>[0]) =>
        actionRegistry.register(action),
    },
    dialogs: {
      alert: vi.fn(async () => undefined),
      choice: vi.fn(async () => "cancel"),
      confirm: vi.fn(async () => false),
    },
    files: {
      openInEditor: vi.fn(() => true),
      openProjectDirectory: vi.fn(async () => ({
        instanceId: "files",
        ok: true,
        reused: false,
      })),
    },
    git: {
      applyReviewPathMutation: vi.fn(async () => ({
        kind: "ok" as const,
        operationId: "operation:path",
      })),
      stage: vi.fn(async () => true),
      unstage: vi.fn(async () => true),
    },
    i18n: {
      t: (_key: string, _values?: unknown, fallback?: string) => fallback ?? "",
    },
    notifications: {
      error: notificationError,
      info: vi.fn(),
      loading: vi.fn(() => ({ dismiss: vi.fn() })),
      success: vi.fn(),
    },
    panels: { getActiveInstanceId: () => "panel-a" },
  } as unknown as RendererPluginContext;
}

function reviewModel() {
  return gitReviewTreeModel(entries, (name) => name, labels, {
    expectedIndexRevision: null,
    uncommitted: true,
  });
}

function treeRows(container: HTMLElement): string[] {
  const host = container.querySelector(
    'file-tree-container[data-slot="pier-file-tree"]'
  );
  const root = host?.shadowRoot;
  if (!root) {
    return [];
  }
  return [...root.querySelectorAll("[role='treeitem'][data-item-path]")].map(
    (row) => row.getAttribute("data-item-path") ?? ""
  );
}

describe("git review Expand Folders", () => {
  let disposeActions: (() => void) | undefined;

  beforeEach(() => {
    actionRegistry.clearForTests();
    notificationError.mockClear();
    disposeActions = registerGitReviewTreeActions(pluginContext());
  });

  afterEach(() => {
    disposeActions?.();
    disposeActions = undefined;
    actionRegistry.clearForTests();
  });

  it("expands the subtree under the right-clicked folder", async () => {
    const treeModel = reviewModel();
    const groupRoot = treeModel.getGroupRootPath("unstaged") as string;
    const view = render(
      <TooltipProvider>
        <GitReviewPanelLayout
          context={pluginContext()}
          contextId="ctx-expand"
          gitRootPath="/repo"
          onOpenPath={() => undefined}
          setSidebarCollapsed={() => undefined}
          sidebarCollapsed={false}
          sourcePanelId="panel-a"
          treeModel={treeModel}
        >
          <div />
        </GitReviewPanelLayout>
      </TooltipProvider>
    );
    await waitFor(() =>
      expect(treeRows(view.container).length).toBeGreaterThan(0)
    );

    await act(async () => {
      await collapseGitReviewTreeFolders(`${groupRoot}/crates`, {
        contextId: "ctx-expand",
        panelId: "panel-a",
      });
    });
    await waitFor(() =>
      expect(treeRows(view.container)).not.toContain(
        `${groupRoot}/crates/client-sessions/src/a.ts`
      )
    );

    const expand = actionRegistry.get(EXPAND_ALL_ID);
    await act(async () => {
      await expand?.handler({
        metadata: {
          contextId: "ctx-expand",
          gitRootPath: "/repo",
          kind: "directory",
          path: `${groupRoot}/crates`,
        },
        sourcePanelId: "panel-a",
        surface: GIT_REVIEW_TREE_ITEM_SURFACE,
      });
    });

    await waitFor(() =>
      expect(treeRows(view.container)).toContain(
        `${groupRoot}/crates/client-sessions/src/a.ts`
      )
    );
    expect(notificationError).not.toHaveBeenCalled();
  });

  it("collapses the subtree under the right-clicked folder", async () => {
    const treeModel = reviewModel();
    const groupRoot = treeModel.getGroupRootPath("unstaged") as string;
    const deepPath = `${groupRoot}/crates/client-sessions/src/a.ts`;
    const view = render(
      <TooltipProvider>
        <GitReviewPanelLayout
          context={pluginContext()}
          contextId="ctx-collapse"
          gitRootPath="/repo"
          onOpenPath={() => undefined}
          setSidebarCollapsed={() => undefined}
          sidebarCollapsed={false}
          sourcePanelId="panel-a"
          treeModel={treeModel}
        >
          <div />
        </GitReviewPanelLayout>
      </TooltipProvider>
    );
    await waitFor(() =>
      expect(treeRows(view.container).length).toBeGreaterThan(0)
    );
    expect(treeRows(view.container)).toContain(deepPath);

    const collapse = actionRegistry.get(COLLAPSE_ALL_ID);
    await act(async () => {
      await collapse?.handler({
        metadata: {
          contextId: "ctx-collapse",
          gitRootPath: "/repo",
          kind: "directory",
          path: `${groupRoot}/crates`,
        },
        sourcePanelId: "panel-a",
        surface: GIT_REVIEW_TREE_ITEM_SURFACE,
      });
    });

    await waitFor(() =>
      expect(treeRows(view.container)).not.toContain(deepPath)
    );
    expect(notificationError).not.toHaveBeenCalled();
  });

  it("re-expands a nested folder collapsed inside the right-clicked folder", async () => {
    const treeModel = reviewModel();
    const groupRoot = treeModel.getGroupRootPath("unstaged") as string;
    const deepPath = `${groupRoot}/crates/client-sessions/src/a.ts`;
    const view = render(
      <TooltipProvider>
        <GitReviewPanelLayout
          context={pluginContext()}
          contextId="ctx-reexpand"
          gitRootPath="/repo"
          onOpenPath={() => undefined}
          setSidebarCollapsed={() => undefined}
          sidebarCollapsed={false}
          sourcePanelId="panel-a"
          treeModel={treeModel}
        >
          <div />
        </GitReviewPanelLayout>
      </TooltipProvider>
    );
    await waitFor(() =>
      expect(treeRows(view.container).length).toBeGreaterThan(0)
    );
    expect(treeRows(view.container)).toContain(deepPath);

    await act(async () => {
      await collapseGitReviewTreeFolders(
        `${groupRoot}/crates/client-sessions`,
        { contextId: "ctx-reexpand", panelId: "panel-a" }
      );
    });
    await waitFor(() =>
      expect(treeRows(view.container)).not.toContain(deepPath)
    );

    const expand = actionRegistry.get(EXPAND_ALL_ID);
    await act(async () => {
      await expand?.handler({
        metadata: {
          contextId: "ctx-reexpand",
          gitRootPath: "/repo",
          kind: "directory",
          path: `${groupRoot}/crates`,
        },
        sourcePanelId: "panel-a",
        surface: GIT_REVIEW_TREE_ITEM_SURFACE,
      });
    });

    // Subtree expand clears the collapse intent under the clicked folder; a
    // whole-tree expand would honour it and leave this folder closed.
    await waitFor(() => expect(treeRows(view.container)).toContain(deepPath));
  });

  it("drives the tree that owns the invocation, not the latest mounted one", async () => {
    const modelA = reviewModel();
    const modelB = reviewModel();
    const groupRoot = modelA.getGroupRootPath("unstaged") as string;
    const deepPath = `${groupRoot}/crates/client-sessions/src/a.ts`;

    const viewA = render(
      <TooltipProvider>
        <GitReviewPanelLayout
          context={pluginContext()}
          contextId="ctx-shared"
          gitRootPath="/repo"
          onOpenPath={() => undefined}
          setSidebarCollapsed={() => undefined}
          sidebarCollapsed={false}
          sourcePanelId="panel-a"
          treeModel={modelA}
        >
          <div />
        </GitReviewPanelLayout>
      </TooltipProvider>
    );
    await waitFor(() =>
      expect(treeRows(viewA.container).length).toBeGreaterThan(0)
    );
    await act(async () => {
      await collapseGitReviewTreeFolders(`${groupRoot}/crates`, {
        contextId: "ctx-shared",
        panelId: "panel-a",
      });
    });
    await waitFor(() =>
      expect(treeRows(viewA.container)).not.toContain(deepPath)
    );

    // A second review tree mounts later for the same scope (split panel).
    const viewB = render(
      <TooltipProvider>
        <GitReviewPanelLayout
          context={pluginContext()}
          contextId="ctx-shared"
          gitRootPath="/repo"
          onOpenPath={() => undefined}
          setSidebarCollapsed={() => undefined}
          sidebarCollapsed={false}
          sourcePanelId="panel-b"
          treeModel={modelB}
        >
          <div />
        </GitReviewPanelLayout>
      </TooltipProvider>
    );
    await waitFor(() =>
      expect(treeRows(viewB.container).length).toBeGreaterThan(0)
    );
    await act(async () => {
      await collapseGitReviewTreeFolders(`${groupRoot}/crates`, {
        contextId: "ctx-shared",
        panelId: "panel-b",
      });
    });
    await waitFor(() =>
      expect(treeRows(viewB.container)).not.toContain(deepPath)
    );

    const expand = actionRegistry.get(EXPAND_ALL_ID);
    await act(async () => {
      await expand?.handler({
        metadata: {
          contextId: "ctx-shared",
          gitRootPath: "/repo",
          kind: "directory",
          path: `${groupRoot}/crates`,
        },
        sourcePanelId: "panel-a",
        surface: GIT_REVIEW_TREE_ITEM_SURFACE,
      });
    });

    await waitFor(() => expect(treeRows(viewA.container)).toContain(deepPath));
    expect(treeRows(viewB.container)).not.toContain(deepPath);
  });

  it("reports when no review tree is mounted instead of doing nothing", async () => {
    for (const id of [EXPAND_ALL_ID, COLLAPSE_ALL_ID]) {
      const action = actionRegistry.get(id);
      await act(async () => {
        await action?.handler({
          metadata: {
            contextId: "ctx-missing",
            gitRootPath: "/repo",
            kind: "directory",
            path: "\u0003Changes/crates",
          },
          surface: GIT_REVIEW_TREE_ITEM_SURFACE,
        });
      });
    }
    expect(notificationError).toHaveBeenCalledTimes(2);
    expect(notificationError).toHaveBeenLastCalledWith(
      "The changed files tree isn't shown. Show it first."
    );
  });

  it("keeps a single mounted tree working without an owner", async () => {
    const treeModel = reviewModel();
    const groupRoot = treeModel.getGroupRootPath("unstaged") as string;
    const view = render(
      <TooltipProvider>
        <GitReviewPanelLayout
          context={pluginContext()}
          contextId="ctx-solo"
          gitRootPath="/repo"
          onOpenPath={() => undefined}
          setSidebarCollapsed={() => undefined}
          sidebarCollapsed={false}
          treeModel={treeModel}
        >
          <div />
        </GitReviewPanelLayout>
      </TooltipProvider>
    );
    await waitFor(() =>
      expect(treeRows(view.container).length).toBeGreaterThan(0)
    );
    await act(async () => {
      await collapseGitReviewTreeFolders(`${groupRoot}/crates`, {
        contextId: "ctx-solo",
      });
    });
    await waitFor(() =>
      expect(treeRows(view.container)).not.toContain(
        `${groupRoot}/crates/client-sessions/src/a.ts`
      )
    );

    await act(async () => {
      expect(await expandGitReviewTreeFolders(`${groupRoot}/crates`)).toBe(
        true
      );
    });
    await waitFor(() =>
      expect(treeRows(view.container)).toContain(
        `${groupRoot}/crates/client-sessions/src/a.ts`
      )
    );
  });
});

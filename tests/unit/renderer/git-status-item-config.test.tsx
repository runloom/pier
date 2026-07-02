import type {
  RendererPluginContext,
  RendererTerminalStatusItem,
} from "@plugins/api/renderer.ts";
import { registerGitStatusItem } from "@plugins/builtin/git/renderer/git-status-item.tsx";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const DIRTY_STATUS = {
  branch: { ahead: 0, behind: 0, branch: "main", upstream: null },
  counts: { conflict: 0, modified: 2, staged: 1, untracked: 0 },
  delta: { deletions: 3, insertions: 5 },
  repoState: { kind: "clean" },
  stashCount: 0,
};

function makeContext(showDirtyIndicator: boolean): {
  context: RendererPluginContext;
  registered: () => RendererTerminalStatusItem;
} {
  let item: RendererTerminalStatusItem | undefined;
  const context = {
    configuration: {
      get: <T,>(key: string): T => {
        if (key === "pier.git.statusItem.showDirtyIndicator") {
          return showDirtyIndicator as unknown as T;
        }
        return undefined as unknown as T;
      },
      onDidChange: vi.fn(() => () => undefined),
      reset: vi.fn(),
      set: vi.fn(),
    },
    git: {
      getStatus: vi.fn(() => Promise.resolve(DIRTY_STATUS)),
      watch: vi.fn(() => () => undefined),
    },
    i18n: {
      commandDescription: () => undefined,
      commandTitle: (id: string) => id,
      language: () => "en",
      t: (_key: string, _values?: unknown, fallback = "") => fallback,
    },
    terminalStatusItems: {
      register: (registration: RendererTerminalStatusItem) => {
        item = registration;
        return () => undefined;
      },
    },
  } as unknown as RendererPluginContext;
  return {
    context,
    registered: () => {
      if (!item) {
        throw new Error("status item not registered");
      }
      return item;
    },
  };
}

const PANEL_CONTEXT = {
  branch: "main",
  gitRoot: "/repo",
  worktreeRoot: "/repo",
} as unknown as PanelContext;

describe("git status item — showDirtyIndicator 设置消费", () => {
  afterEach(() => {
    cleanup();
  });

  async function renderItem(showDirtyIndicator: boolean) {
    const { context, registered } = makeContext(showDirtyIndicator);
    registerGitStatusItem(context);
    render(
      registered().render({
        context: PANEL_CONTEXT,
        cwd: "/repo",
        panelId: "panel-1",
        title: null,
      })
    );
    await waitFor(() => {
      expect(screen.getByTestId("worktree-status-trigger")).toBeInTheDocument();
    });
  }

  it("默认 true：渲染 dirty indicator", async () => {
    await renderItem(true);
    await waitFor(() => {
      expect(screen.getByTestId("git-dirty-indicator")).toBeInTheDocument();
    });
  });

  it("false：dirty indicator 隐藏，其余状态项内容保留", async () => {
    await renderItem(false);
    await waitFor(() => {
      expect(screen.getByText("main")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("git-dirty-indicator")).toBeNull();
  });
});

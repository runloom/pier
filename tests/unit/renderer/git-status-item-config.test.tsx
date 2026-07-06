import type {
  RendererPluginContext,
  RendererTerminalStatusItem,
} from "@plugins/api/renderer.ts";
import { registerGitStatusItem } from "@plugins/builtin/git/renderer/git-status-item.tsx";
import { RepoStatePill } from "@plugins/builtin/git/renderer/git-status-parts.tsx";
import type { PanelContext } from "@shared/contracts/panel.ts";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const DIRTY_STATUS = {
  branch: { ahead: 0, behind: 0, branch: "main", upstream: null },
  counts: { conflict: 0, modified: 2, staged: 1, untracked: 0 },
  delta: { deletions: 3, insertions: 5 },
  repoState: { kind: "clean" },
  stashCount: 0,
};

function makeContext(
  showDirtyIndicator: boolean,
  getStatus: () => Promise<typeof DIRTY_STATUS> = () =>
    Promise.resolve(DIRTY_STATUS)
): {
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
      getStatus: vi.fn(getStatus),
      watch: vi.fn(() => () => undefined),
    },
    i18n: {
      commandDescription: () => undefined,
      commandTitle: (id: string) => id,
      language: () => "en",
      t: vi.fn((_key: string, _values?: unknown, fallback = "") => fallback),
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

  it("左键打开 Git 状态下拉面板", async () => {
    await renderItem(true);

    fireEvent.pointerDown(screen.getByTestId("worktree-status-trigger"), {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });

    expect(
      await screen.findByRole("menuitem", { name: "Open Git Changes" })
    ).toBeInTheDocument();
  });

  it("Git 状态未加载完成时下拉不显示 clean", async () => {
    const { context, registered } = makeContext(
      true,
      () => new Promise<typeof DIRTY_STATUS>(() => undefined)
    );
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

    fireEvent.pointerDown(screen.getByTestId("worktree-status-trigger"), {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });

    expect(await screen.findByText("Loading Git status…")).toBeInTheDocument();
    expect(screen.queryByText("No local changes")).toBeNull();
  });

  it("Git 状态加载失败时下拉显示不可用而不是 clean", async () => {
    const { context, registered } = makeContext(true, () =>
      Promise.reject(new Error("git failed"))
    );
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
      expect(context.git.getStatus).toHaveBeenCalled();
    });

    fireEvent.pointerDown(screen.getByTestId("worktree-status-trigger"), {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });

    expect(
      await screen.findByText("Git status unavailable")
    ).toBeInTheDocument();
    expect(screen.queryByText("No local changes")).toBeNull();
  });

  it("repo state 胶囊使用单数冲突文案", () => {
    const { context } = makeContext(true);
    vi.mocked(context.i18n.t).mockImplementation(
      (
        key: string,
        values?: Record<string, number | string>,
        fallback = ""
      ) => {
        if (key === "ui.conflictSuffixSingle") {
          return ` · ${values?.n} conflict`;
        }
        if (key === "ui.conflictSuffix") {
          return ` · ${values?.n} conflicts`;
        }
        return fallback;
      }
    );

    render(
      <RepoStatePill
        pluginContext={context}
        state={{ conflictCount: 1, kind: "merging" }}
      />
    );

    expect(screen.getByText("MERGING · 1 conflict")).toBeInTheDocument();
    expect(screen.queryByText("MERGING · 1 conflicts")).toBeNull();
  });

  it.each([
    [
      "bisecting",
      { bad: 1, good: 2, kind: "bisecting" as const },
      "git-compare-arrows",
    ],
    [
      "cherry-picking",
      { conflictCount: 0, kind: "cherry-picking" as const },
      "git-commit-horizontal",
    ],
    ["merging", { conflictCount: 0, kind: "merging" as const }, "git-merge"],
    [
      "rebasing",
      { conflictCount: 0, current: 1, kind: "rebasing" as const, total: 3 },
      "git-pull-request-arrow",
    ],
    [
      "reverting",
      { conflictCount: 0, kind: "reverting" as const },
      "git-commit-horizontal",
    ],
  ])("repo state %s 胶囊使用 Git 图标族", (_name, state, iconName) => {
    const { context } = makeContext(true);

    const { container } = render(
      <RepoStatePill pluginContext={context} state={state} />
    );

    expect(
      container.querySelector(`[data-git-icon="${iconName}"]`)
    ).toBeInTheDocument();
  });
});

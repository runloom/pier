import type {
  RendererPluginContext,
  RendererTerminalStatusItem,
} from "@plugins/api/renderer.ts";
import { openGitChangesPanel } from "@plugins/builtin/git/renderer/git-review-open.ts";
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
  openInstance: ReturnType<typeof vi.fn>;
  registered: () => RendererTerminalStatusItem;
} {
  let item: RendererTerminalStatusItem | undefined;
  const openInstance = vi.fn(() => ({ kind: "opened" as const }));
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
    dialogs: { alert: vi.fn(async () => undefined) },
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
    notifications: { error: vi.fn() },
    panels: { listInstances: vi.fn(() => []), openInstance },
    terminalStatusItems: {
      register: (registration: RendererTerminalStatusItem) => {
        item = registration;
        return () => undefined;
      },
    },
  } as unknown as RendererPluginContext;
  return {
    context,
    openInstance,
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
  contextId: "worktree:repo",
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
        getGroupId: () => null,
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
      await screen.findByRole("menuitem", { name: "Switch Worktree" })
    ).toBeInTheDocument();
  });

  it("查看变更在点击时读取当前组，组消失时只向新当前组重试一次", async () => {
    const { context, openInstance, registered } = makeContext(true);
    let currentGroupId = "group-a";
    openInstance.mockImplementation(
      (input: { targetGroupId?: string } = {}) => {
        if (input.targetGroupId === "group-b") {
          currentGroupId = "group-c";
          return { kind: "targetGroupMissing" as const };
        }
        return { kind: "opened" as const };
      }
    );
    registerGitStatusItem(context);
    render(
      registered().render({
        context: PANEL_CONTEXT,
        cwd: "/repo",
        getGroupId: () => currentGroupId,
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
    currentGroupId = "group-b";
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "View Changes" })
    );

    expect(
      openInstance.mock.calls.map(([input]) => input.targetGroupId)
    ).toEqual(["group-b", "group-c"]);
    expect(context.notifications.error).not.toHaveBeenCalled();
  });

  it("Review 拖组后按实际分组复用，并为原分组生成不冲突实例", () => {
    const { context, openInstance } = makeContext(true);
    const movedInstance = {
      componentId: "pier.git.changes",
      groupId: "group-b",
      id: "pier.git.changes:group-a:worktree:repo",
      params: {
        source: { contextId: "worktree:repo", gitRootPath: "/repo" },
      },
      title: "Changes",
    };
    vi.mocked(context.panels.listInstances).mockReturnValue([movedInstance]);

    openGitChangesPanel({
      getGroupId: () => "group-b",
      panelContext: PANEL_CONTEXT,
      pluginContext: context,
    });
    expect(openInstance.mock.calls.at(-1)?.[0]).toMatchObject({
      instanceId: movedInstance.id,
      targetGroupId: "group-b",
    });

    openGitChangesPanel({
      getGroupId: () => "group-a",
      panelContext: PANEL_CONTEXT,
      pluginContext: context,
    });
    const originalGroupRequest = openInstance.mock.calls.at(-1)?.[0];
    expect(originalGroupRequest).toMatchObject({ targetGroupId: "group-a" });
    expect(originalGroupRequest.instanceId).toMatch(
      /^pier\.git\.changes:group-a:worktree:repo:/u
    );
  });

  it("Review 打开异常通过宿主弹窗提供技术详情", async () => {
    const { context, openInstance } = makeContext(true);
    openInstance.mockImplementation(() => {
      throw new Error("target group mismatch");
    });

    openGitChangesPanel({
      getGroupId: () => "group-a",
      panelContext: PANEL_CONTEXT,
      pluginContext: context,
    });

    await waitFor(() => {
      expect(context.dialogs.alert).toHaveBeenCalledWith({
        body: "target group mismatch",
        title: "Failed to open changes",
      });
    });
    expect(context.notifications.error).not.toHaveBeenCalled();
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
        getGroupId: () => null,
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
        getGroupId: () => null,
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

  it("Git 状态首次瞬时失败后会在无文件事件时自动恢复", async () => {
    const getStatus = vi
      .fn()
      .mockRejectedValueOnce(new Error("git temporarily unavailable"))
      .mockResolvedValue(DIRTY_STATUS);
    const { context, registered } = makeContext(true, getStatus);
    registerGitStatusItem(context);
    render(
      registered().render({
        context: PANEL_CONTEXT,
        cwd: "/repo",
        getGroupId: () => null,
        panelId: "panel-1",
        title: null,
      })
    );

    await waitFor(() => expect(getStatus).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId("git-dirty-indicator")).toBeVisible();
  });

  it("watch START 失败后重建订阅并继续消费 Git 事件", async () => {
    const { context, registered } = makeContext(true);
    const recoveredListeners: Array<() => void> = [];
    vi.mocked(context.git.watch)
      .mockImplementationOnce((_root, _listener, onStartFailure) => {
        onStartFailure?.(new Error("watch start failed"));
        return () => undefined;
      })
      .mockImplementation((_root, listener) => {
        recoveredListeners.push(() =>
          listener({
            changeKind: "worktree",
            gitRoot: "/repo",
          })
        );
        return () => undefined;
      });
    registerGitStatusItem(context);
    render(
      registered().render({
        context: PANEL_CONTEXT,
        cwd: "/repo",
        getGroupId: () => null,
        panelId: "panel-1",
        title: null,
      })
    );

    await waitFor(() => expect(context.git.watch).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(context.git.getStatus).toHaveBeenCalledOnce());
    recoveredListeners[0]?.();
    await waitFor(() => expect(context.git.getStatus).toHaveBeenCalledTimes(2));
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

    expect(screen.getByText("Merging · 1 conflict")).toBeInTheDocument();
    expect(screen.queryByText("Merging · 1 conflicts")).toBeNull();
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

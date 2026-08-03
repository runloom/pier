import type {
  RendererPluginContext,
  RendererTerminalStatusItem,
} from "@plugins/api/renderer.ts";
import { openGitChangesPanel } from "@plugins/builtin/git/renderer/review/open.ts";
import { registerGitStatusItem } from "@plugins/builtin/git/renderer/status-item.tsx";
import { resetGitStatusSessionsForTests } from "@plugins/builtin/git/renderer/status-state.ts";
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
  changeSummary: {
    changedFiles: 3,
    deletions: 3,
    excludedFiles: 0,
    insertions: 5,
    kind: "lineDelta" as const,
  },
  counts: { conflict: 0, modified: 2, staged: 1, untracked: 0 },
  repoState: { kind: "clean" },
  stashCount: 0,
};

function makeContext(
  showDirtyIndicator: boolean,
  getStatus: () => Promise<unknown> = () => Promise.resolve(DIRTY_STATUS),
  options: {
    showChangesStatus?: boolean;
    showSyncStatus?: boolean;
  } = {}
): {
  context: RendererPluginContext;
  openInstance: ReturnType<typeof vi.fn>;
  registered: () => RendererTerminalStatusItem[];
} {
  const showChangesStatus = options.showChangesStatus ?? true;
  const showSyncStatus = options.showSyncStatus ?? true;
  const items: RendererTerminalStatusItem[] = [];
  const openInstance = vi.fn(() => ({ kind: "opened" as const }));
  const context = {
    configuration: {
      get: <T,>(key: string): T => {
        if (key === "pier.git.statusItem.showDirtyIndicator") {
          return showDirtyIndicator as unknown as T;
        }
        if (key === "pier.git.statusItem.showChangesStatus") {
          return showChangesStatus as unknown as T;
        }
        if (key === "pier.git.statusItem.showSyncStatus") {
          return showSyncStatus as unknown as T;
        }
        if (key === "pier.git.statusItem.confirmSync") {
          return true as unknown as T;
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
      t: vi.fn((_key: string, values?: unknown, fallback = "") => {
        let text = fallback;
        if (values && typeof values === "object") {
          for (const [key, value] of Object.entries(values)) {
            text = text.replaceAll(`{{${key}}}`, String(value));
          }
        }
        return text;
      }),
    },
    notifications: { error: vi.fn() },
    panels: {
      listInstances: vi.fn(() => []),
      listInstancesGlobal: vi.fn(async () => []),
      focusInstance: vi.fn(async () => ({ kind: "focused" as const })),
      openInstance,
    },
    terminalStatusItems: {
      register: (registration: RendererTerminalStatusItem) => {
        items.push(registration);
        return () => undefined;
      },
    },
  } as unknown as RendererPluginContext;
  return {
    context,
    openInstance,
    registered: () => {
      if (items.length === 0) {
        throw new Error("status item not registered");
      }
      return items;
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
    resetGitStatusSessionsForTests();
  });

  function renderRegistered(
    items: RendererTerminalStatusItem[],
    statusContext: {
      context: PanelContext;
      cwd: string;
      getGroupId: () => string | null;
      panelId: string;
      title: null;
    }
  ) {
    return render(
      items.map((item) => <div key={item.id}>{item.render(statusContext)}</div>)
    );
  }

  async function renderItem(showDirtyIndicator: boolean) {
    const { context, registered } = makeContext(showDirtyIndicator);
    registerGitStatusItem(context);
    renderRegistered(registered(), {
      context: PANEL_CONTEXT,
      cwd: "/repo",
      getGroupId: () => null,
      panelId: "panel-1",
      title: null,
    });
    await waitFor(() => {
      expect(screen.getByTestId("worktree-status-trigger")).toBeInTheDocument();
    });
  }

  it("默认 true：脏态编码为分支图标变体，语义色在分支名文字上", async () => {
    await renderItem(true);
    await waitFor(() => {
      expect(screen.getByTestId("git-dirty-indicator")).toBeInTheDocument();
    });
    const dirtyIndicator = screen.getByTestId("git-dirty-indicator");
    const stagedIcon = dirtyIndicator.querySelector(
      '[data-git-icon="git-branch-staged"]'
    );
    expect(stagedIcon).toBeInTheDocument();
    expect(stagedIcon).not.toHaveClass("text-success");
    const branchTrigger = screen.getByTestId("worktree-status-trigger");
    expect(branchTrigger.querySelector("span.truncate")).toHaveClass(
      "text-success"
    );
    expect(branchTrigger.querySelector("span.truncate")).toHaveTextContent(
      "main"
    );
  });

  it("false：不编码脏图标，分支名仍保留", async () => {
    await renderItem(false);
    await waitFor(() => {
      expect(screen.getByText("main")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("git-dirty-indicator")).toBeNull();
    expect(
      screen
        .getByTestId("worktree-status-trigger")
        .querySelector('[data-git-icon="git-branch"]')
    ).toBeInTheDocument();
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

  it("更改项显示彩色 ± 行并点击打开审查面板", async () => {
    const { context, openInstance, registered } = makeContext(true);
    registerGitStatusItem(context);
    renderRegistered(registered(), {
      context: PANEL_CONTEXT,
      cwd: "/repo",
      getGroupId: () => "group-a",
      panelId: "panel-1",
      title: null,
    });
    const changesTrigger = await screen.findByTestId(
      "git-changes-status-trigger"
    );
    expect(changesTrigger).toHaveTextContent("+5");
    expect(changesTrigger).toHaveTextContent("−3");
    expect(
      changesTrigger.querySelector('[data-git-delta="insertions"]')
    ).toHaveTextContent("+5");
    expect(
      changesTrigger.querySelector('[data-git-delta="deletions"]')
    ).toHaveTextContent("−3");
    fireEvent.click(changesTrigger);
    await waitFor(() => {
      expect(openInstance).toHaveBeenCalledWith(
        expect.objectContaining({
          componentId: "pier.git.changes",
          targetGroupId: "group-a",
          title: "repo",
        })
      );
    });
  });

  it("行统计不完整时显示带单位的文件数，不展示部分增删行", async () => {
    const filesOnly = {
      ...DIRTY_STATUS,
      changeSummary: {
        changedFiles: 2,
        kind: "filesOnly" as const,
        omittedFiles: 1,
        reasons: ["invalidEncoding" as const],
      },
      // 同一文件可同时计入 modified 与 staged；展示不能把分类数直接相加。
      counts: { conflict: 0, modified: 2, staged: 1, untracked: 0 },
    };
    const { context, registered } = makeContext(true, () =>
      Promise.resolve(filesOnly)
    );
    registerGitStatusItem(context);
    renderRegistered(registered(), {
      context: PANEL_CONTEXT,
      cwd: "/repo",
      getGroupId: () => null,
      panelId: "panel-1",
      title: null,
    });

    const changesTrigger = await screen.findByTestId(
      "git-changes-status-trigger"
    );
    expect(changesTrigger).toHaveTextContent("2 files");
    expect(changesTrigger).not.toHaveTextContent("+");
    expect(changesTrigger).not.toHaveTextContent("−");
    expect(changesTrigger).toHaveAttribute(
      "aria-label",
      expect.stringContaining("2 changed files")
    );
    expect(changesTrigger.querySelector("[title]")).toHaveAttribute(
      "title",
      "Line totals are incomplete. Showing the changed file count."
    );
    expect(
      changesTrigger.querySelector('[data-git-icon="git-changes"]')
    ).not.toBeNull();
  });

  it("完整行统计始终同时显示新增和删除两侧的零值", async () => {
    const { context, registered } = makeContext(true, () =>
      Promise.resolve({
        ...DIRTY_STATUS,
        changeSummary: {
          changedFiles: 1,
          deletions: 3,
          excludedFiles: 0,
          insertions: 0,
          kind: "lineDelta" as const,
        },
      })
    );
    registerGitStatusItem(context);
    renderRegistered(registered(), {
      context: PANEL_CONTEXT,
      cwd: "/repo",
      getGroupId: () => null,
      panelId: "panel-1",
      title: null,
    });

    const changesTrigger = await screen.findByTestId(
      "git-changes-status-trigger"
    );
    expect(
      changesTrigger.querySelector('[data-git-delta="insertions"]')
    ).toHaveTextContent("+0");
    expect(
      changesTrigger.querySelector('[data-git-delta="deletions"]')
    ).toHaveTextContent("−3");
  });

  it("全 excluded 的 lineDelta 不展示 +0 −0，改为带单位文件数", async () => {
    const { context, registered } = makeContext(true, () =>
      Promise.resolve({
        ...DIRTY_STATUS,
        changeSummary: {
          changedFiles: 2,
          deletions: 0,
          excludedFiles: 2,
          insertions: 0,
          kind: "lineDelta" as const,
        },
      })
    );
    registerGitStatusItem(context);
    renderRegistered(registered(), {
      context: PANEL_CONTEXT,
      cwd: "/repo",
      getGroupId: () => null,
      panelId: "panel-1",
      title: null,
    });

    const changesTrigger = await screen.findByTestId(
      "git-changes-status-trigger"
    );
    expect(changesTrigger).toHaveTextContent("2 files");
    expect(
      changesTrigger.querySelector('[data-git-delta="files"]')
    ).not.toBeNull();
    expect(
      changesTrigger.querySelector('[data-git-delta="insertions"]')
    ).toBeNull();
    expect(changesTrigger).toHaveAttribute(
      "aria-label",
      expect.stringContaining("2 files excluded from line totals")
    );
  });

  it("showChangesStatus=false 时隐藏更改项且 isVisible 为 false", async () => {
    const { context, registered } = makeContext(
      true,
      () => Promise.resolve(DIRTY_STATUS),
      { showChangesStatus: false }
    );
    registerGitStatusItem(context);
    const changesItem = registered().find(
      (item) => item.id === "pier.git.status.changes"
    );
    expect(
      changesItem?.isVisible?.({
        context: PANEL_CONTEXT,
        cwd: "/repo",
        getGroupId: () => null,
        panelId: "panel-1",
        title: null,
      })
    ).toBe(false);
    renderRegistered(registered(), {
      context: PANEL_CONTEXT,
      cwd: "/repo",
      getGroupId: () => null,
      panelId: "panel-1",
      title: null,
    });
    await waitFor(() => {
      expect(screen.getByTestId("worktree-status-trigger")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("git-changes-status-trigger")).toBeNull();
  });

  it("干净仓库不渲染更改项空壳", async () => {
    const clean = {
      ...DIRTY_STATUS,
      changeSummary: {
        changedFiles: 0,
        deletions: 0,
        excludedFiles: 0,
        insertions: 0,
        kind: "lineDelta" as const,
      },
      counts: { conflict: 0, modified: 0, staged: 0, untracked: 0 },
    };
    const { context, registered } = makeContext(true, () =>
      Promise.resolve(clean)
    );
    registerGitStatusItem(context);
    renderRegistered(registered(), {
      context: PANEL_CONTEXT,
      cwd: "/repo",
      getGroupId: () => null,
      panelId: "panel-1",
      title: null,
    });
    await waitFor(() => {
      expect(screen.getByTestId("worktree-status-trigger")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("git-changes-status-trigger")).toBeNull();
  });

  it("干净仓库从状态菜单查看变更会在当前组打开未提交变更", async () => {
    const clean = {
      ...DIRTY_STATUS,
      changeSummary: {
        changedFiles: 0,
        deletions: 0,
        excludedFiles: 0,
        insertions: 0,
        kind: "lineDelta" as const,
      },
      counts: { conflict: 0, modified: 0, staged: 0, untracked: 0 },
    };
    const { context, openInstance, registered } = makeContext(true, () =>
      Promise.resolve(clean)
    );
    registerGitStatusItem(context);
    renderRegistered(registered(), {
      context: PANEL_CONTEXT,
      cwd: "/repo",
      getGroupId: () => "group-a",
      panelId: "panel-1",
      title: null,
    });
    await screen.findByTestId("worktree-status-trigger");

    fireEvent.pointerDown(screen.getByTestId("worktree-status-trigger"), {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "View Changes" })
    );

    await waitFor(() => {
      expect(openInstance).toHaveBeenCalledWith(
        expect.objectContaining({
          componentId: "pier.git.changes",
          targetGroupId: "group-a",
          params: expect.objectContaining({
            source: expect.objectContaining({
              target: { kind: "uncommitted" },
            }),
          }),
        })
      );
    });
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
    renderRegistered(registered(), {
      context: PANEL_CONTEXT,
      cwd: "/repo",
      getGroupId: () => currentGroupId,
      panelId: "panel-1",
      title: null,
    });
    await waitFor(() => {
      expect(screen.getByTestId("worktree-status-trigger")).toBeInTheDocument();
    });

    fireEvent.pointerDown(screen.getByTestId("worktree-status-trigger"), {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
    currentGroupId = "group-b";
    fireEvent.click(await screen.findByRole("menuitem", { name: /^Changes/ }));

    await waitFor(() => {
      expect(
        openInstance.mock.calls.map(([input]) => input.targetGroupId)
      ).toEqual(["group-b", "group-c"]);
    });
    expect(context.notifications.error).not.toHaveBeenCalled();
  });

  it("Review 已打开时聚焦已有 tab，跨组不重复新建", async () => {
    const { context, openInstance } = makeContext(true);
    const movedInstance = {
      componentId: "pier.git.changes",
      groupId: "group-b",
      id: "pier.git.changes:group-a:worktree:repo",
      params: {
        source: {
          contextId: "worktree:repo",
          gitRootPath: "/repo",
          target: { kind: "uncommitted" },
        },
      },
      title: "Changes",
    };
    vi.mocked(context.panels.listInstances).mockReturnValue([movedInstance]);

    await openGitChangesPanel({
      getGroupId: () => "group-b",
      panelContext: PANEL_CONTEXT,
      pluginContext: context,
    });
    expect(openInstance.mock.calls.at(-1)?.[0]).toMatchObject({
      instanceId: movedInstance.id,
      targetGroupId: "group-b",
    });

    await openGitChangesPanel({
      getGroupId: () => "group-a",
      panelContext: PANEL_CONTEXT,
      pluginContext: context,
    });
    expect(openInstance.mock.calls.at(-1)?.[0]).toMatchObject({
      instanceId: movedInstance.id,
      targetGroupId: "group-b",
    });
    expect(openInstance).toHaveBeenCalledTimes(2);
  });

  it("Review 命令面板无 group 时聚焦已打开实例", async () => {
    const { context, openInstance } = makeContext(true);
    const existing = {
      componentId: "pier.git.changes",
      groupId: "group-b",
      id: "review-existing",
      params: {
        source: {
          contextId: "worktree:repo",
          gitRootPath: "/repo",
          target: { kind: "uncommitted" },
        },
      },
      title: "Changes",
    };
    vi.mocked(context.panels.listInstances).mockReturnValue([existing]);

    await openGitChangesPanel({
      getGroupId: () => null,
      panelContext: PANEL_CONTEXT,
      pluginContext: context,
    });

    expect(openInstance).toHaveBeenCalledTimes(1);
    expect(openInstance.mock.calls[0]?.[0]).toMatchObject({
      instanceId: "review-existing",
      targetGroupId: "group-b",
    });
  });

  it("Review 已在其它窗口打开时跨窗口聚焦", async () => {
    const { context, openInstance } = makeContext(true);
    const focusInstance = vi.fn(async () => ({ kind: "focused" as const }));
    context.panels.focusInstance = focusInstance;
    vi.mocked(context.panels.listInstances).mockReturnValue([]);
    vi.mocked(context.panels.listInstancesGlobal).mockResolvedValue([
      {
        componentId: "pier.git.changes",
        groupId: null,
        id: "review-remote",
        title: "Changes",
        windowId: "win-remote",
        params: {
          source: {
            contextId: "worktree:repo",
            gitRootPath: "/repo",
            target: { kind: "uncommitted" },
          },
        },
      },
    ]);

    await openGitChangesPanel({
      getGroupId: () => "group-a",
      panelContext: PANEL_CONTEXT,
      pluginContext: context,
    });

    expect(focusInstance).toHaveBeenCalledWith({
      componentId: "pier.git.changes",
      instanceId: "review-remote",
      windowId: "win-remote",
    });
    expect(openInstance).not.toHaveBeenCalled();
  });

  it("Review focus 在 targetGroupMissing 时回退创建且刷新实例列表", async () => {
    const { context, openInstance } = makeContext(true);
    const stale = {
      componentId: "pier.git.changes",
      // Same preferred group so we take the focus path first.
      groupId: "group-a",
      id: "pier.git.changes:group-a:worktree:repo:uncommitted",
      params: {
        source: {
          contextId: "worktree:repo",
          gitRootPath: "/repo",
          target: { kind: "uncommitted" },
        },
      },
      title: "Changes",
    };
    vi.mocked(context.panels.listInstances)
      .mockReturnValueOnce([stale])
      .mockReturnValueOnce([]);
    openInstance
      .mockReturnValueOnce({ kind: "targetGroupMissing" as const })
      .mockReturnValueOnce({ kind: "opened" as const });

    await openGitChangesPanel({
      getGroupId: () => "group-a",
      panelContext: PANEL_CONTEXT,
      pluginContext: context,
    });

    expect(openInstance).toHaveBeenCalledTimes(2);
    expect(openInstance.mock.calls[0]?.[0]).toMatchObject({
      instanceId: stale.id,
      targetGroupId: "group-a",
    });
    expect(openInstance.mock.calls[1]?.[0]).toMatchObject({
      instanceId: "pier.git.changes:group-a:worktree:repo:uncommitted",
      targetGroupId: "group-a",
    });
  });

  it("Review 同组多实例时优先复用该组实例", async () => {
    const { context, openInstance } = makeContext(true);
    const first = {
      componentId: "pier.git.changes",
      groupId: "group-a",
      id: "review-a",
      params: {
        source: {
          contextId: "worktree:repo",
          gitRootPath: "/repo",
          target: { kind: "uncommitted" },
        },
      },
      title: "Changes",
    };
    const otherGroup = {
      ...first,
      groupId: "group-b",
      id: "review-b",
    };
    vi.mocked(context.panels.listInstances).mockReturnValue([
      otherGroup,
      first,
    ]);

    await openGitChangesPanel({
      getGroupId: () => "group-a",
      panelContext: PANEL_CONTEXT,
      pluginContext: context,
    });

    expect(openInstance.mock.calls.at(-1)?.[0]).toMatchObject({
      instanceId: "review-a",
      targetGroupId: "group-a",
    });
  });

  it("Review 打开异常通过宿主弹窗提供技术详情", async () => {
    const { context, openInstance } = makeContext(true);
    openInstance.mockImplementation(() => {
      throw new Error("target group mismatch");
    });

    await openGitChangesPanel({
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
    renderRegistered(registered(), {
      context: PANEL_CONTEXT,
      cwd: "/repo",
      getGroupId: () => null,
      panelId: "panel-1",
      title: null,
    });
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
    renderRegistered(registered(), {
      context: PANEL_CONTEXT,
      cwd: "/repo",
      getGroupId: () => null,
      panelId: "panel-1",
      title: null,
    });
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
    renderRegistered(registered(), {
      context: PANEL_CONTEXT,
      cwd: "/repo",
      getGroupId: () => null,
      panelId: "panel-1",
      title: null,
    });

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
    renderRegistered(registered(), {
      context: PANEL_CONTEXT,
      cwd: "/repo",
      getGroupId: () => null,
      panelId: "panel-1",
      title: null,
    });

    await waitFor(() => expect(context.git.watch).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(context.git.getStatus).toHaveBeenCalledOnce());
    recoveredListeners[0]?.();
    await waitFor(() => expect(context.git.getStatus).toHaveBeenCalledTimes(2));
  });
});

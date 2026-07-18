import type { MenuItemAction, MenuTemplate } from "@shared/contracts/menu.ts";
import type { TaskRunControlEntry } from "@shared/contracts/tasks.ts";
import i18next from "i18next";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { initI18n } from "@/i18n/index.ts";
import { registerPanelActions } from "@/lib/actions/panel-actions.ts";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { registerRunActions } from "@/lib/actions/run-actions.ts";
import { buildMenuEntries } from "@/lib/context-menu/build-entries.ts";
import { popupContextMenuAt } from "@/lib/context-menu/use-context-menu.ts";
import { registerTerminalActions } from "@/panel-kits/terminal/register-actions.ts";
import { useTaskRunSelectionStore } from "@/stores/task-run-selection.store.ts";
import { useTaskRunsStore } from "@/stores/task-runs.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

function terminalPanel(id: string) {
  return {
    id,
    title: "Terminal",
    view: { contentComponent: "terminal" },
  };
}

function taskPanel(id: string) {
  return {
    ...terminalPanel(id),
    params: {
      task: {
        cwd: "/Users/xyz/ABC/pier",
        label: "test",
        projectRootPath: "/Users/xyz/ABC/pier",
        rawCommand: "pnpm run test",
        runId: "run-1",
        source: "package-script",
        startedAt: 1_772_000_000_000,
        status: "running",
        taskId: "package-script:test",
      },
    },
  };
}

function taskOutputPanel(id: string) {
  return {
    ...terminalPanel(id),
    params: {
      taskOutput: {
        label: "test",
        runId: "run-1",
        taskId: "package-script:test",
      },
    },
  };
}

function taskRun(
  status: TaskRunControlEntry["status"] = "running",
  mode: TaskRunControlEntry["mode"] = "terminal-tab"
): TaskRunControlEntry {
  return {
    mode,
    nodes: {
      "package-script:test": {
        label: "test",
        panelId: "terminal-task",
        status,
        taskId: "package-script:test",
        ...(status === "stopping" ? { stopRequestedAt: Date.now() } : {}),
      },
    },
    ...(mode === "background" ? { originPanelId: "terminal-1" } : {}),
    projectRootPath: "/Users/xyz/ABC/pier",
    rootTaskId: "package-script:test",
    runId: "run-1",
    startedAt: 1_772_000_000_000,
    status,
    updatedAt: 1_772_000_000_000,
  };
}

function webPanel(id: string) {
  return {
    id,
    title: "Welcome",
    view: { contentComponent: "welcome" },
  };
}

function createApi(
  activePanel: ReturnType<
    | typeof terminalPanel
    | typeof taskPanel
    | typeof webPanel
    | typeof taskOutputPanel
  >
) {
  return {
    activeGroup: { panels: [activePanel] },
    activePanel,
    groups: [{ id: "group-1" }],
    panels: [activePanel],
    totalPanels: 1,
  };
}

function collectActionIds(items: MenuTemplate): string[] {
  const ids: string[] = [];
  for (const item of items) {
    if (item.type === "action") {
      ids.push(item.id);
      continue;
    }
    if (item.type === "submenu") {
      ids.push(...collectActionIds(item.submenu));
    }
  }
  return ids;
}

function topLevelActionLabels(items: MenuTemplate): string[] {
  return items
    .filter((item) => item.type === "action")
    .map((item) => (item.type === "action" ? item.label : ""));
}

function findAction(
  items: MenuTemplate,
  id: string
): MenuItemAction | undefined {
  for (const item of items) {
    if (item.type === "action" && item.id === id) {
      return item;
    }
    if (item.type === "submenu") {
      const nested: MenuItemAction | undefined = findAction(item.submenu, id);
      if (nested) {
        return nested;
      }
    }
  }
}

describe("terminal content context menu actions", () => {
  const disposers: Array<() => void> = [];
  const performOperation = vi.fn(async () => ({ ok: true }));
  const stopTask = vi.fn(async () => ({
    failures: [],
    snapshot: taskRun("stopping"),
    status: "stopping" as const,
  }));
  const spawnTask = vi.fn(async () => ({
    panelIds: ["terminal-task"],
    primaryPanelId: "terminal-task",
    runId: "run-next",
    status: "started" as const,
  }));
  const dispatchEventSpy = vi.spyOn(window, "dispatchEvent");
  let searchOpenRequestHandler: (() => void) | null = null;

  beforeAll(async () => {
    await initI18n();
  });

  beforeEach(async () => {
    await i18next.changeLanguage("zh-CN");
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        menu: { popup: vi.fn(async () => ({ actionId: null })) },
        tasks: { spawn: spawnTask, stop: stopTask },
        terminal: {
          onSearchOpenRequest: vi.fn((handler: () => void) => {
            searchOpenRequestHandler = handler;
            return () => {
              searchOpenRequestHandler = null;
            };
          }),
          performOperation,
        },
      },
    });
    performOperation.mockClear();
    stopTask.mockClear();
    spawnTask.mockClear();
    dispatchEventSpy.mockClear();
    searchOpenRequestHandler = null;
    useTaskRunSelectionStore.setState({ selectedRunIdsByPanel: {} });
    useWorkspaceStore
      .getState()
      .setApi(createApi(terminalPanel("terminal-1")) as never);
    useTaskRunsStore.setState({
      error: null,
      initialized: true,
      snapshot: { runs: {}, version: 0 },
    });
  });

  afterEach(() => {
    for (const dispose of disposers.splice(0)) {
      dispose();
    }
    useWorkspaceStore.getState().setApi(null);
    useTaskRunSelectionStore.setState({ selectedRunIdsByPanel: {} });
    useTaskRunsStore.setState({
      error: null,
      initialized: false,
      snapshot: { runs: {}, version: 0 },
    });
  });

  function registerActions(): void {
    disposers.push(registerPanelActions());
    disposers.push(registerTerminalActions());
    disposers.push(registerRunActions());
  }

  it("adds terminal editing actions to the top of terminal/content", async () => {
    await registerActions();

    const entries = buildMenuEntries("terminal/content");
    const ids = collectActionIds(entries);

    expect(ids).toEqual(
      expect.arrayContaining([
        "pier.panel.copySelection",
        "pier.terminal.copy",
        "pier.panel.selectAll",
        "pier.terminal.paste",
        "pier.terminal.selectAll",
        "pier.terminal.search",
        "pier.terminal.clearScreen",
        "pier.panel.splitRight",
        "pier.panel.focusRight",
      ])
    );
    expect(ids.slice(0, 5)).toEqual([
      "pier.panel.copySelection",
      "pier.terminal.copy",
      "pier.panel.selectAll",
      "pier.terminal.paste",
      "pier.terminal.selectAll",
    ]);
    expect(topLevelActionLabels(entries).slice(0, 5)).toEqual([
      "复制",
      "复制",
      "全选",
      "粘贴",
      "全选",
    ]);
  });

  it("replaces new-terminal/split with rerun on task panel menus", async () => {
    await registerActions();
    useWorkspaceStore
      .getState()
      .setApi(createApi(taskPanel("terminal-task")) as never);

    const contentIds = collectActionIds(buildMenuEntries("terminal/content"));
    expect(contentIds).toContain("pier.run.rerunTask");
    expect(contentIds).not.toEqual(
      expect.arrayContaining([
        "pier.panel.newTerminal",
        "pier.panel.splitRight",
        "pier.panel.splitDown",
        "pier.panel.splitLeft",
        "pier.panel.splitUp",
      ])
    );

    const tabIds = collectActionIds(buildMenuEntries("dockview-tab"));
    expect(tabIds).toContain("pier.run.rerunTask");
    expect(tabIds).not.toContain("pier.panel.newTerminal");
  });

  it("adds the same restart and stop actions to task tabs and panels", async () => {
    await registerActions();
    useWorkspaceStore
      .getState()
      .setApi(createApi(taskPanel("terminal-task")) as never);
    useTaskRunsStore.setState({
      error: null,
      initialized: true,
      snapshot: { runs: { "run-1": taskRun() }, version: 1 },
    });

    const contentIds = collectActionIds(buildMenuEntries("terminal/content"));
    const tabIds = collectActionIds(buildMenuEntries("dockview-tab"));

    expect(contentIds).toEqual(
      expect.arrayContaining(["pier.run.rerunTask", "pier.run.stopTask"])
    );
    expect(tabIds).toEqual(
      expect.arrayContaining(["pier.run.rerunTask", "pier.run.stopTask"])
    );
  });

  it("builds an inactive task tab menu from the source panel identity", async () => {
    await registerActions();
    const active = terminalPanel("terminal-active");
    const source = taskPanel("terminal-task");
    useWorkspaceStore.getState().setApi({
      activeGroup: { panels: [active, source] },
      activePanel: active,
      groups: [{ id: "group-1" }],
      panels: [active, source],
      totalPanels: 2,
    } as never);
    useTaskRunsStore.setState({
      error: null,
      initialized: true,
      snapshot: { runs: { "run-1": taskRun() }, version: 1 },
    });

    const ids = collectActionIds(
      buildMenuEntries("dockview-tab", {
        sourcePanelComponent: "terminal",
        sourcePanelId: "terminal-task",
        surface: "dockview-tab",
      })
    );

    expect(ids).toEqual(
      expect.arrayContaining(["pier.run.rerunTask", "pier.run.stopTask"])
    );
    expect(ids).not.toContain("pier.panel.newTerminal");
  });

  it("dispatches stop against the source task run", async () => {
    await registerActions();
    useWorkspaceStore
      .getState()
      .setApi(createApi(taskPanel("terminal-task")) as never);
    useTaskRunsStore.setState({
      error: null,
      initialized: true,
      snapshot: { runs: { "run-1": taskRun() }, version: 1 },
    });

    await actionRegistry.get("pier.run.stopTask")?.handler({
      sourcePanelId: "terminal-task",
      surface: "dockview-tab",
    });

    expect(stopTask).toHaveBeenCalledWith({ force: false, runId: "run-1" });
  });

  it("dispatches a cancelled run from the native context menu", async () => {
    await registerActions();
    useWorkspaceStore
      .getState()
      .setApi(createApi(taskPanel("terminal-task")) as never);
    const staleActive = {
      ...taskRun(),
      runId: "run-stale-active",
      updatedAt: 1_771_999_999_000,
    };
    useTaskRunsStore.setState({
      error: null,
      initialized: true,
      snapshot: {
        runs: {
          "run-1": taskRun("cancelled"),
          [staleActive.runId]: staleActive,
        },
        version: 1,
      },
    });
    useTaskRunSelectionStore
      .getState()
      .selectPanelRun("terminal-task", "run-1");
    vi.mocked(window.pier.menu.popup).mockResolvedValue({
      actionId: "pier.run.rerunTask",
    });

    await popupContextMenuAt(
      "dockview-tab",
      { x: 10, y: 20 },
      { sourcePanelId: "terminal-task" }
    );

    expect(spawnTask).toHaveBeenCalledWith({
      focus: true,
      forceRestart: true,
      mode: "terminal-tab",
      placement: "active-tab",
      projectRootPath: "/Users/xyz/ABC/pier",
      taskId: "package-script:test",
      terminalPanelId: "terminal-task",
    });
  });

  it("reruns a succeeded task from the native terminal context menu", async () => {
    await registerActions();
    useWorkspaceStore
      .getState()
      .setApi(createApi(taskPanel("terminal-task")) as never);
    useTaskRunsStore.setState({
      error: null,
      initialized: true,
      snapshot: { runs: { "run-1": taskRun("succeeded") }, version: 1 },
    });
    vi.mocked(window.pier.menu.popup).mockResolvedValue({
      actionId: "pier.run.rerunTask",
    });

    await popupContextMenuAt(
      "terminal/content",
      { x: 10, y: 20 },
      { sourcePanelId: "terminal-task" }
    );

    expect(spawnTask).toHaveBeenCalledWith({
      focus: true,
      forceRestart: true,
      mode: "terminal-tab",
      placement: "active-tab",
      projectRootPath: "/Users/xyz/ABC/pier",
      taskId: "package-script:test",
      terminalPanelId: "terminal-task",
    });
  });

  it("recognizes task output tabs and panels as task run targets", async () => {
    await registerActions();
    useWorkspaceStore
      .getState()
      .setApi(createApi(taskOutputPanel("task-output-1")) as never);
    useTaskRunsStore.setState({
      error: null,
      initialized: true,
      snapshot: {
        runs: { "run-1": taskRun("running", "background") },
        version: 1,
      },
    });

    expect(collectActionIds(buildMenuEntries("terminal/content"))).toEqual(
      expect.arrayContaining(["pier.run.rerunTask", "pier.run.stopTask"])
    );
    expect(collectActionIds(buildMenuEntries("dockview-tab"))).toEqual(
      expect.arrayContaining(["pier.run.rerunTask", "pier.run.stopTask"])
    );
  });

  it("keeps restart but removes stop after the task finishes", async () => {
    await registerActions();
    useWorkspaceStore
      .getState()
      .setApi(createApi(taskPanel("terminal-task")) as never);
    useTaskRunsStore.setState({
      error: null,
      initialized: true,
      snapshot: { runs: { "run-1": taskRun("failed") }, version: 1 },
    });

    const ids = collectActionIds(buildMenuEntries("dockview-tab"));
    expect(ids).toContain("pier.run.rerunTask");
    expect(ids).not.toContain("pier.run.stopTask");
  });

  it("disables stop during the grace period and exposes force stop after it", async () => {
    vi.spyOn(Date, "now").mockReturnValue(3000);
    await registerActions();
    useWorkspaceStore
      .getState()
      .setApi(createApi(taskPanel("terminal-task")) as never);
    const stopping = taskRun("stopping");
    const node = stopping.nodes["package-script:test"];
    if (!node) {
      throw new Error("missing task run node");
    }
    node.stopRequestedAt = 2500;
    useTaskRunsStore.setState({
      error: null,
      initialized: true,
      snapshot: { runs: { "run-1": stopping }, version: 1 },
    });

    expect(
      findAction(buildMenuEntries("dockview-tab"), "pier.run.stopTask")
    ).toMatchObject({ enabled: false, label: "停止任务" });

    node.stopRequestedAt = 500;
    expect(
      findAction(buildMenuEntries("dockview-tab"), "pier.run.stopTask")
    ).toMatchObject({ enabled: true, label: "强制停止" });
  });

  it("keeps new-terminal/split and hides rerun on plain terminal menus", async () => {
    await registerActions();

    const contentIds = collectActionIds(buildMenuEntries("terminal/content"));
    expect(contentIds).toEqual(
      expect.arrayContaining([
        "pier.panel.newTerminal",
        "pier.panel.splitRight",
      ])
    );
    expect(contentIds).not.toContain("pier.run.rerunTask");

    const tabIds = collectActionIds(buildMenuEntries("dockview-tab"));
    expect(tabIds).toContain("pier.panel.newTerminal");
    expect(tabIds).not.toContain("pier.run.rerunTask");
  });

  it("does not expose terminal-only actions on the dockview tab menu", async () => {
    await registerActions();

    const ids = collectActionIds(buildMenuEntries("dockview-tab"));

    expect(ids).not.toEqual(
      expect.arrayContaining([
        "pier.terminal.clearScreen",
        "pier.panel.splitRight",
        "pier.panel.focusRight",
      ])
    );
  });

  it("dispatches terminal operations against the active terminal panel", async () => {
    await registerActions();

    const action = actionRegistry.get("pier.terminal.clearScreen");
    if (!action) {
      throw new Error("missing pier.terminal.clearScreen action");
    }

    await action.handler();

    expect(performOperation).toHaveBeenCalledWith("terminal-1", "clearScreen");
  });

  it("dispatches the terminal search action to the active terminal panel", async () => {
    await registerActions();

    const action = actionRegistry.get("pier.terminal.search");
    if (!action) {
      throw new Error("missing pier.terminal.search action");
    }

    await action.handler();

    expect(dispatchEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: { panelId: "terminal-1" },
        type: "pier:terminal:open-search",
      })
    );
    expect(performOperation).not.toHaveBeenCalled();
  });

  it("opens terminal search from the application menu request", async () => {
    await registerActions();

    searchOpenRequestHandler?.();

    expect(dispatchEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: { panelId: "terminal-1" },
        type: "pier:terminal:open-search",
      })
    );
  });

  it("does not dispatch terminal operations for non-terminal active panels", async () => {
    await registerActions();
    useWorkspaceStore
      .getState()
      .setApi(createApi(webPanel("welcome-1")) as never);

    const action = actionRegistry.get("pier.terminal.copy");
    if (!action) {
      throw new Error("missing pier.terminal.copy action");
    }

    await action.handler();

    expect(performOperation).not.toHaveBeenCalled();
    expect(dispatchEventSpy).not.toHaveBeenCalled();
  });
});

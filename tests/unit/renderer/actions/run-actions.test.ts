import type { PanelContext } from "@shared/contracts/panel.ts";
import type {
  TaskListResult,
  TaskSpawnResult,
} from "@shared/contracts/tasks.ts";
import type { DockviewApi } from "dockview-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { registerRunActions } from "@/lib/actions/run-actions.ts";
import { useCommandPaletteController } from "@/lib/command-palette/controller.ts";
import {
  resetAppDialogForTests,
  useAppDialogStore,
} from "@/stores/app-dialog.store.ts";
import { usePanelDescriptorStore } from "@/stores/panel-descriptor.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

function context(path: string): PanelContext {
  return {
    contextId: `ctx:${path}`,
    cwd: path,
    openedPath: path,
    projectRootPath: path,
    source: "panel",
    updatedAt: 1_772_000_000_000,
    worktreeKey: path,
  };
}

function panel(id: string, component = "terminal") {
  return {
    api: { setActive: vi.fn() },
    id,
    title: "Terminal",
    view: { contentComponent: component },
  };
}

function taskPanel(id: string, projectRoot = "/Users/xyz/ABC/pier") {
  return {
    ...panel(id),
    params: {
      task: {
        cwd: projectRoot,
        label: "test",
        projectRootPath: projectRoot,
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

function installTaskPanelApi() {
  const taskCurrent = taskPanel("terminal-task");
  const api = {
    activePanel: taskCurrent,
    groups: [{ panels: [taskCurrent] }],
    panels: [taskCurrent],
  };
  useWorkspaceStore.getState().setApi(api as unknown as DockviewApi);
  return { api, taskCurrent };
}

function installWorkspaceApi() {
  const terminalCurrent = panel("terminal-current");
  const terminalOther = panel("terminal-other");
  const welcome = panel("welcome-1", "welcome");
  const api = {
    activePanel: terminalCurrent,
    groups: [
      { panels: [terminalCurrent, terminalOther] },
      { panels: [welcome] },
    ],
    panels: [terminalCurrent, terminalOther, welcome],
  };
  useWorkspaceStore.getState().setApi(api as unknown as DockviewApi);
  usePanelDescriptorStore.setState({
    activeId: "terminal-current",
    descriptors: {
      "terminal-current": {
        context: context("/Users/xyz/ABC/pier"),
        display: { short: "pier" },
      },
      "terminal-other": {
        context: context("/Users/xyz/ABC/loomdesk"),
        display: { short: "loomdesk" },
      },
      "welcome-1": { display: { short: "Welcome" } },
    },
  });
  return { api, terminalCurrent, terminalOther };
}

function installWebWorkspaceApi() {
  const webCurrent = panel("web-current", "file-viewer");
  const terminalOther = panel("terminal-other");
  const api = {
    activePanel: webCurrent,
    groups: [{ panels: [webCurrent, terminalOther] }],
    panels: [webCurrent, terminalOther],
  };
  useWorkspaceStore.getState().setApi(api as unknown as DockviewApi);
  usePanelDescriptorStore.setState({
    activeId: "web-current",
    descriptors: {
      "web-current": {
        context: context("/Users/xyz/ABC/pier"),
        display: { short: "README.md" },
      },
      "terminal-other": {
        context: context("/Users/xyz/ABC/loomdesk"),
        display: { short: "loomdesk" },
      },
    },
  });
  return { api, terminalOther, webCurrent };
}

function taskList(projectRoot = "/Users/xyz/ABC/pier"): TaskListResult {
  return {
    errors: [],
    projectRootPath: projectRoot,
    tasks: [
      {
        commandSpec: { command: "pnpm run test", kind: "shell" },
        concurrencyPolicy: "dedupe",
        cwd: projectRoot,
        description: "vitest",
        id: "package-script:test",
        label: "test",
        source: "package-script",
      },
      {
        commandSpec: { command: "custom", kind: "shell" },
        concurrencyPolicy: "dedupe",
        cwd: projectRoot,
        id: "vscode:custom",
        label: "custom",
        source: "vscode",
        unsupportedReason: "不支持 VS Code 扩展任务类型: custom",
      },
    ],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

function nextMacrotask() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function runTaskAction() {
  const handler = actionRegistry.get("pier.run.task")?.handler;
  if (!handler) {
    throw new Error("expected Run Task action to be registered");
  }
  return handler();
}

describe("run actions", () => {
  let disposeRunActions: (() => void) | null = null;

  beforeEach(async () => {
    await initI18n();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    resetAppDialogForTests();
    useCommandPaletteController.setState({
      mode: "commands",
      open: false,
      quickPick: null,
      requestId: 0,
      stack: [],
    });
    useWorkspaceStore.getState().setApi(null);
    usePanelDescriptorStore.setState({ activeId: null, descriptors: {} });
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        tasks: {
          list: vi.fn(async () => taskList()),
          spawn: vi.fn(
            async (): Promise<TaskSpawnResult> => ({
              panelIds: ["terminal-task"],
              primaryPanelId: "terminal-task",
              runId: "run-next",
              status: "started",
            })
          ),
        },
        terminal: {},
      },
    });
  });

  afterEach(() => {
    disposeRunActions?.();
    disposeRunActions = null;
    useWorkspaceStore.getState().setApi(null);
    usePanelDescriptorStore.setState({ activeId: null, descriptors: {} });
    useCommandPaletteController.setState({
      mode: "commands",
      open: false,
      quickPick: null,
      requestId: 0,
      stack: [],
    });
    resetAppDialogForTests();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("opens a grouped terminal list from the current workspace panels", async () => {
    installWorkspaceApi();
    disposeRunActions = registerRunActions();

    await actionRegistry.get("pier.run.terminalList")?.handler();

    const quickPick = useCommandPaletteController.getState().quickPick;
    expect(quickPick?.title).toBe("Terminal List...");
    expect(quickPick?.sections?.map((section) => section.heading)).toEqual([
      "Group 1",
    ]);
    expect(quickPick?.sections?.[0]?.items.map((item) => item.label)).toEqual([
      "pier",
      "loomdesk",
    ]);
    expect(quickPick?.sections?.[0]?.items[0]?.checked).toBe(true);
    expect(quickPick?.sections?.[0]?.items[0]?.badges).toEqual([
      { label: "Tab 1/2", variant: "outline" },
    ]);
    expect(quickPick?.sections?.[0]?.items[1]?.badges).toEqual([
      { label: "Tab 2/2", variant: "outline" },
    ]);
    expect(quickPick?.items).toBeUndefined();
  });

  it("opens a disabled no-context Run Task picker without listing tasks", async () => {
    disposeRunActions = registerRunActions();

    const run = runTaskAction();

    expect(useCommandPaletteController.getState()).toMatchObject({
      mode: "quick-pick",
      open: true,
      quickPick: {
        items: [
          {
            detail: "Open a panel inside a project, then run a task",
            disabled: true,
            id: "task-no-context",
            label: "No active project",
          },
        ],
        placeholder: "Search tasks or commands…",
        title: "Run Task…",
      },
    });
    expect(window.pier.tasks.list).not.toHaveBeenCalled();

    await run;

    expect(window.pier.tasks.list).not.toHaveBeenCalled();
  });

  it("opens a loading task picker before starting task discovery", async () => {
    installWorkspaceApi();
    disposeRunActions = registerRunActions();

    const run = runTaskAction();

    expect(useCommandPaletteController.getState()).toMatchObject({
      mode: "quick-pick",
      open: true,
      quickPick: {
        items: [
          {
            disabled: true,
            id: "task-loading",
          },
        ],
        loading: true,
      },
    });
    expect(window.pier.tasks.list).not.toHaveBeenCalled();

    await nextMacrotask();

    expect(window.pier.tasks.list).toHaveBeenCalledWith({
      projectRootPath: "/Users/xyz/ABC/pier",
    });

    await run;

    const state = useCommandPaletteController.getState();
    expect(state.stack).toHaveLength(0);
    const quickPick = state.quickPick;
    expect(quickPick?.loading).toBeUndefined();
    expect(quickPick?.sections?.[0]?.heading).toBe("package.json");
    expect(quickPick?.sections?.[0]?.items[0]).toMatchObject({
      description: "vitest",
      detail: "pnpm run test",
      id: "package-script:test",
      label: "test",
    });
    expect(quickPick?.sections?.[1]?.items[0]).toMatchObject({
      disabled: true,
      detail: "不支持 VS Code 扩展任务类型: custom",
      label: "custom",
    });
  });

  it("does not reopen Run Task when task discovery resolves after dismissal", async () => {
    installWorkspaceApi();
    const list = deferred<TaskListResult>();
    vi.mocked(window.pier.tasks.list).mockReturnValueOnce(list.promise);
    disposeRunActions = registerRunActions();

    const run = runTaskAction();
    useCommandPaletteController.getState().goBack();
    list.resolve(taskList());
    await run;

    expect(useCommandPaletteController.getState()).toMatchObject({
      mode: "commands",
      open: false,
      quickPick: null,
    });
  });

  it("shows an alert and closes Run Task when task discovery fails", async () => {
    installWorkspaceApi();
    vi.mocked(window.pier.tasks.list).mockRejectedValueOnce(new Error("boom"));
    disposeRunActions = registerRunActions();

    await runTaskAction();

    expect(useAppDialogStore.getState().current).toMatchObject({
      body: "boom",
      kind: "alert",
      title: "Failed to load tasks",
    });
    expect(useCommandPaletteController.getState().open).toBe(false);
  });

  it("spawns the selected task in the background when Run Task is invoked from a terminal panel", async () => {
    installWorkspaceApi();
    disposeRunActions = registerRunActions();

    await actionRegistry.get("pier.run.task")?.handler();

    const quickPick = useCommandPaletteController.getState().quickPick;
    const target = quickPick?.sections
      ?.flatMap((section) => section.items)
      .find((item) => item.id === "package-script:test");
    if (!(quickPick && target)) {
      throw new Error("expected task item");
    }

    await quickPick.onAccept(target);

    expect(window.pier.tasks.spawn).toHaveBeenCalledWith({
      focus: false,
      forceRestart: false,
      mode: "background",
      placement: "active-tab",
      projectRootPath: "/Users/xyz/ABC/pier",
      taskId: "package-script:test",
      terminalPanelId: "terminal-current",
    });
    expect(quickPick.renderItem).toBeUndefined();
  });

  it("pins a task terminal to the panel group that opened Run Task", async () => {
    installWebWorkspaceApi();
    disposeRunActions = registerRunActions();

    await actionRegistry.get("pier.run.task")?.handler({
      sourcePanelGroupId: "group-source",
    });

    const quickPick = useCommandPaletteController.getState().quickPick;
    const target = quickPick?.sections
      ?.flatMap((section) => section.items)
      .find((item) => item.id === "package-script:test");
    if (!(quickPick && target)) {
      throw new Error("expected task item");
    }

    await quickPick.onAccept(target);

    expect(window.pier.tasks.spawn).toHaveBeenCalledWith({
      focus: true,
      forceRestart: false,
      placement: "active-tab",
      projectRootPath: "/Users/xyz/ABC/pier",
      targetGroupId: "group-source",
      taskId: "package-script:test",
    });
  });

  it("falls back to a terminal tab when Run Task is invoked from a non-terminal project panel", async () => {
    installWebWorkspaceApi();
    disposeRunActions = registerRunActions();

    await actionRegistry.get("pier.run.task")?.handler();

    const quickPick = useCommandPaletteController.getState().quickPick;
    const target = quickPick?.sections
      ?.flatMap((section) => section.items)
      .find((item) => item.id === "package-script:test");
    if (!(quickPick && target)) {
      throw new Error("expected task item");
    }

    await quickPick.onAccept(target);

    expect(window.pier.tasks.spawn).toHaveBeenCalledWith({
      focus: true,
      forceRestart: false,
      placement: "active-tab",
      projectRootPath: "/Users/xyz/ABC/pier",
      taskId: "package-script:test",
    });
    expect(quickPick.renderItem).toBeUndefined();
  });

  it("does not locally activate an already-running task panel after main focuses it", async () => {
    const { terminalOther } = installWorkspaceApi();
    vi.mocked(window.pier.tasks.spawn).mockResolvedValueOnce({
      panelId: "terminal-other",
      status: "already-running",
      windowId: "main",
    });
    disposeRunActions = registerRunActions();

    await runTaskAction();
    const quickPick = useCommandPaletteController.getState().quickPick;
    const target = quickPick?.sections
      ?.flatMap((section) => section.items)
      .find((item) => item.id === "package-script:test");
    if (!(quickPick && target)) {
      throw new Error("expected task item");
    }

    await quickPick.onAccept(target);

    expect(terminalOther.api.setActive).not.toHaveBeenCalled();
  });

  it("does not show loading toast when starting a task from the command palette", async () => {
    installWorkspaceApi();
    disposeRunActions = registerRunActions();

    await runTaskAction();

    const quickPick = useCommandPaletteController.getState().quickPick;
    const target = quickPick?.sections
      ?.flatMap((section) => section.items)
      .find((item) => item.id === "package-script:test");
    if (!(quickPick && target)) {
      throw new Error("expected task item");
    }

    await quickPick.onAccept(target);

    expect(window.pier.tasks.spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        projectRootPath: "/Users/xyz/ABC/pier",
        taskId: "package-script:test",
      })
    );
  });

  it("shows an alert when spawn rejects without loading toast", async () => {
    installWorkspaceApi();
    vi.mocked(window.pier.tasks.spawn).mockRejectedValueOnce(new Error("boom"));
    disposeRunActions = registerRunActions();

    await runTaskAction();

    const quickPick = useCommandPaletteController.getState().quickPick;
    const target = quickPick?.sections?.[0]?.items[0];
    if (!(quickPick && target)) {
      throw new Error("expected task item");
    }

    const accepted = quickPick.onAccept(target);
    await vi.waitFor(() => {
      expect(useAppDialogStore.getState().current).toMatchObject({
        body: "boom",
        kind: "alert",
        title: "Failed to start task",
      });
    });
    resetAppDialogForTests();
    await accepted;
  });

  it("shows an alert when main reports that a selected task is unsupported", async () => {
    installWorkspaceApi();
    vi.mocked(window.pier.tasks.spawn).mockResolvedValueOnce({
      message: "Unsupported task type",
      status: "unsupported",
    });
    disposeRunActions = registerRunActions();

    await runTaskAction();
    const quickPick = useCommandPaletteController.getState().quickPick;
    const target = quickPick?.sections?.[0]?.items[0];
    if (!(quickPick && target)) {
      throw new Error("expected task item");
    }

    const accepted = quickPick.onAccept(target);
    await vi.waitFor(() => {
      expect(useAppDialogStore.getState().current).toMatchObject({
        body: "Unsupported task type",
        kind: "alert",
        title: "Failed to start task",
      });
    });
    resetAppDialogForTests();
    await accepted;
  });

  it("prompts for missing task inputs and retries spawn", async () => {
    installWorkspaceApi();
    vi.mocked(window.pier.tasks.spawn)
      .mockResolvedValueOnce({
        inputs: [
          {
            default: "web",

            description: "Target package",
            id: "pkg",
            type: "promptString",
          },
        ],
        status: "requires-input",
      })
      .mockResolvedValueOnce({
        panelIds: ["terminal-task"],
        primaryPanelId: "terminal-task",
        status: "started",
      });
    disposeRunActions = registerRunActions();

    await actionRegistry.get("pier.run.task")?.handler();
    const quickPick = useCommandPaletteController.getState().quickPick;
    const target = quickPick?.sections?.[0]?.items[0];
    if (!(quickPick && target)) {
      throw new Error("expected task item");
    }

    const acceptance = quickPick.onAccept(target);
    await vi.waitFor(() => {
      expect(
        useCommandPaletteController.getState().quickPick?.onAcceptQuery
      ).toBeTypeOf("function");
    });
    const inputPick = useCommandPaletteController.getState().quickPick;
    expect(inputPick).toMatchObject({
      initialQuery: "web",
      placeholder: "Target package",
      title: "Target package",
    });
    await inputPick?.onAcceptQuery?.("renderer");
    await acceptance;

    expect(window.pier.tasks.spawn).toHaveBeenLastCalledWith({
      focus: false,
      forceRestart: false,
      inputs: { pkg: "renderer" },
      mode: "background",
      placement: "active-tab",
      projectRootPath: "/Users/xyz/ABC/pier",
      taskId: "package-script:test",
      terminalPanelId: "terminal-current",
    });
  });

  it("exposes Rerun Task to the command palette when run actions are registered", () => {
    installTaskPanelApi();
    disposeRunActions = registerRunActions();

    const paletteActionIds = actionRegistry
      .list("command-palette")
      .map((action) => action.id);

    expect(paletteActionIds).toContain("pier.run.rerunTask");
    expect(actionRegistry.get("pier.run.rerunTask")?.enabled?.()).toBe(true);
  });

  it("reruns the active task panel through the task bridge", async () => {
    installTaskPanelApi();
    disposeRunActions = registerRunActions();

    await actionRegistry.get("pier.run.rerunTask")?.handler();

    expect(window.pier.tasks.spawn).toHaveBeenCalledWith({
      focus: true,
      forceRestart: true,
      mode: "terminal-tab",
      placement: "active-tab",
      projectRootPath: "/Users/xyz/ABC/pier",
      terminalPanelId: "terminal-task",
      taskId: "package-script:test",
    });
  });

  it("does not rerun when the active panel is not a task panel", async () => {
    installWorkspaceApi();
    disposeRunActions = registerRunActions();

    const action = actionRegistry.get("pier.run.rerunTask");
    expect(action?.enabled?.()).toBe(false);

    await action?.handler();

    expect(window.pier.tasks.spawn).not.toHaveBeenCalled();
  });

  it("focuses an existing terminal from the terminal list", async () => {
    const { terminalOther } = installWorkspaceApi();
    disposeRunActions = registerRunActions();

    await actionRegistry.get("pier.run.terminalList")?.handler();

    const quickPick = useCommandPaletteController.getState().quickPick;
    const target = quickPick?.sections
      ?.flatMap((section) => section.items)
      .find((item) => item.id === "panel:terminal-other");
    if (!(quickPick && target)) {
      throw new Error("expected terminal item");
    }

    await quickPick.onAccept(target);

    expect(terminalOther.api.setActive).toHaveBeenCalledOnce();
  });

  it("renders an empty state when no terminal panels exist", async () => {
    const welcome = panel("welcome-1", "welcome");
    useWorkspaceStore.getState().setApi({
      activePanel: welcome,
      groups: [{ panels: [welcome] }],
      panels: [welcome],
    } as unknown as DockviewApi);
    disposeRunActions = registerRunActions();

    await actionRegistry.get("pier.run.terminalList")?.handler();

    const quickPick = useCommandPaletteController.getState().quickPick;
    expect(quickPick?.items?.[0]).toMatchObject({
      disabled: true,
      id: "terminal-empty",
      label: "No terminals available",
    });
  });
});

import type { PanelContext } from "@shared/contracts/panel.ts";
import type {
  TaskListResult,
  TaskSpawnResult,
} from "@shared/contracts/tasks.ts";
import type { DockviewApi } from "dockview-react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { registerRunActions } from "@/lib/actions/run-actions.ts";
import { useCommandPaletteController } from "@/lib/command-palette/controller.ts";
import { usePanelDescriptorStore } from "@/stores/panel-descriptor.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

vi.mock("sonner", () => ({
  toast: {
    dismiss: vi.fn(),
    loading: vi.fn(() => "task-spawn-loading"),
  },
}));

const TASK_SPAWN_LOADING_DELAY_MS = 300;
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
    vi.mocked(toast.loading).mockReturnValue("task-spawn-loading");
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
            detail: "Focus a project-backed panel before running a task",
            disabled: true,
            id: "task-no-context",
            label: "No active project",
          },
        ],
        placeholder: "Search tasks or commands…",
        title: "Run Task...",
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

  it("replaces the Run Task loading picker with a disabled load error row", async () => {
    installWorkspaceApi();
    vi.mocked(window.pier.tasks.list).mockRejectedValueOnce(new Error("boom"));
    disposeRunActions = registerRunActions();

    await runTaskAction();

    const state = useCommandPaletteController.getState();
    expect(state.stack).toHaveLength(0);
    expect(state.quickPick?.items?.[0]).toMatchObject({
      detail: "boom",
      disabled: true,
      id: "task-load-error",
    });
  });

  it("spawns the selected task through the task bridge", async () => {
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
      focus: true,
      forceRestart: false,
      placement: "active-tab",
      projectRootPath: "/Users/xyz/ABC/pier",
      taskId: "package-script:test",
    });
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

  it("shows delayed loading feedback only for a slow selected task spawn", async () => {
    vi.useFakeTimers();
    installWorkspaceApi();
    const spawn = deferred<TaskSpawnResult>();
    vi.mocked(window.pier.tasks.spawn).mockReturnValueOnce(spawn.promise);
    disposeRunActions = registerRunActions();

    const run = runTaskAction();
    await vi.advanceTimersByTimeAsync(0);
    await run;

    const quickPick = useCommandPaletteController.getState().quickPick;
    const target = quickPick?.sections
      ?.flatMap((section) => section.items)
      .find((item) => item.id === "package-script:test");
    if (!(quickPick && target)) {
      throw new Error("expected task item");
    }

    const accepted = quickPick.onAccept(target);
    expect(toast.loading).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(TASK_SPAWN_LOADING_DELAY_MS - 1);
    expect(toast.loading).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(toast.loading).toHaveBeenCalledTimes(1);

    spawn.resolve({
      panelIds: ["terminal-task"],
      primaryPanelId: "terminal-task",
      status: "started",
    });
    await accepted;

    expect(toast.dismiss).toHaveBeenCalledWith("task-spawn-loading");
    vi.useRealTimers();
  });

  it("does not show loading feedback for a fast selected task spawn", async () => {
    vi.useFakeTimers();
    installWorkspaceApi();
    disposeRunActions = registerRunActions();

    const run = runTaskAction();
    await vi.advanceTimersByTimeAsync(0);
    await run;

    const quickPick = useCommandPaletteController.getState().quickPick;
    const target = quickPick?.sections?.[0]?.items[0];
    if (!(quickPick && target)) {
      throw new Error("expected task item");
    }

    await quickPick.onAccept(target);
    await vi.advanceTimersByTimeAsync(TASK_SPAWN_LOADING_DELAY_MS);

    expect(toast.loading).not.toHaveBeenCalled();
    expect(toast.dismiss).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("dismisses delayed loading feedback when a slow selected task spawn rejects", async () => {
    vi.useFakeTimers();
    installWorkspaceApi();
    const spawn = deferred<TaskSpawnResult>();
    vi.mocked(window.pier.tasks.spawn).mockReturnValueOnce(spawn.promise);
    disposeRunActions = registerRunActions();

    const run = runTaskAction();
    await vi.advanceTimersByTimeAsync(0);
    await run;

    const quickPick = useCommandPaletteController.getState().quickPick;
    const target = quickPick?.sections?.[0]?.items[0];
    if (!(quickPick && target)) {
      throw new Error("expected task item");
    }

    const accepted = quickPick.onAccept(target);
    await vi.advanceTimersByTimeAsync(TASK_SPAWN_LOADING_DELAY_MS);
    expect(toast.loading).toHaveBeenCalledTimes(1);

    const rejected = expect(accepted).rejects.toThrow("boom");
    spawn.reject(new Error("boom"));
    await rejected;

    expect(toast.dismiss).toHaveBeenCalledWith("task-spawn-loading");
    vi.useRealTimers();
  });

  it("does not show delayed loading feedback after a fast selected task spawn rejects", async () => {
    vi.useFakeTimers();
    installWorkspaceApi();
    vi.mocked(window.pier.tasks.spawn).mockRejectedValueOnce(new Error("boom"));
    disposeRunActions = registerRunActions();

    const run = runTaskAction();
    await vi.advanceTimersByTimeAsync(0);
    await run;

    const quickPick = useCommandPaletteController.getState().quickPick;
    const target = quickPick?.sections?.[0]?.items[0];
    if (!(quickPick && target)) {
      throw new Error("expected task item");
    }

    await expect(quickPick.onAccept(target)).rejects.toThrow("boom");
    await vi.advanceTimersByTimeAsync(TASK_SPAWN_LOADING_DELAY_MS);

    expect(toast.loading).not.toHaveBeenCalled();
    expect(toast.dismiss).not.toHaveBeenCalled();
    vi.useRealTimers();
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
    const promptSpy = vi
      .spyOn(window, "prompt")
      .mockReturnValueOnce("renderer");
    disposeRunActions = registerRunActions();

    await actionRegistry.get("pier.run.task")?.handler();
    const quickPick = useCommandPaletteController.getState().quickPick;
    const target = quickPick?.sections?.[0]?.items[0];
    if (!(quickPick && target)) {
      throw new Error("expected task item");
    }

    await quickPick.onAccept(target);

    expect(promptSpy).toHaveBeenCalledWith("Target package", "web");
    expect(window.pier.tasks.spawn).toHaveBeenLastCalledWith({
      focus: true,
      forceRestart: false,
      inputs: { pkg: "renderer" },
      placement: "active-tab",
      projectRootPath: "/Users/xyz/ABC/pier",
      taskId: "package-script:test",
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

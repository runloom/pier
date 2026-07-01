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
import { usePanelDescriptorStore } from "@/stores/panel-descriptor.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

function context(path: string): PanelContext {
  return {
    contextId: `ctx:${path}`,
    cwd: path,
    openedPath: path,
    projectRoot: path,
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
    projectRoot,
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
      projectRoot: "/Users/xyz/ABC/pier",
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
      placement: "active-tab",
      projectRoot: "/Users/xyz/ABC/pier",
      taskId: "package-script:test",
    });
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
      inputs: { pkg: "renderer" },
      placement: "active-tab",
      projectRoot: "/Users/xyz/ABC/pier",
      taskId: "package-script:test",
    });
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

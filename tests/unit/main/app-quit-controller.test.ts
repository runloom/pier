import type {
  ForegroundActivity,
  IdleActivity,
  ShellActivity,
} from "@shared/contracts/foreground-activity.ts";
import type { AppQuitConfirmationMode } from "@shared/contracts/preferences.ts";
import { describe, expect, it, vi } from "vitest";
import {
  type AppQuitController,
  type AppQuitControllerDeps,
  createAppQuitController,
  type PreventableQuitEvent,
} from "../../../src/main/app-quit/quit-controller.ts";
import type { AppWindow } from "../../../src/main/windows/app-window.ts";

const BASE_ACTIVITY = {
  panelId: "panel-1",
  windowId: "window-1",
  spawnedAt: 100,
  updatedAt: 200,
} as const;

interface Deferred<T> {
  promise: Promise<T>;
  reject: (reason?: unknown) => void;
  resolve: (value: T | PromiseLike<T>) => void;
}

type TestableAppQuitControllerDeps = AppQuitControllerDeps & {
  shouldBypassQuitConfirmationForTests: () => boolean;
};

interface ControllerHarness {
  controller: AppQuitController;
  deps: TestableAppQuitControllerDeps;
  operations: string[];
}

function deferred<T>(): Deferred<T> {
  let reject: (reason?: unknown) => void = () => undefined;
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}

async function flushAsyncWork(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}

function quitEvent(): PreventableQuitEvent {
  return {
    preventDefault: vi.fn(),
  };
}

function idleActivity(): IdleActivity {
  return {
    kind: "idle",
    ...BASE_ACTIVITY,
  };
}

function shellActivity(commandLine = "pnpm test"): ShellActivity {
  return {
    kind: "shell",
    ...BASE_ACTIVITY,
    commandLine,
  };
}

function fakeParentWindow({ destroyed = false } = {}): AppWindow {
  return {
    focus: vi.fn(),
    isDestroyed: () => destroyed,
  } as unknown as AppWindow;
}

function createHarness(
  overrides: Partial<TestableAppQuitControllerDeps> = {}
): ControllerHarness {
  const operations: string[] = [];
  const deps: TestableAppQuitControllerDeps = {
    confirmQuit: vi.fn(() => Promise.resolve(true)),
    finalCleanup: vi.fn(() => {
      operations.push("cleanup");
    }),
    flushBeforeQuit: vi.fn(() => {
      operations.push("flush");
      return Promise.resolve();
    }),
    getActivities: vi.fn((): readonly ForegroundActivity[] => []),
    getDialogParent: vi.fn(() => null),
    logFailure: vi.fn(),
    proceedToQuit: vi.fn(() => {
      operations.push("proceed");
    }),
    readConfirmationMode: vi.fn(
      (): Promise<AppQuitConfirmationMode> => Promise.resolve("hasActivity")
    ),
    shouldBypassQuitConfirmationForTests: vi.fn(() => false),
  };
  Object.assign(deps, overrides);

  return {
    controller: createAppQuitController(deps),
    deps,
    operations,
  };
}

describe("createAppQuitController", () => {
  it("synchronously prevents the first before-quit event", () => {
    const readGate = deferred<AppQuitConfirmationMode>();
    const { controller } = createHarness({
      readConfirmationMode: vi.fn(() => readGate.promise),
    });
    const event = quitEvent();

    controller.handleBeforeQuit(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(controller.getPhase()).toBe("confirming");
  });

  it("skips confirmation for hasActivity mode when no dangerous activity is running, then flushes before proceeding", async () => {
    const { controller, deps, operations } = createHarness({
      getActivities: vi.fn((): readonly ForegroundActivity[] => [
        idleActivity(),
      ]),
    });
    const event = quitEvent();

    controller.handleBeforeQuit(event);
    await vi.waitFor(() => {
      expect(deps.proceedToQuit).toHaveBeenCalledTimes(1);
    });

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(deps.confirmQuit).not.toHaveBeenCalled();
    expect(deps.flushBeforeQuit).toHaveBeenCalledTimes(1);
    expect(operations).toEqual(["flush", "proceed"]);
    expect(controller.getPhase()).toBe("quitting");
  });

  it("returns to idle without flushing or proceeding when dangerous activity confirmation is cancelled", async () => {
    const parent = fakeParentWindow();
    const { controller, deps } = createHarness({
      confirmQuit: vi.fn(async () => false),
      getActivities: vi.fn((): readonly ForegroundActivity[] => [
        shellActivity("pnpm dev"),
      ]),
      getDialogParent: vi.fn(() => parent),
    });

    controller.handleBeforeQuit(quitEvent());
    await vi.waitFor(() => {
      expect(controller.getPhase()).toBe("idle");
    });

    expect(deps.confirmQuit).toHaveBeenCalledWith({
      parent,
      summaries: [
        {
          kind: "shell",
          label: "pnpm dev",
          panelId: BASE_ACTIVITY.panelId,
          commandLine: "pnpm dev",
          windowId: BASE_ACTIVITY.windowId,
        },
      ],
    });
    expect(deps.flushBeforeQuit).not.toHaveBeenCalled();
    expect(deps.proceedToQuit).not.toHaveBeenCalled();
  });

  it("confirms quit for active background task runs missing from foreground activity", async () => {
    const parent = fakeParentWindow();
    const { controller, deps } = createHarness({
      confirmQuit: vi.fn(async () => false),
      getActivities: vi.fn((): readonly ForegroundActivity[] => [
        idleActivity(),
      ]),
      getDialogParent: vi.fn(() => parent),
      getTaskRuns: vi.fn(() => ({
        runs: {
          "run-bg": {
            mode: "background" as const,
            nodes: {
              test: {
                label: "test",
                panelId: "background-task:run-bg:test",
                status: "running" as const,
                taskId: "package-script:test",
              },
            },
            originPanelId: "terminal-1",
            ownerWindowId: "window-1",
            projectRootPath: "/repo",
            rootTaskId: "package-script:test",
            runId: "run-bg",
            startedAt: 1,
            status: "running" as const,
            updatedAt: 2,
          },
        },
        version: 1,
      })),
    });

    controller.handleBeforeQuit(quitEvent());
    await vi.waitFor(() => {
      expect(controller.getPhase()).toBe("idle");
    });

    expect(deps.confirmQuit).toHaveBeenCalledWith({
      parent,
      summaries: [
        {
          kind: "task",
          label: "test",
          panelId: "terminal-1",
          windowId: "window-1",
        },
      ],
    });
  });

  it("flushes before proceeding when dangerous activity confirmation is accepted", async () => {
    const parent = fakeParentWindow();
    const { controller, deps, operations } = createHarness({
      confirmQuit: vi.fn(async () => true),
      getActivities: vi.fn((): readonly ForegroundActivity[] => [
        shellActivity("pnpm build"),
      ]),
      getDialogParent: vi.fn(() => parent),
    });

    controller.handleBeforeQuit(quitEvent());
    await vi.waitFor(() => {
      expect(deps.proceedToQuit).toHaveBeenCalledTimes(1);
    });

    expect(deps.confirmQuit).toHaveBeenCalledWith({
      parent,
      summaries: [
        {
          kind: "shell",
          label: "pnpm build",
          panelId: BASE_ACTIVITY.panelId,
          commandLine: "pnpm build",
          windowId: BASE_ACTIVITY.windowId,
        },
      ],
    });
    expect(deps.flushBeforeQuit).toHaveBeenCalledTimes(1);
    expect(operations).toEqual(["flush", "proceed"]);
    expect(controller.getPhase()).toBe("quitting");
  });

  it("bypasses confirmation for automated test runs while still flushing before proceeding", async () => {
    const parent = fakeParentWindow();
    const shouldBypassQuitConfirmationForTests = vi.fn(() => true);
    const { controller, deps, operations } = createHarness({
      confirmQuit: vi.fn(async () => true),
      getActivities: vi.fn((): readonly ForegroundActivity[] => [
        shellActivity("pnpm dev"),
      ]),
      getDialogParent: vi.fn(() => parent),
      readConfirmationMode: vi.fn(
        async (): Promise<AppQuitConfirmationMode> => "hasActivity"
      ),
      shouldBypassQuitConfirmationForTests,
    });
    const event = quitEvent();

    controller.handleBeforeQuit(event);
    await vi.waitFor(() => {
      expect(deps.proceedToQuit).toHaveBeenCalledTimes(1);
    });

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(deps.confirmQuit).not.toHaveBeenCalled();
    expect(shouldBypassQuitConfirmationForTests).toHaveBeenCalledTimes(1);
    expect(deps.flushBeforeQuit).toHaveBeenCalledTimes(1);
    expect(operations).toEqual(["flush", "proceed"]);
    expect(controller.getPhase()).toBe("quitting");
  });

  it.each([
    {
      activities: [] as readonly ForegroundActivity[],
      mode: "always" as const,
      name: "always mode has no dialog parent",
      parent: null,
    },
    {
      activities: [shellActivity("pnpm dev")] as readonly ForegroundActivity[],
      mode: "hasActivity" as const,
      name: "hasActivity mode has a destroyed dialog parent",
      parent: fakeParentWindow({ destroyed: true }),
    },
  ])("skips confirmation and proceeds when confirmation is required but $name", async ({
    activities,
    mode,
    parent,
  }) => {
    const { controller, deps, operations } = createHarness({
      confirmQuit: vi.fn(async () => false),
      getActivities: vi.fn(() => activities),
      getDialogParent: vi.fn(() => parent),
      readConfirmationMode: vi.fn(async () => mode),
    });
    const event = quitEvent();

    controller.handleBeforeQuit(event);
    await vi.waitFor(() => {
      expect(deps.proceedToQuit).toHaveBeenCalledTimes(1);
    });

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(deps.confirmQuit).not.toHaveBeenCalled();
    expect(deps.flushBeforeQuit).toHaveBeenCalledTimes(1);
    expect(operations).toEqual(["flush", "proceed"]);
    expect(controller.getPhase()).toBe("quitting");
    if (parent) {
      expect(parent.focus).not.toHaveBeenCalled();
    }
  });

  it("only prevents default and focuses an existing parent when before-quit fires while confirmation is already open", async () => {
    const confirmGate = deferred<boolean>();
    const parent = fakeParentWindow();
    const { controller, deps } = createHarness({
      confirmQuit: vi.fn(() => confirmGate.promise),
      getActivities: vi.fn((): readonly ForegroundActivity[] => [
        shellActivity("pnpm dev"),
      ]),
      getDialogParent: vi.fn(() => parent),
    });
    const firstEvent = quitEvent();
    const secondEvent = quitEvent();

    controller.handleBeforeQuit(firstEvent);
    controller.handleBeforeQuit(secondEvent);
    await flushAsyncWork();

    expect(firstEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(secondEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(parent.focus).toHaveBeenCalledTimes(1);
    expect(deps.confirmQuit).toHaveBeenCalledTimes(1);
    expect(deps.flushBeforeQuit).not.toHaveBeenCalled();
    expect(deps.proceedToQuit).not.toHaveBeenCalled();
    expect(controller.getPhase()).toBe("confirming");
  });

  it("does not focus a destroyed parent when before-quit fires while confirmation is already open", async () => {
    const confirmGate = deferred<boolean>();
    const parent = fakeParentWindow({ destroyed: true });
    const { controller } = createHarness({
      confirmQuit: vi.fn(() => confirmGate.promise),
      getActivities: vi.fn((): readonly ForegroundActivity[] => [
        shellActivity("pnpm dev"),
      ]),
      getDialogParent: vi.fn(() => parent),
    });
    const secondEvent = quitEvent();

    controller.handleBeforeQuit(quitEvent());
    controller.handleBeforeQuit(secondEvent);
    await flushAsyncWork();

    expect(secondEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(parent.focus).not.toHaveBeenCalled();
  });

  it("keeps vetoing repeated before-quit events until asynchronous flush succeeds", async () => {
    const flushGate = deferred<void>();
    const { controller, deps } = createHarness({
      flushBeforeQuit: vi.fn(() => flushGate.promise),
    });
    const repeatedEvent = quitEvent();

    controller.handleBeforeQuit(quitEvent());
    await vi.waitFor(() => {
      expect(controller.getPhase()).toBe("preparing");
    });

    controller.handleBeforeQuit(repeatedEvent);

    expect(repeatedEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(deps.finalCleanup).not.toHaveBeenCalled();
    expect(deps.readConfirmationMode).toHaveBeenCalledTimes(1);
    expect(deps.confirmQuit).not.toHaveBeenCalled();
    expect(deps.flushBeforeQuit).toHaveBeenCalledTimes(1);
    expect(deps.proceedToQuit).not.toHaveBeenCalled();

    flushGate.resolve();
    await vi.waitFor(() => expect(controller.getPhase()).toBe("quitting"));

    const committedEvent = quitEvent();
    controller.handleBeforeQuit(committedEvent);
    expect(committedEvent.preventDefault).not.toHaveBeenCalled();
    expect(deps.finalCleanup).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      name: "preference read",
      makeOverrides: (error: Error): Partial<AppQuitControllerDeps> => ({
        readConfirmationMode: vi.fn(() => Promise.reject(error)),
      }),
      expectSkippedFlush: true,
    },
    {
      name: "confirmation",
      makeOverrides: (error: Error): Partial<AppQuitControllerDeps> => {
        const parent = fakeParentWindow();
        return {
          confirmQuit: vi.fn(() => Promise.reject(error)),
          getActivities: vi.fn((): readonly ForegroundActivity[] => [
            shellActivity("pnpm dev"),
          ]),
          getDialogParent: vi.fn(() => parent),
        };
      },
      expectSkippedFlush: true,
    },
    {
      name: "flush",
      makeOverrides: (error: Error): Partial<AppQuitControllerDeps> => ({
        flushBeforeQuit: vi.fn(() => Promise.reject(error)),
      }),
      expectSkippedFlush: false,
    },
  ] as const)("logs $name errors, returns to idle, and does not proceed", async ({
    makeOverrides,
    expectSkippedFlush,
  }) => {
    const error = new Error("quit failed");
    const { controller, deps } = createHarness(makeOverrides(error));

    controller.handleBeforeQuit(quitEvent());
    await vi.waitFor(() => {
      expect(controller.getPhase()).toBe("idle");
    });

    expect(deps.logFailure).toHaveBeenCalledWith(error);
    expect(deps.proceedToQuit).not.toHaveBeenCalled();
    if (expectSkippedFlush) {
      expect(deps.flushBeforeQuit).not.toHaveBeenCalled();
    } else {
      expect(deps.flushBeforeQuit).toHaveBeenCalledTimes(1);
    }
  });
});

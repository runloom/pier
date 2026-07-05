import type { TaskService } from "@main/services/tasks/task-service.ts";
import { createTaskService } from "@main/services/tasks/task-service.ts";
import type {
  TaskCandidate,
  TaskLaunchPlan,
  TaskListResult,
} from "@shared/contracts/tasks.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { collectTaskCandidates } = vi.hoisted(() => ({
  collectTaskCandidates: vi.fn(),
}));

vi.mock("@main/services/tasks/task-sources.ts", async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return {
    ...actual,
    collectTaskCandidates,
  };
});

type PrepareSpawnArgs = Parameters<TaskService["prepareSpawn"]>[0];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

function taskCandidate(projectRootPath: string): TaskCandidate {
  return {
    commandSpec: { command: "pnpm run test", kind: "shell" },
    concurrencyPolicy: "dedupe",
    cwd: projectRootPath,
    description: "vitest",
    id: "package-script:test",
    label: "test",
    source: "package-script",
  };
}

function taskList(projectRootPath: string): TaskListResult {
  return {
    errors: [],
    projectRootPath,
    tasks: [taskCandidate(projectRootPath)],
  };
}

function taskLaunch(projectRootPath: string): TaskLaunchPlan {
  return {
    command: "pnpm run test",
    cwd: projectRootPath,
    focus: true,
    label: "test",
    presentation: {},
    projectRootPath,
    rawCommand: "pnpm run test",
    source: "package-script",
    tab: { title: "test" },
    taskId: "package-script:test",
  };
}

function serviceWithEmptyRecent(): TaskService {
  return createTaskService({
    readRecentState: async () => ({ entries: [], version: 1 }),
    writeRecentState: async () => undefined,
  });
}

describe("task-service launch latency fast paths", () => {
  beforeEach(() => {
    collectTaskCandidates.mockReset();
  });

  it("reuses an in-flight project task list for an immediate prepareSpawn", async () => {
    const projectRootPath = "/repo";
    const service = serviceWithEmptyRecent();
    const collection = deferred<TaskListResult>();
    collectTaskCandidates.mockReturnValue(collection.promise);

    const listed = service.list({ projectRootPath });
    const prepared = service.prepareSpawn({
      projectRootPath,
      taskId: "package-script:test",
    });

    collection.resolve(taskList(projectRootPath));

    await expect(listed).resolves.toEqual(taskList(projectRootPath));
    await expect(prepared).resolves.toMatchObject({ status: "ready" });
    expect(collectTaskCandidates).toHaveBeenCalledTimes(1);
    expect(collectTaskCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ projectRootPath })
    );
  });

  it("does not let a late in-flight task list repopulate an invalidated cache", async () => {
    const projectRootPath = "/repo";
    const service = serviceWithEmptyRecent();
    const staleCollection = deferred<TaskListResult>();
    const freshList = {
      ...taskList(projectRootPath),
      tasks: [{ ...taskCandidate(projectRootPath), label: "fresh test" }],
    } satisfies TaskListResult;
    collectTaskCandidates
      .mockReturnValueOnce(staleCollection.promise)
      .mockResolvedValueOnce(freshList);

    const staleList = service.list({ projectRootPath });
    await service.recordRecent(taskLaunch(projectRootPath));
    staleCollection.resolve(taskList(projectRootPath));
    await expect(staleList).resolves.toEqual(taskList(projectRootPath));

    await expect(service.list({ projectRootPath })).resolves.toEqual(freshList);
    expect(collectTaskCandidates).toHaveBeenCalledTimes(2);
  });

  it("returns an already-running panel without collecting task sources", async () => {
    const projectRootPath = "/repo";
    const service = serviceWithEmptyRecent();
    service.recordStarted({
      panelId: "terminal-task",
      projectRootPath,
      taskId: "package-script:test",
      windowId: "main",
    });
    collectTaskCandidates.mockResolvedValue(taskList(projectRootPath));

    await expect(
      service.prepareSpawn({
        forceRestart: false,
        projectRootPath,
        taskId: "package-script:test",
      })
    ).resolves.toEqual({
      panelId: "terminal-task",
      status: "already-running",
      windowId: "main",
    });
    expect(collectTaskCandidates).not.toHaveBeenCalled();
  });

  it("lets an explicit force restart bypass the already-running fast path", async () => {
    const projectRootPath = "/repo";
    const service = serviceWithEmptyRecent();
    service.recordStarted({
      panelId: "terminal-task",
      projectRootPath,
      taskId: "package-script:test",
      windowId: "main",
    });
    collectTaskCandidates.mockResolvedValue(taskList(projectRootPath));

    const restartRequest = {
      forceRestart: true,
      projectRootPath,
      taskId: "package-script:test",
    } as PrepareSpawnArgs & { forceRestart: true };

    const preparation = await service.prepareSpawn(restartRequest);

    expect(preparation).toMatchObject({
      reusablePanels: {
        "package-script:test": { panelId: "terminal-task", windowId: "main" },
      },
      status: "ready",
    });
    expect(collectTaskCandidates).toHaveBeenCalledTimes(1);
  });
});

import { createTaskService } from "@main/services/tasks/task-service.ts";
import type { TaskLaunchPlan } from "@shared/contracts/tasks.ts";
import { describe, expect, it, vi } from "vitest";

function taskLaunch(
  projectRootPath: string,
  overrides: Partial<TaskLaunchPlan> = {}
): TaskLaunchPlan {
  return {
    command: "true",
    cwd: projectRootPath,
    focus: true,
    label: "test",
    presentation: {},
    projectRootPath,
    rawCommand: "true",
    source: "package-script",
    tab: { title: "test" },
    taskId: "package-script:test",
    ...overrides,
  };
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (condition()) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  expect(condition()).toBe(true);
}

describe("task-service background runs", () => {
  it("records completion for a task that exits immediately after spawn", async () => {
    const projectRootPath = "/repo";
    const service = createTaskService({
      processEnvironment: {
        resolve: async () => ({
          diagnostics: {
            cacheHit: false,
            pathChanged: false,
            shellEnvStatus: "skipped",
            source: "task",
          },
          env: {},
        }),
      },
      readRecentState: async () => ({ entries: [], version: 1 }),
      spawnBackgroundTask: ({ onExit }) => {
        onExit(0);
        return { kill: () => undefined };
      },
      writeRecentState: async () => undefined,
    });

    const started = await service.startBackgroundRun({
      launches: [taskLaunch(projectRootPath)],
      projectRootPath,
      rootTaskId: "package-script:test",
      windowId: "main",
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(service.statusRun(started.runId)).toMatchObject({
      nodes: {
        "package-script:test": {
          exitCode: 0,
          status: "succeeded",
        },
      },
      status: "succeeded",
    });
    expect(service.backgroundSnapshot()).toMatchObject({
      runs: {
        [projectRootPath]: {
          "package-script:test": {
            exitCode: 0,
            status: "succeeded",
          },
        },
      },
    });
  });

  it("kills running background children when the task service is disposed", async () => {
    const projectRootPath = "/repo";
    const kill = vi.fn();
    let spawned = false;
    const service = createTaskService({
      processEnvironment: {
        resolve: async () => ({
          diagnostics: {
            cacheHit: false,
            pathChanged: false,
            shellEnvStatus: "skipped",
            source: "task",
          },
          env: {},
        }),
      },
      readRecentState: async () => ({ entries: [], version: 1 }),
      spawnBackgroundTask: () => {
        spawned = true;
        return { kill };
      },
      writeRecentState: async () => undefined,
    });

    await service.startBackgroundRun({
      launches: [taskLaunch(projectRootPath)],
      projectRootPath,
      rootTaskId: "package-script:test",
      windowId: "main",
    });

    await waitFor(() => spawned);

    service.dispose();
    service.dispose();

    expect(kill).toHaveBeenCalledTimes(1);
    expect(service.backgroundSnapshot()).toMatchObject({
      runs: {
        [projectRootPath]: {
          "package-script:test": {
            status: "cancelled",
          },
        },
      },
    });
  });

  it("publishes blocked background roots that never opened a panel", async () => {
    const projectRootPath = "/repo";
    const exits = new Map<string, (exitCode: number | null) => void>();
    const service = createTaskService({
      processEnvironment: {
        resolve: async () => ({
          diagnostics: {
            cacheHit: false,
            pathChanged: false,
            shellEnvStatus: "skipped",
            source: "task",
          },
          env: {},
        }),
      },
      readRecentState: async () => ({ entries: [], version: 1 }),
      spawnBackgroundTask: ({ command, onExit }) => {
        exits.set(command, onExit);
        return { kill: () => undefined };
      },
      writeRecentState: async () => undefined,
    });
    const lint = taskLaunch(projectRootPath, {
      command: "lint",
      label: "lint",
      rawCommand: "lint",
      tab: { title: "lint" },
      taskId: "package-script:lint",
    });
    const verify = taskLaunch(projectRootPath, {
      command: "verify",
      dependsOn: ["package-script:lint"],
      dependsOrder: "sequence",
      label: "verify",
      rawCommand: "verify",
      tab: { title: "verify" },
      taskId: "package-script:verify",
    });

    await service.startBackgroundRun({
      launches: [lint, verify],
      projectRootPath,
      rootTaskId: "package-script:verify",
      windowId: "main",
    });
    await waitFor(() => exits.has("lint"));

    exits.get("lint")?.(1);
    await waitFor(
      () =>
        service.backgroundSnapshot().runs[projectRootPath]?.[
          "package-script:verify"
        ]?.status === "blocked"
    );

    const runId =
      service.backgroundSnapshot().runs[projectRootPath]?.[
        "package-script:verify"
      ]?.runId ?? "";

    expect(service.statusRun(runId)).toMatchObject({
      nodes: {
        "package-script:verify": {
          blockedBy: "package-script:lint",
          status: "blocked",
        },
      },
      status: "blocked",
    });
    expect(service.backgroundSnapshot()).toMatchObject({
      runs: {
        [projectRootPath]: {
          "package-script:lint": {
            exitCode: 1,
            status: "failed",
          },
          "package-script:verify": {
            status: "blocked",
          },
        },
      },
    });
  });
});

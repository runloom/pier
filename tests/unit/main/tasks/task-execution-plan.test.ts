import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTaskService } from "@main/services/tasks/task-service.ts";
import { TASK_EXIT_TITLE_PREFIX } from "@shared/contracts/tasks.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TASK_VAR_PREFIX = "$";
const INPUT_PKG_VAR = `${TASK_VAR_PREFIX}{input:pkg}`;
const ENV_TARGET_VAR = `${TASK_VAR_PREFIX}{env:PIER_TARGET}`;
const WORKSPACE_FOLDER_VAR = `${TASK_VAR_PREFIX}{workspaceFolder}`;
const WORKSPACE_FOLDER_BASENAME_VAR = `${TASK_VAR_PREFIX}{workspaceFolderBasename}`;
const DAY_MS = 86_400_000;

describe("task execution planning", () => {
  let projectRoot = "";
  let homeDir = "";

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "pier-task-plan-"));
    homeDir = await mkdtemp(join(tmpdir(), "pier-task-plan-home-"));
    vi.stubEnv("PIER_TARGET", "local");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(projectRoot, { force: true, recursive: true });
    await rm(homeDir, { force: true, recursive: true });
  });

  it("returns required input requests before building a plan", async () => {
    await mkdir(join(projectRoot, ".vscode"));
    await writeFile(
      join(projectRoot, ".vscode", "tasks.json"),
      JSON.stringify({
        inputs: [
          {
            default: "web",
            description: "Target package",
            id: "pkg",
            type: "promptString",
          },
        ],
        tasks: [
          {
            command: `pnpm --filter ${INPUT_PKG_VAR} test`,
            label: "test package",
            type: "shell",
          },
        ],
        version: "2.0.0",
      })
    );
    const service = createTaskService({
      homeDir,
      readRecentState: async () => ({ entries: [], version: 1 }),
      writeRecentState: async () => undefined,
    });
    const listed = await service.list({ projectRoot });
    const task = listed.tasks.find(
      (candidate) => candidate.label === "test package"
    );

    const plan = await service.prepareSpawn({
      projectRoot,
      taskId: task?.id ?? "",
    });

    expect(plan).toEqual({
      inputs: [
        {
          default: "web",
          description: "Target package",
          id: "pkg",
          type: "promptString",
        },
      ],
      status: "requires-input",
    });
  });

  it("resolves variables, process args and sequential dependencies", async () => {
    await mkdir(join(projectRoot, ".vscode"));
    await writeFile(
      join(projectRoot, ".vscode", "tasks.json"),
      JSON.stringify({
        tasks: [
          {
            command: "pnpm",
            args: ["lint", ENV_TARGET_VAR],
            label: "lint",
            type: "process",
          },
          {
            command: `pnpm test ${WORKSPACE_FOLDER_BASENAME_VAR}`,
            dependsOn: ["lint"],
            dependsOrder: "sequence",
            label: "verify",
            options: {
              cwd: WORKSPACE_FOLDER_VAR,
              env: {
                PIER_ENV: ENV_TARGET_VAR,
              },
            },
            presentation: {
              clear: true,
              echo: true,
              reveal: "always",
            },
            type: "shell",
          },
        ],
        version: "2.0.0",
      })
    );
    const service = createTaskService({
      homeDir,
      readRecentState: async () => ({ entries: [], version: 1 }),
      writeRecentState: async () => undefined,
    });
    const listed = await service.list({ projectRoot });
    const task = listed.tasks.find((candidate) => candidate.label === "verify");

    const plan = await service.prepareSpawn({
      projectRoot,
      taskId: task?.id ?? "",
    });

    expect(plan).toMatchObject({ status: "ready" });
    if (plan.status !== "ready") {
      throw new Error("expected ready plan");
    }
    expect(plan.launches.map((launch) => launch.label)).toEqual([
      "lint",
      "verify",
    ]);
    expect(plan.launches[1]?.dependsOn).toEqual([plan.launches[0]?.taskId]);
    expect(plan.launches[0]?.command).toContain("pnpm lint local");
    expect(plan.launches[1]?.cwd).toBe(projectRoot);
    expect(plan.launches[1]?.command).toContain("pnpm test ");
    expect(plan.launches[1]?.command).toContain(TASK_EXIT_TITLE_PREFIX);
    expect(plan.launches[1]?.env).toEqual({ PIER_ENV: "local" });
    expect(plan.launches[1]?.tab).toMatchObject({
      badge: { label: "VS Code" },
      icon: { id: "pier.task", label: "Task" },
      state: { label: "Running", status: "running" },
      title: "verify",
      tooltip: {
        lines: expect.arrayContaining([
          { label: "Command", value: expect.stringContaining("pnpm test ") },
          { label: "CWD", value: projectRoot },
        ]),
      },
    });
  });

  it("resolves VS Code dependencies inside the VS Code task source", async () => {
    await writeFile(
      join(projectRoot, "package.json"),
      JSON.stringify({
        scripts: {
          lint: "echo package-lint",
        },
      })
    );
    await mkdir(join(projectRoot, ".vscode"));
    await writeFile(
      join(projectRoot, ".vscode", "tasks.json"),
      JSON.stringify({
        tasks: [
          {
            command: "echo vscode-lint",
            label: "lint",
            type: "shell",
          },
          {
            command: "echo verify",
            dependsOn: ["lint"],
            dependsOrder: "sequence",
            label: "verify",
            type: "shell",
          },
        ],
        version: "2.0.0",
      })
    );
    const service = createTaskService({
      homeDir,
      readRecentState: async () => ({ entries: [], version: 1 }),
      writeRecentState: async () => undefined,
    });
    const listed = await service.list({ projectRoot });
    const task = listed.tasks.find(
      (candidate) =>
        candidate.source === "vscode" && candidate.label === "verify"
    );

    const plan = await service.prepareSpawn({
      projectRoot,
      taskId: task?.id ?? "",
    });

    expect(plan).toMatchObject({ status: "ready" });
    if (plan.status !== "ready") {
      throw new Error("expected ready plan");
    }
    expect(plan.launches.map((launch) => launch.label)).toEqual([
      "lint",
      "verify",
    ]);
    expect(plan.launches[0]?.tab).toMatchObject({
      badge: { label: "VS Code" },
    });
    expect(plan.launches[0]?.rawCommand).toBe("echo vscode-lint");
    expect(plan.launches[1]?.dependsOn).toEqual([plan.launches[0]?.taskId]);
  });

  it("rejects VS Code plans with missing dependencies", async () => {
    await mkdir(join(projectRoot, ".vscode"));
    await writeFile(
      join(projectRoot, ".vscode", "tasks.json"),
      JSON.stringify({
        tasks: [
          {
            command: "echo verify",
            dependsOn: ["missing"],
            label: "verify",
            type: "shell",
          },
        ],
        version: "2.0.0",
      })
    );
    const service = createTaskService({
      homeDir,
      readRecentState: async () => ({ entries: [], version: 1 }),
      writeRecentState: async () => undefined,
    });
    const listed = await service.list({ projectRoot });
    const task = listed.tasks.find((candidate) => candidate.label === "verify");

    await expect(
      service.prepareSpawn({ projectRoot, taskId: task?.id ?? "" })
    ).resolves.toEqual({
      message: "任务 verify 依赖不存在: missing",
      status: "unsupported",
    });
  });

  it("rejects VS Code dependency cycles", async () => {
    await mkdir(join(projectRoot, ".vscode"));
    await writeFile(
      join(projectRoot, ".vscode", "tasks.json"),
      JSON.stringify({
        tasks: [
          {
            command: "echo a",
            dependsOn: ["b"],
            label: "a",
            type: "shell",
          },
          {
            command: "echo b",
            dependsOn: ["a"],
            label: "b",
            type: "shell",
          },
        ],
        version: "2.0.0",
      })
    );
    const service = createTaskService({
      homeDir,
      readRecentState: async () => ({ entries: [], version: 1 }),
      writeRecentState: async () => undefined,
    });
    const listed = await service.list({ projectRoot });
    const task = listed.tasks.find((candidate) => candidate.label === "a");

    await expect(
      service.prepareSpawn({ projectRoot, taskId: task?.id ?? "" })
    ).resolves.toEqual({
      message: "任务依赖存在循环: a -> b -> a",
      status: "unsupported",
    });
  });

  it("rejects duplicate dependency labels inside the same task source", async () => {
    await mkdir(join(projectRoot, ".vscode"));
    await writeFile(
      join(projectRoot, ".vscode", "tasks.json"),
      JSON.stringify({
        tasks: [
          {
            command: "echo lint-one",
            label: "lint",
            type: "shell",
          },
          {
            command: "echo lint-two",
            label: "lint",
            type: "shell",
          },
          {
            command: "echo verify",
            dependsOn: ["lint"],
            label: "verify",
            type: "shell",
          },
        ],
        version: "2.0.0",
      })
    );
    const service = createTaskService({
      homeDir,
      readRecentState: async () => ({ entries: [], version: 1 }),
      writeRecentState: async () => undefined,
    });
    const listed = await service.list({ projectRoot });
    const task = listed.tasks.find((candidate) => candidate.label === "verify");

    await expect(
      service.prepareSpawn({ projectRoot, taskId: task?.id ?? "" })
    ).resolves.toEqual({
      message: "任务标签重复: vscode lint",
      status: "unsupported",
    });
  });

  it("uses the running registry only for non-concurrent tasks", async () => {
    await mkdir(join(projectRoot, ".zed"));
    await writeFile(
      join(projectRoot, ".zed", "tasks.json"),
      JSON.stringify([
        {
          allow_concurrent_runs: false,
          command: "pnpm dev",
          label: "dev",
        },
        {
          allow_concurrent_runs: true,
          command: "pnpm test",
          label: "test",
        },
      ])
    );
    const service = createTaskService({ homeDir });
    const listed = await service.list({ projectRoot });
    const dev = listed.tasks.find((candidate) => candidate.label === "dev");
    const test = listed.tasks.find((candidate) => candidate.label === "test");
    service.recordStarted({
      panelId: "terminal-dev",
      projectRoot,
      taskId: dev?.id ?? "",
    });
    service.recordStarted({
      panelId: "terminal-test",
      projectRoot,
      taskId: test?.id ?? "",
    });

    await expect(
      service.prepareSpawn({ projectRoot, taskId: dev?.id ?? "" })
    ).resolves.toEqual({
      panelId: "terminal-dev",
      status: "already-running",
    });
    await expect(
      service.prepareSpawn({ projectRoot, taskId: test?.id ?? "" })
    ).resolves.toMatchObject({ status: "ready" });

    service.markPanelClosed("terminal-dev");
    await expect(
      service.prepareSpawn({ projectRoot, taskId: dev?.id ?? "" })
    ).resolves.toMatchObject({ status: "ready" });
  });

  it("dedupes a root task while it is still waiting for dependencies", async () => {
    await mkdir(join(projectRoot, ".vscode"));
    await writeFile(
      join(projectRoot, ".vscode", "tasks.json"),
      JSON.stringify({
        tasks: [
          {
            command: "echo lint",
            label: "lint",
            type: "shell",
          },
          {
            command: "echo verify",
            dependsOn: ["lint"],
            dependsOrder: "sequence",
            label: "verify",
            type: "shell",
          },
        ],
        version: "2.0.0",
      })
    );
    const service = createTaskService({
      homeDir,
      readRecentState: async () => ({ entries: [], version: 1 }),
      writeRecentState: async () => undefined,
    });
    const listed = await service.list({ projectRoot });
    const verify = listed.tasks.find(
      (candidate) => candidate.label === "verify"
    );
    const plan = await service.prepareSpawn({
      projectRoot,
      taskId: verify?.id ?? "",
    });
    if (plan.status !== "ready") {
      throw new Error("expected ready plan");
    }

    await service.startRun({
      launches: plan.launches,
      openTerminal: (launchPlan) =>
        Promise.resolve({
          panelId: `panel-${launchPlan.taskId}`,
          windowId: "main",
        }),
      projectRoot,
      rootTaskId: verify?.id ?? "",
    });

    await expect(
      service.prepareSpawn({ projectRoot, taskId: verify?.id ?? "" })
    ).resolves.toEqual({
      panelId: plan.launches[0]?.taskId
        ? `panel-${plan.launches[0].taskId}`
        : "",
      status: "already-running",
      windowId: "main",
    });
  });

  it("keeps deduping a root task after an earlier dependency panel finishes", async () => {
    await mkdir(join(projectRoot, ".vscode"));
    await writeFile(
      join(projectRoot, ".vscode", "tasks.json"),
      JSON.stringify({
        tasks: [
          {
            command: "echo client",
            label: "client",
            type: "shell",
          },
          {
            command: "echo server",
            label: "server",
            type: "shell",
          },
          {
            command: "echo verify",
            dependsOn: ["client", "server"],
            dependsOrder: "parallel",
            label: "verify",
            type: "shell",
          },
        ],
        version: "2.0.0",
      })
    );
    const service = createTaskService({
      homeDir,
      readRecentState: async () => ({ entries: [], version: 1 }),
      writeRecentState: async () => undefined,
    });
    const listed = await service.list({ projectRoot });
    const verify = listed.tasks.find(
      (candidate) => candidate.label === "verify"
    );
    const plan = await service.prepareSpawn({
      projectRoot,
      taskId: verify?.id ?? "",
    });
    if (plan.status !== "ready") {
      throw new Error("expected ready plan");
    }

    await service.startRun({
      launches: plan.launches,
      openTerminal: (launchPlan) =>
        Promise.resolve({
          panelId: `panel-${launchPlan.label}`,
          windowId: "main",
        }),
      projectRoot,
      rootTaskId: verify?.id ?? "",
    });
    await service.completePanel("panel-client", 0, "main");

    await expect(
      service.prepareSpawn({ projectRoot, taskId: verify?.id ?? "" })
    ).resolves.toEqual({
      panelId: "panel-server",
      status: "already-running",
      windowId: "main",
    });
  });

  it("keeps started task records until failed run panels are marked closed", async () => {
    await mkdir(join(projectRoot, ".vscode"));
    await writeFile(
      join(projectRoot, ".vscode", "tasks.json"),
      JSON.stringify({
        tasks: [
          {
            command: "echo client",
            label: "client",
            type: "shell",
          },
          {
            command: "echo server",
            label: "server",
            type: "shell",
          },
          {
            command: "echo verify",
            dependsOn: ["client", "server"],
            dependsOrder: "parallel",
            label: "verify",
            type: "shell",
          },
        ],
        version: "2.0.0",
      })
    );
    const service = createTaskService({
      homeDir,
      readRecentState: async () => ({ entries: [], version: 1 }),
      writeRecentState: async () => undefined,
    });
    const listed = await service.list({ projectRoot });
    const client = listed.tasks.find(
      (candidate) => candidate.label === "client"
    );
    const verify = listed.tasks.find(
      (candidate) => candidate.label === "verify"
    );
    const plan = await service.prepareSpawn({
      projectRoot,
      taskId: verify?.id ?? "",
    });
    if (plan.status !== "ready") {
      throw new Error("expected ready plan");
    }

    await expect(
      service.startRun({
        launches: plan.launches,
        openTerminal: (launchPlan) => {
          if (launchPlan.label === "server") {
            return Promise.reject(new Error("terminal unavailable"));
          }
          return Promise.resolve({
            panelId: `panel-${launchPlan.taskId}`,
            windowId: "main",
          });
        },
        projectRoot,
        rootTaskId: verify?.id ?? "",
      })
    ).rejects.toThrow("terminal unavailable");

    await expect(
      service.prepareSpawn({ projectRoot, taskId: client?.id ?? "" })
    ).resolves.toMatchObject({
      panelId: `panel-${client?.id ?? ""}`,
      status: "already-running",
      windowId: "main",
    });

    service.markPanelClosed(`panel-${client?.id ?? ""}`, "main");

    await expect(
      service.prepareSpawn({ projectRoot, taskId: client?.id ?? "" })
    ).resolves.toMatchObject({
      status: "ready",
    });
  });

  it("persists recent task history through injected storage", async () => {
    const writes: unknown[] = [];
    const now = 1_772_000_000_000;
    const service = createTaskService({
      homeDir,
      now: () => now,
      readRecentState: async () => ({ entries: [], version: 1 }),
      writeRecentState: (state) => {
        writes.push(state);
        return Promise.resolve();
      },
    });

    await service.recordRecent({
      command: "pnpm check",
      cwd: projectRoot,
      focus: true,
      label: "check",
      presentation: {},
      projectRoot,
      rawCommand: "pnpm check",
      tab: { title: "check" },
      taskId: "package-script:check",
    });

    expect(writes).toEqual([
      {
        entries: [
          {
            command: "pnpm check",
            cwd: projectRoot,
            lastUsedAt: now,
            label: "check",
            source: "history",
            taskId: "package-script:check",
            useCount: 1,
          },
        ],
        version: 1,
      },
    ]);
    await expect(service.list({ projectRoot })).resolves.toMatchObject({
      tasks: expect.arrayContaining([
        expect.objectContaining({
          commandSpec: { command: "pnpm check", kind: "shell" },
          label: "check",
          source: "history",
        }),
      ]),
    });
  });

  it("sorts task candidates by recent use weight", async () => {
    const now = 100 * DAY_MS;
    await writeFile(
      join(projectRoot, "package.json"),
      JSON.stringify({
        scripts: {
          alpha: "node alpha.js",
          beta: "node beta.js",
          gamma: "node gamma.js",
        },
      })
    );
    await writeFile(join(projectRoot, "pnpm-lock.yaml"), "lockfileVersion: 9");
    const service = createTaskService({
      homeDir,
      now: () => now,
      readRecentState: async () => ({
        entries: [
          {
            command: "pnpm run alpha",
            cwd: projectRoot,
            label: "alpha",
            lastUsedAt: now,
            source: "history",
            taskId: "package-script:alpha",
            useCount: 1,
          },
          {
            command: "pnpm run beta",
            cwd: projectRoot,
            label: "beta",
            lastUsedAt: now - 14 * DAY_MS,
            source: "history",
            taskId: "package-script:beta",
            useCount: 4,
          },
        ],
        version: 1,
      }),
      writeRecentState: async () => undefined,
    });

    const listed = await service.list({ projectRoot });

    expect(
      listed.tasks
        .filter((task) => task.source === "package-script")
        .map((task) => task.label)
    ).toEqual(["beta", "alpha", "gamma"]);
  });
});

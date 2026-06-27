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
    const service = createTaskService({ homeDir });
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
    const service = createTaskService({ homeDir });
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
    expect(plan.launches[0]?.command).toContain("pnpm lint local");
    expect(plan.launches[1]?.cwd).toBe(projectRoot);
    expect(plan.launches[1]?.command).toContain("pnpm test ");
    expect(plan.launches[1]?.command).toContain(TASK_EXIT_TITLE_PREFIX);
    expect(plan.launches[1]?.env).toEqual({ PIER_ENV: "local" });
    expect(plan.launches[1]?.tab).toMatchObject({
      badge: { label: "VS Code" },
      icon: { id: "pier.task", label: "Task" },
      state: { busy: true, label: "Running" },
      title: "verify",
      tooltip: {
        lines: expect.arrayContaining([
          { label: "Command", value: expect.stringContaining("pnpm test ") },
          { label: "CWD", value: projectRoot },
        ]),
      },
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

  it("persists recent task history through injected storage", async () => {
    const writes: unknown[] = [];
    const service = createTaskService({
      homeDir,
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
      tab: { title: "check" },
      taskId: "package-script:check",
    });

    expect(writes).toEqual([
      {
        entries: [
          {
            command: "pnpm check",
            cwd: projectRoot,
            label: "check",
            source: "history",
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
});

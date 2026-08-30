// @vitest-environment node
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { executeCanvasCommand } from "../../../../src/main/app-core/commands/canvas-command.ts";
import {
  canvasCommandTaskId,
  hashCanvasCommand,
  invokeDeclaredCanvasCommand,
} from "../../../../src/main/services/canvas-command/invoke.ts";
import {
  createCanvasTrustService,
  flushCanvasTrustState,
} from "../../../../src/main/services/canvas-trust/service.ts";
import { canvasCommandCanonical } from "../../../../src/shared/contracts/canvas-command.ts";

const dirs: string[] = [];

afterEach(async () => {
  await flushCanvasTrustState();
  for (const dir of dirs.splice(0)) {
    await rm(dir, { force: true, recursive: true });
  }
});

async function makeProject(): Promise<{
  project: string;
  userData: string;
}> {
  const userData = await mkdtemp(join(tmpdir(), "pier-canvas-command-"));
  dirs.push(userData);
  const project = join(userData, "proj");
  await mkdir(join(project, ".pier/canvases/demo"), { recursive: true });
  await writeFile(
    join(project, ".pier/canvases/demo/hello.canvas.tsx"),
    "export default function Demo() { return null }\n"
  );
  return { project, userData };
}

async function writeInstance(
  project: string,
  commands: unknown
): Promise<void> {
  await writeFile(
    join(project, ".pier/canvases/demo/instance.json"),
    `${JSON.stringify({ commands })}\n`
  );
}

const CANVAS_PATH = ".pier/canvases/demo/hello.canvas.tsx";

describe("invokeDeclaredCanvasCommand", () => {
  it("denies an untrusted project that is not pier-home", async () => {
    const { project, userData } = await makeProject();
    const trust = createCanvasTrustService({ userDataDir: userData });
    const spawn = vi.fn();
    const outcome = await invokeDeclaredCanvasCommand({
      canvasPath: CANVAS_PATH,
      deps: {
        confirm: vi.fn(async () => true),
        isHomeRoot: async () => false,
        spawn,
        trust,
      },
      key: "refresh",
      projectRootPath: project,
      windowId: "win-1",
    });
    expect(outcome).toMatchObject({
      code: "permission_denied",
      kind: "error",
    });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("returns not_found for a key that instance.json did not declare", async () => {
    const { project, userData } = await makeProject();
    await writeInstance(project, [{ command: "echo hello", key: "refresh" }]);
    const trust = createCanvasTrustService({ userDataDir: userData });
    await trust.grant(project);
    const outcome = await invokeDeclaredCanvasCommand({
      canvasPath: CANVAS_PATH,
      deps: {
        confirm: vi.fn(async () => true),
        isHomeRoot: async () => false,
        spawn: vi.fn(async () => ({ runId: "run-1" })),
        trust,
      },
      key: "missing",
      projectRootPath: project,
      windowId: "win-1",
    });
    expect(outcome).toMatchObject({ code: "not_found", kind: "error" });
  });

  it("confirms the first run, remembers the hash, then spawns without a second confirm", async () => {
    const { project, userData } = await makeProject();
    await writeInstance(project, [{ command: "echo hello", key: "refresh" }]);
    const trust = createCanvasTrustService({ userDataDir: userData });
    await trust.grant(project);
    const confirm = vi.fn(async () => true);
    const spawn = vi.fn(async () => ({ runId: "run-1" }));
    const deps = {
      confirm,
      isHomeRoot: async () => false,
      spawn,
      trust,
    };
    const first = await invokeDeclaredCanvasCommand({
      canvasPath: CANVAS_PATH,
      deps,
      key: "refresh",
      projectRootPath: project,
      windowId: "win-1",
    });
    expect(first).toEqual({ kind: "started", runId: "run-1" });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith("echo hello", "win-1");
    const realProject = await realpath(project);
    expect(spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        launches: [
          expect.objectContaining({
            command: "echo hello",
            cwd: realProject,
            focus: false,
            rawCommand: "echo hello",
            source: "history",
            taskId: canvasCommandTaskId(CANVAS_PATH, "refresh"),
          }),
        ],
        windowId: "win-1",
      })
    );

    spawn.mockClear();
    const second = await invokeDeclaredCanvasCommand({
      canvasPath: CANVAS_PATH,
      deps,
      key: "refresh",
      projectRootPath: project,
      windowId: "win-1",
    });
    expect(second).toEqual({ kind: "started", runId: "run-1" });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("asks again after the declared command hash changes", async () => {
    const { project, userData } = await makeProject();
    await writeInstance(project, [{ command: "echo a", key: "refresh" }]);
    const trust = createCanvasTrustService({ userDataDir: userData });
    await trust.grant(project);
    const confirm = vi.fn(async () => true);
    const deps = {
      confirm,
      isHomeRoot: async () => false,
      spawn: vi.fn(async () => ({ runId: "run-1" })),
      trust,
    };
    await invokeDeclaredCanvasCommand({
      canvasPath: CANVAS_PATH,
      deps,
      key: "refresh",
      projectRootPath: project,
      windowId: "win-1",
    });
    await writeInstance(project, [{ command: "echo b", key: "refresh" }]);
    await invokeDeclaredCanvasCommand({
      canvasPath: CANVAS_PATH,
      deps,
      key: "refresh",
      projectRootPath: project,
      windowId: "win-1",
    });
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(confirm).toHaveBeenNthCalledWith(2, "echo b", "win-1");
  });

  it("returns cancelled without remembering when the user declines", async () => {
    const { project, userData } = await makeProject();
    await writeInstance(project, [{ command: "echo hello", key: "refresh" }]);
    const trust = createCanvasTrustService({ userDataDir: userData });
    await trust.grant(project);
    const confirm = vi.fn(async () => false);
    const spawn = vi.fn(async () => ({ runId: "run-1" }));
    const deps = {
      confirm,
      isHomeRoot: async () => false,
      spawn,
      trust,
    };
    await expect(
      invokeDeclaredCanvasCommand({
        canvasPath: CANVAS_PATH,
        deps,
        key: "refresh",
        projectRootPath: project,
        windowId: "win-1",
      })
    ).resolves.toEqual({ kind: "cancelled" });
    expect(spawn).not.toHaveBeenCalled();
    confirm.mockResolvedValueOnce(true);
    await invokeDeclaredCanvasCommand({
      canvasPath: CANVAS_PATH,
      deps,
      key: "refresh",
      projectRootPath: project,
      windowId: "win-1",
    });
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it("skips project trust for a pier-home canvas", async () => {
    const { project, userData } = await makeProject();
    await writeInstance(project, [{ command: "echo hello", key: "refresh" }]);
    const trust = createCanvasTrustService({ userDataDir: userData });
    const spawn = vi.fn(async () => ({ runId: "home-run" }));
    const outcome = await invokeDeclaredCanvasCommand({
      canvasPath: CANVAS_PATH,
      deps: {
        confirm: vi.fn(async () => true),
        isHomeRoot: async () => true,
        spawn,
        trust,
      },
      key: "refresh",
      projectRootPath: project,
      windowId: "win-1",
    });
    expect(outcome).toEqual({ kind: "started", runId: "home-run" });
    expect(spawn).toHaveBeenCalled();
  });

  it("spawns with the canvas directory when cwd is canvasDir", async () => {
    const { project, userData } = await makeProject();
    await writeInstance(project, [
      { command: "echo hello", cwd: "canvasDir", key: "refresh" },
    ]);
    const trust = createCanvasTrustService({ userDataDir: userData });
    await trust.grant(project);
    const spawn = vi.fn(async () => ({ runId: "run-1" }));
    await invokeDeclaredCanvasCommand({
      canvasPath: CANVAS_PATH,
      deps: {
        confirm: vi.fn(async () => true),
        isHomeRoot: async () => false,
        spawn,
        trust,
      },
      key: "refresh",
      projectRootPath: project,
      windowId: "win-1",
    });
    const canvasDir = await realpath(join(project, ".pier/canvases/demo"));
    expect(spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        launches: [expect.objectContaining({ cwd: canvasDir })],
      })
    );
  });

  it("runs a command declared next to a canvas under a custom content root", async () => {
    const { project, userData } = await makeProject();
    const templates = join(
      project,
      "resources/system-skills/pier-canvas/templates"
    );
    await mkdir(templates, { recursive: true });
    await writeFile(
      join(templates, "kanban.canvas.tsx"),
      "export default function Board() { return null }\n"
    );
    await writeFile(
      join(templates, "instance.json"),
      `${JSON.stringify({
        commands: [{ command: "echo board", key: "refresh" }],
      })}\n`
    );
    await mkdir(join(project, ".pier"), { recursive: true });
    await writeFile(
      join(project, ".pier/live-modules.json"),
      `${JSON.stringify({
        contentDirectories: ["resources/system-skills/pier-canvas/templates"],
        version: 1,
      })}\n`
    );
    const trust = createCanvasTrustService({ userDataDir: userData });
    await trust.grant(project);
    const spawn = vi.fn(async () => ({ runId: "custom-run" }));
    const outcome = await invokeDeclaredCanvasCommand({
      canvasPath:
        "resources/system-skills/pier-canvas/templates/kanban.canvas.tsx",
      deps: {
        confirm: vi.fn(async () => true),
        isHomeRoot: async () => false,
        spawn,
        trust,
      },
      key: "refresh",
      projectRootPath: project,
      windowId: "win-1",
    });
    expect(outcome).toEqual({ kind: "started", runId: "custom-run" });
    expect(spawn).toHaveBeenCalled();
  });

  it("accepts a pier-home canvas under canvases/", async () => {
    const userData = await mkdtemp(join(tmpdir(), "pier-canvas-command-"));
    dirs.push(userData);
    const home = join(userData, "home");
    await mkdir(join(home, "canvases/demo"), { recursive: true });
    await writeFile(
      join(home, "canvases/demo/hello.canvas.tsx"),
      "export default function Demo() { return null }\n"
    );
    await writeFile(
      join(home, "canvases/demo/instance.json"),
      `${JSON.stringify({
        commands: [{ command: "echo home", cwd: "canvasDir", key: "refresh" }],
      })}\n`
    );
    const trust = createCanvasTrustService({ userDataDir: userData });
    const spawn = vi.fn(async () => ({ runId: "home-dir-run" }));
    const outcome = await invokeDeclaredCanvasCommand({
      canvasPath: "canvases/demo/hello.canvas.tsx",
      deps: {
        confirm: vi.fn(async () => true),
        isHomeRoot: async () => true,
        spawn,
        trust,
      },
      key: "refresh",
      projectRootPath: home,
      windowId: "win-1",
    });
    expect(outcome).toEqual({ kind: "started", runId: "home-dir-run" });
    const canvasDir = await realpath(join(home, "canvases/demo"));
    expect(spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        launches: [expect.objectContaining({ cwd: canvasDir })],
      })
    );
  });

  it("hashes the canonical command for grant identity", () => {
    expect(
      hashCanvasCommand(canvasCommandCanonical({ command: "echo hello" }))
    ).toHaveLength(64);
  });
});

describe("executeCanvasCommand", () => {
  it("starts a background run without recording recent tasks", async () => {
    const { project, userData } = await makeProject();
    await writeInstance(project, [{ command: "echo hello", key: "refresh" }]);
    const trust = createCanvasTrustService({ userDataDir: userData });
    await trust.grant(project);
    const startBackgroundRun = vi.fn(async () => ({ runId: "run-9" }));
    const result = await executeCanvasCommand(
      "req-1",
      {
        payload: {
          canvasPath: CANVAS_PATH,
          key: "refresh",
          projectRootPath: project,
        },
        type: "canvasCommand.invoke",
      },
      {
        canvasTrust: trust,
        pierHome: undefined,
        rendererCommand: {
          execute: vi.fn(async () => ({
            data: true,
            ok: true,
            requestId: "confirm-1",
          })),
        },
        tasks: { startBackgroundRun },
      } as never,
      { runtimeWindowId: "win-1" }
    );
    expect(result).toEqual({
      data: { kind: "started", runId: "run-9" },
      ok: true,
      requestId: "req-1",
    });
    expect(startBackgroundRun).toHaveBeenCalledWith(
      expect.objectContaining({
        recordRecent: false,
        windowId: "win-1",
      })
    );
  });
});

// @vitest-environment node

import type * as ChildProcessModule from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const childProcessMocks = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcessModule>();
  return { ...actual, spawn: childProcessMocks.spawn };
});

import {
  createPosixProcessTreeHandle,
  getRetainedWindowsProcessTree,
  LSP_EXIT_GRACE_MS,
  launchWindowsProcessTree,
} from "../../../../src/main/services/lsp/process-termination.ts";
import { createLspSessionRuntime } from "../../../../src/main/services/lsp/session-runtime.ts";
import { spawnWindowsSupervisor } from "../../../../src/main/services/lsp/windows-supervisor.ts";
import {
  FakeLspChild,
  FakeWindowsSupervisorChild,
  flushMicrotasks,
} from "./test-fixtures.ts";

function esrch() {
  return Object.assign(new Error("no such process"), { code: "ESRCH" });
}

function createFakeWindowsAddon() {
  const job = { kind: "job" };
  const processHandle = { kind: "process" };
  let activeProcesses = 1;
  return {
    assignProcess: vi.fn(),
    close: vi.fn(),
    createJob: vi.fn(() => job),
    job,
    openProcess: vi.fn(() => processHandle),
    processHandle,
    queryActiveProcesses: vi.fn(() => activeProcesses),
    setActiveProcesses(value: number) {
      activeProcesses = value;
    },
    terminateJob: vi.fn(() => {
      activeProcesses = 0;
    }),
    terminateProcessAndWait: vi.fn(async () => undefined),
  };
}

function createFakeSupervisor(pid = 7301) {
  const child = new FakeLspChild(pid);
  const terminal = Promise.withResolvers<void>();
  child.once("close", () => terminal.resolve());
  return {
    child,
    closeControl: vi.fn(),
    ready: Promise.resolve(),
    sendStart: vi.fn(),
    terminal: terminal.promise,
  };
}

describe("POSIX LSP process groups", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("continues probing and signalling the negative process group after its leader exits", async () => {
    const calls: [number, NodeJS.Signals | 0][] = [];
    let groupAlive = true;
    const processKill = vi.fn((pid: number, signal: NodeJS.Signals | 0) => {
      calls.push([pid, signal]);
      if (!groupAlive) {
        throw esrch();
      }
      return true;
    });
    const tree = createPosixProcessTreeHandle({
      pgid: 4242,
      pollIntervalMs: 10,
      processKill,
    });

    expect(await tree.isAlive()).toBe(true);
    await tree.gracefulTerminate();
    await tree.forceTerminate();
    expect(calls).toEqual([
      [-4242, 0],
      [-4242, "SIGTERM"],
      [-4242, "SIGKILL"],
    ]);

    groupAlive = false;
    expect(await tree.isAlive()).toBe(false);
    await expect(tree.terminal).resolves.toBeUndefined();
    await tree.close();
  });

  it("treats ESRCH as terminal for liveness and signal races", async () => {
    const processKill = vi.fn((_pid: number, _signal: NodeJS.Signals | 0) => {
      throw esrch();
    });
    const tree = createPosixProcessTreeHandle({
      pgid: 5150,
      pollIntervalMs: 10,
      processKill,
    });

    await expect(tree.isAlive()).resolves.toBe(false);
    await expect(tree.gracefulTerminate()).resolves.toBeUndefined();
    await expect(tree.forceTerminate()).resolves.toBeUndefined();
    await expect(tree.terminal).resolves.toBeUndefined();
    expect(processKill.mock.calls.every(([pid]) => pid === -5150)).toBe(true);
  });

  it("does not swallow non-ESRCH liveness failures", async () => {
    const denied = Object.assign(new Error("not permitted"), { code: "EPERM" });
    const tree = createPosixProcessTreeHandle({
      pgid: 6160,
      processKill: vi.fn(() => {
        throw denied;
      }),
    });

    await expect(tree.isAlive()).rejects.toBe(denied);
  });
});

describe("Windows Job Object process trees with a fake addon", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    childProcessMocks.spawn.mockReset();
    vi.useRealTimers();
  });

  it("assigns the supervisor before allowing the provider to start", async () => {
    const addon = createFakeWindowsAddon();
    const supervisor = createFakeSupervisor();
    const order: string[] = [];
    addon.assignProcess.mockImplementation(() => order.push("assign"));
    supervisor.sendStart.mockImplementation(() => order.push("start"));

    const tree = await launchWindowsProcessTree({
      addon,
      launch: { args: ["--stdio"], command: "fake-ls", cwd: "/repo" },
      spawnSupervisor: vi.fn(() => supervisor),
    });

    expect(addon.openProcess).toHaveBeenCalledWith(supervisor.child.pid);
    expect(addon.assignProcess).toHaveBeenCalledWith(
      addon.job,
      addon.processHandle
    );
    expect(order).toEqual(["assign", "start"]);

    addon.setActiveProcesses(0);
    supervisor.child.exit(0);
    await tree.isAlive();
    await tree.terminal;
    await tree.close();
  });

  it("directly terminates the captured supervisor handle when assignment fails and never sends start", async () => {
    const addon = createFakeWindowsAddon();
    const supervisor = createFakeSupervisor();
    addon.assignProcess.mockImplementation(() => {
      throw new Error("assignment failed");
    });
    addon.terminateProcessAndWait.mockImplementation(async () => {
      supervisor.child.exit(1);
    });

    await expect(
      launchWindowsProcessTree({
        addon,
        launch: { args: [], command: "fake-ls", cwd: "/repo" },
        spawnSupervisor: vi.fn(() => supervisor),
      })
    ).rejects.toThrow("assignment failed");

    expect(supervisor.closeControl).toHaveBeenCalledBefore(
      addon.terminateProcessAndWait
    );
    expect(addon.terminateProcessAndWait).toHaveBeenCalledWith(
      addon.processHandle,
      expect.any(Number)
    );
    expect(supervisor.sendStart).not.toHaveBeenCalled();
    expect(addon.close).toHaveBeenCalledWith(addon.processHandle);
    expect(addon.close).toHaveBeenCalledWith(addon.job);
  });

  it("waits for an already-exited supervisor when openProcess fails and never reopens its pid", async () => {
    const addon = createFakeWindowsAddon();
    const supervisor = createFakeSupervisor();
    addon.openProcess.mockImplementation(() => {
      supervisor.child.exit(1);
      throw new Error("supervisor exited before open");
    });

    await expect(
      launchWindowsProcessTree({
        addon,
        launch: { args: [], command: "fake-ls", cwd: "/repo" },
        spawnSupervisor: vi.fn(() => supervisor),
      })
    ).rejects.toThrow("supervisor exited before open");

    expect(addon.openProcess).toHaveBeenCalledOnce();
    expect(addon.terminateProcessAndWait).not.toHaveBeenCalled();
    expect(supervisor.sendStart).not.toHaveBeenCalled();
    expect(addon.close).toHaveBeenCalledWith(addon.job);
  });

  it("keeps descendants contained after server-first-exit and settles only after terminate and close", async () => {
    const addon = createFakeWindowsAddon();
    const supervisor = createFakeSupervisor();
    addon.setActiveProcesses(2);
    const tree = await launchWindowsProcessTree({
      addon,
      launch: { args: [], command: "fake-ls", cwd: "/repo" },
      spawnSupervisor: vi.fn(() => supervisor),
    });

    expect(await tree.isAlive()).toBe(true);
    let terminal = false;
    tree.terminal.then(() => {
      terminal = true;
    });
    await Promise.resolve();
    expect(terminal).toBe(false);

    await tree.forceTerminate();
    expect(addon.terminateJob).toHaveBeenCalledWith(addon.job);
    expect(await tree.isAlive()).toBe(false);
    await Promise.resolve();
    expect(terminal).toBe(false);

    supervisor.child.exit(null, "SIGKILL");
    await expect(tree.terminal).resolves.toBeUndefined();
    await tree.close();
    expect(addon.close).toHaveBeenCalledWith(addon.processHandle);
    expect(addon.close).toHaveBeenCalledWith(addon.job);
    expect(addon.terminateJob.mock.invocationCallOrder[0]).toBeLessThan(
      addon.close.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
    );
  });

  it("retains native handles when assignment cleanup cannot confirm supervisor termination", async () => {
    const addon = createFakeWindowsAddon();
    const supervisor = createFakeSupervisor();
    const cleanupFailure = new Error("supervisor termination timed out");
    addon.assignProcess.mockImplementation(() => {
      throw new Error("assignment failed");
    });
    addon.terminateProcessAndWait.mockRejectedValue(cleanupFailure);

    await expect(
      launchWindowsProcessTree({
        addon,
        launch: { args: [], command: "fake-ls", cwd: "/repo" },
        spawnSupervisor: vi.fn(() => supervisor),
      })
    ).rejects.toBe(cleanupFailure);

    expect(supervisor.sendStart).not.toHaveBeenCalled();
    expect(addon.close).not.toHaveBeenCalledWith(addon.processHandle);
    expect(addon.close).not.toHaveBeenCalledWith(addon.job);
  });

  it("retains the assigned job after first-query cleanup fails and keeps its terminal behind the full tree barrier", async () => {
    const addon = createFakeWindowsAddon();
    const supervisor = createFakeSupervisor();
    const queryFailure = new Error("active process query failed");
    const cleanupFailure = new Error("assigned job cleanup failed");
    const retryStarted = Promise.withResolvers<void>();
    addon.queryActiveProcesses.mockImplementationOnce(() => {
      throw queryFailure;
    });
    addon.terminateJob
      .mockImplementationOnce(() => {
        throw cleanupFailure;
      })
      .mockImplementation(() => {
        retryStarted.resolve();
      });
    addon.terminateProcessAndWait
      .mockRejectedValueOnce(cleanupFailure)
      .mockImplementation(async () => {
        retryStarted.resolve();
      });

    await expect(
      launchWindowsProcessTree({
        addon,
        launch: { args: [], command: "fake-ls", cwd: "/repo" },
        spawnSupervisor: vi.fn(() => supervisor),
      })
    ).rejects.toBe(cleanupFailure);

    expect(addon.assignProcess).toHaveBeenCalledWith(
      addon.job,
      addon.processHandle
    );
    expect(supervisor.sendStart).toHaveBeenCalledOnce();
    const setupCleanupTerminatedJob = addon.terminateJob.mock.calls.length > 0;
    expect(addon.close).not.toHaveBeenCalledWith(addon.processHandle);
    expect(addon.close).not.toHaveBeenCalledWith(addon.job);

    const retained = getRetainedWindowsProcessTree(cleanupFailure);
    expect(retained).toBeDefined();
    if (!retained) {
      throw new Error("Expected the failed setup to retain its assigned job");
    }

    let terminalSettled = false;
    const terminalSettlement = retained.terminal.then(() => {
      terminalSettled = true;
    });
    let closeSettled = false;
    const closing = retained.close().then(() => {
      closeSettled = true;
    });
    const retryingCleanup = retained.gracefulTerminate();
    await retryStarted.promise;

    expect(terminalSettled).toBe(false);
    expect(closeSettled).toBe(false);
    expect(addon.close).not.toHaveBeenCalledWith(addon.processHandle);
    expect(addon.close).not.toHaveBeenCalledWith(addon.job);

    supervisor.child.exit(1);
    await supervisor.terminal;

    expect(terminalSettled).toBe(false);
    expect(closeSettled).toBe(false);
    expect(addon.close).not.toHaveBeenCalledWith(addon.processHandle);
    expect(addon.close).not.toHaveBeenCalledWith(addon.job);

    addon.setActiveProcesses(0);
    await expect(retained.isAlive()).resolves.toBe(false);
    await Promise.all([retryingCleanup, terminalSettlement, closing]);

    expect(addon.close).toHaveBeenCalledWith(addon.processHandle);
    expect(addon.close).toHaveBeenCalledWith(addon.job);
    expect(setupCleanupTerminatedJob).toBe(true);
    expect(addon.terminateJob).toHaveBeenCalledWith(addon.job);
    expect(addon.terminateJob.mock.invocationCallOrder[0]).toBeLessThan(
      addon.close.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
    );
  });

  it("rejects readiness and cleans the job when the production supervisor closes before its handshake", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    const child = new FakeWindowsSupervisorChild();
    childProcessMocks.spawn.mockReturnValue(child);
    const addon = createFakeWindowsAddon();
    const launching = launchWindowsProcessTree({
      addon,
      launch: { args: [], command: "fake-ls", cwd: "/repo" },
      spawnSupervisor: spawnWindowsSupervisor,
    });

    child.exit(1);
    await expect(launching).rejects.toThrow(
      "Windows LSP supervisor exited before becoming ready"
    );
    expect(addon.openProcess).not.toHaveBeenCalled();
    expect(addon.close).toHaveBeenCalledWith(addon.job);
  });

  it("bounds the production supervisor readiness handshake and cleans its job on timeout", async () => {
    vi.useFakeTimers();
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    const child = new FakeWindowsSupervisorChild();
    vi.spyOn(child, "kill").mockImplementation(() => {
      child.exit(null, "SIGKILL");
      return true;
    });
    childProcessMocks.spawn.mockReturnValue(child);
    const addon = createFakeWindowsAddon();
    let launchError: unknown;
    const launching = launchWindowsProcessTree({
      addon,
      launch: { args: [], command: "fake-ls", cwd: "/repo" },
      spawnSupervisor: spawnWindowsSupervisor,
    });
    launching.catch((error: unknown) => {
      launchError = error;
    });

    await vi.runOnlyPendingTimersAsync();
    await flushMicrotasks();

    expect(launchError).toEqual(expect.any(Error));
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    expect(addon.close).toHaveBeenCalledWith(addon.job);
  });

  it("contains a production supervisor control-output failure before readiness and cleans the job", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    const child = new FakeWindowsSupervisorChild();
    vi.spyOn(child, "kill").mockImplementation(() => {
      child.exit(null, "SIGKILL");
      return true;
    });
    childProcessMocks.spawn.mockReturnValue(child);
    const addon = createFakeWindowsAddon();
    const launching = launchWindowsProcessTree({
      addon,
      launch: { args: [], command: "fake-ls", cwd: "/repo" },
      spawnSupervisor: spawnWindowsSupervisor,
    });

    const controlError = new Error("control output failed");
    expect(() => child.controlOutput.emit("error", controlError)).not.toThrow();
    await expect(launching).rejects.toBe(controlError);

    expect(addon.openProcess).not.toHaveBeenCalled();
    expect(addon.close).toHaveBeenCalledWith(addon.job);
  });

  it("contains a production start-pipe EPIPE after readiness and cleans the assigned job through the runtime", async () => {
    vi.useFakeTimers();
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    const child = new FakeWindowsSupervisorChild();
    childProcessMocks.spawn.mockReturnValue(child);
    const addon = createFakeWindowsAddon();
    addon.terminateJob.mockImplementation(() => {
      addon.setActiveProcesses(0);
      child.exit(null, "SIGKILL");
    });
    const supervisor = spawnWindowsSupervisor();
    const launching = launchWindowsProcessTree({
      addon,
      launch: { args: [], command: "fake-ls", cwd: "/repo" },
      spawnSupervisor: () => supervisor,
    });
    child.controlOutput.write(
      `${JSON.stringify({ type: "supervisor-ready" })}\n`
    );
    const tree = await launching;
    const outcomes: Record<string, unknown>[] = [];
    const runtime = createLspSessionRuntime({
      child: supervisor.child,
      onMessage: vi.fn(),
      onOutcome: (event) => outcomes.push(event),
      processTree: tree,
      rootPath: "/repo",
      serverId: "typescript",
      sessionId: "windows-control",
      workspaceKey: "main:/repo",
    });

    expect(() =>
      child.controlInput.emit(
        "error",
        Object.assign(new Error("start pipe closed"), { code: "EPIPE" })
      )
    ).not.toThrow();
    await flushMicrotasks();
    expect(outcomes).toEqual([
      { reason: "failed", sessionId: "windows-control" },
    ]);

    await vi.advanceTimersByTimeAsync(LSP_EXIT_GRACE_MS);
    await runtime.terminal;
    expect(addon.terminateJob).toHaveBeenCalledWith(addon.job);
    expect(addon.close).toHaveBeenCalledWith(addon.processHandle);
    expect(addon.close).toHaveBeenCalledWith(addon.job);
    expect(outcomes).toHaveLength(1);
  });
});

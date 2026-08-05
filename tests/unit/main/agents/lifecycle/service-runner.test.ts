import { describe, expect, it, vi } from "vitest";
import {
  BusyError,
  LifecycleLocks,
} from "../../../../../src/main/services/agents/lifecycle/locks.ts";
import type { LifecycleRunner } from "../../../../../src/main/services/agents/lifecycle/runner/types.ts";
import { createAgentLifecycleService } from "../../../../../src/main/services/agents/lifecycle/service.ts";

function fakeRunner(
  result: Partial<Awaited<ReturnType<LifecycleRunner["run"]>>> = {}
): LifecycleRunner {
  return {
    run: vi.fn(async () => ({
      ok: true,
      code: 0,
      stepIndex: 0,
      stdout: "",
      stderr: "",
      ...result,
    })),
  };
}

describe("LifecycleLocks", () => {
  it("rejects concurrent claim on the same agent", async () => {
    const locks = new LifecycleLocks();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });

    const first = locks.withAgentLock("codex", async () => {
      await gate;
      return 1;
    });
    await Promise.resolve();
    await expect(
      locks.withAgentLock("codex", async () => 2)
    ).rejects.toBeInstanceOf(BusyError);
    release();
    await expect(first).resolves.toBe(1);
  });

  it("allows different agents in parallel", async () => {
    const locks = new LifecycleLocks();
    let releaseA!: () => void;
    const gateA = new Promise<void>((r) => {
      releaseA = r;
    });
    const a = locks.withAgentLock("codex", async () => {
      await gateA;
      return "a";
    });
    await Promise.resolve();
    const b = locks.withAgentLock("claude", async () => "b");
    await expect(b).resolves.toBe("b");
    releaseA();
    await expect(a).resolves.toBe("a");
  });
});

describe("agent lifecycle service + runner", () => {
  it("returns busy when the same agent is already running", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const runner: LifecycleRunner = {
      run: vi.fn(async () => {
        await gate;
        return {
          ok: true,
          code: 0,
          stepIndex: 0,
          stdout: "",
          stderr: "",
        };
      }),
    };
    const service = createAgentLifecycleService({
      getEnv: async () => ({ ...process.env }),
      runner,
    });

    const first = service.run("codex", "install");
    await Promise.resolve();
    await Promise.resolve();
    const second = await service.run("codex", "install");
    expect(second.ok).toBe(false);
    expect(second.errorCode).toBe("busy");
    release();
    const firstResult = await first;
    expect(firstResult.errorCode).not.toBe("busy");
  });

  it("cancels in-flight run by agentId", async () => {
    let sawAbort = false;
    const runner: LifecycleRunner = {
      run: vi.fn(async (_plan, opts) => {
        await new Promise<void>((resolve) => {
          if (opts.signal?.aborted) {
            sawAbort = true;
            resolve();
            return;
          }
          opts.signal?.addEventListener(
            "abort",
            () => {
              sawAbort = true;
              resolve();
            },
            { once: true }
          );
        });
        return {
          ok: false,
          code: null,
          stepIndex: 0,
          stdout: "",
          stderr: "cancelled",
          cancelled: true,
        };
      }),
    };
    // Empty PATH so local which finds nothing → install always reaches runner.
    const service = createAgentLifecycleService({
      getEnv: async () => ({ PATH: "/no-such-bin", Path: "/no-such-bin" }),
      runner,
    });
    const pending = service.run("gemini", "install");
    // allow reservation + runner start
    await new Promise((r) => setTimeout(r, 50));
    expect(service.cancel("gemini")).toBe(true);
    const result = await pending;
    expect(sawAbort).toBe(true);
    expect(result.errorCode).toBe("cancelled");
  });

  it("unsupported agents return unsupported without calling runner", async () => {
    const runner = fakeRunner();
    const service = createAgentLifecycleService({
      getEnv: async () => ({}),
      runner,
    });
    const result = await service.run("rovo", "install");
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("unsupported");
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("maps package_manager_missing from runner", async () => {
    const runner = fakeRunner({
      ok: false,
      code: 1,
      packageManagerMissing: true,
      stderr: "npm missing",
    });
    const service = createAgentLifecycleService({
      // Empty PATH so probe finds nothing and install always reaches the runner.
      getEnv: async () => ({ PATH: "/no-such-bin", Path: "/no-such-bin" }),
      runner,
    });
    const result = await service.run("gemini", "install");
    expect(result.skipped).not.toBe(true);
    expect(result.errorCode).toBe("package_manager_missing");
  });

  it("returns env_unavailable when getEnv throws", async () => {
    const service = createAgentLifecycleService({
      getEnv: async () => {
        throw new Error("pes down");
      },
      runner: fakeRunner(),
    });
    const result = await service.run("codex", "install");
    expect(result.errorCode).toBe("env_unavailable");
  });

  it("probe does not fall back to process.env when getEnv fails", async () => {
    const service = createAgentLifecycleService({
      getEnv: async () => {
        throw new Error("pes down");
      },
      runner: fakeRunner(),
    });
    const probes = await service.probe({ agentIds: ["codex"] });
    expect(probes[0]?.envDegraded).toBe(true);
    expect(probes[0]?.installs).toEqual([]);
  });
});

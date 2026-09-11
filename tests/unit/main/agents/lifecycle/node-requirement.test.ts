import { describe, expect, it, vi } from "vitest";
import type { LifecycleRunner } from "../../../../../src/main/services/agents/lifecycle/runner/types.ts";
import { createAgentLifecycleService } from "../../../../../src/main/services/agents/lifecycle/service.ts";

function fakeRunner(): LifecycleRunner {
  return {
    run: vi.fn(async () => ({
      ok: true,
      code: 0,
      stepIndex: 0,
      stdout: "",
      stderr: "",
    })),
  };
}

/** openclaw declares `requiresNode: ">=24.16.0 <25 || >=26.1.0"`. */
function serviceWithNode(version: string, runner = fakeRunner()) {
  return {
    runner,
    service: createAgentLifecycleService({
      // Empty PATH so probe finds nothing and install always reaches the runner.
      getEnv: async () => ({ PATH: "/no-such-bin", Path: "/no-such-bin" }),
      getHostNodeRuntime: async () => ({ path: "/usr/bin/node", version }),
      runner,
    }),
  };
}

describe("declared Node requirement precheck", () => {
  it("blocks install with node_requirement_unmet and skips the runner", async () => {
    const { runner, service } = serviceWithNode("v24.15.0");
    const result = await service.run("openclaw", "install");
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("node_requirement_unmet");
    expect(result.requiredNode).toBe(">=24.16.0 <25 || >=26.1.0");
    expect(result.hostNode).toEqual({
      path: "/usr/bin/node",
      version: "v24.15.0",
    });
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("blocks update the same way", async () => {
    const { service } = serviceWithNode("v24.15.0");
    const result = await service.run("openclaw", "update");
    expect(result.errorCode).toBe("node_requirement_unmet");
  });

  it("runs when the host satisfies the range", async () => {
    const { runner, service } = serviceWithNode("v24.16.0");
    await service.run("openclaw", "install");
    expect(runner.run).toHaveBeenCalled();
  });

  it("precheck probes the spawn env from resolveEnv", async () => {
    const spawnEnv = { PATH: "/nvm/bin", Path: "/nvm/bin" };
    const seen: Array<NodeJS.ProcessEnv | undefined> = [];
    const runner = fakeRunner();
    const service = createAgentLifecycleService({
      getEnv: async () => spawnEnv,
      getHostNodeRuntime: async (env) => {
        seen.push(env);
        return { path: "/nvm/bin/node", version: "v24.15.0" };
      },
      runner,
    });
    await service.run("openclaw", "install");
    expect(seen).toEqual([spawnEnv]);
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("does not block when the host Node fact is unavailable", async () => {
    const runner = fakeRunner();
    const service = createAgentLifecycleService({
      getEnv: async () => ({ PATH: "/no-such-bin", Path: "/no-such-bin" }),
      getHostNodeRuntime: async () => null,
      runner,
    });
    await service.run("openclaw", "install");
    expect(runner.run).toHaveBeenCalled();
  });
});

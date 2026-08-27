import {
  createTerminalLaunchRegistry,
  peekLaunchResumeHint,
  registerLaunchResumeHint,
} from "@main/state/terminal-launch-state.ts";
import { describe, expect, it } from "vitest";

describe("terminal launch registry", () => {
  it("expires stale launches before read or consume", () => {
    let now = 1000;
    const registry = createTerminalLaunchRegistry({
      createId: () => "launch-1",
      now: () => now,
      ttlMs: 100,
    });

    const launchId = registry.register({
      command: "printenv SECRET",
      cwd: "/tmp/pier",
      env: { SECRET: "token" },
    });

    now = 1101;

    expect(registry.read(launchId)).toBeNull();
    expect(registry.consume(launchId)).toBeNull();
  });

  it("clears a resume hint when the launch expires", () => {
    let now = 1000;
    const registry = createTerminalLaunchRegistry({
      createId: () => "launch-hint-ttl",
      now: () => now,
      ttlMs: 100,
    });
    const launchId = registry.register({
      agentId: "omp",
      command: "omp",
      cwd: "/tmp/pier",
    });
    registerLaunchResumeHint(launchId, "sess-hint");
    now = 1101;
    expect(registry.read(launchId)).toBeNull();
    expect(peekLaunchResumeHint(launchId)).toBeUndefined();
  });

  it("clears a resume hint when the launch is consumed", () => {
    const registry = createTerminalLaunchRegistry({
      createId: () => "launch-hint-1",
    });
    const launchId = registry.register({
      agentId: "omp",
      command: "omp",
      cwd: "/tmp/pier",
    });
    registerLaunchResumeHint(launchId, "sess-hint");
    expect(peekLaunchResumeHint(launchId)?.sessionId).toBe("sess-hint");
    expect(registry.consume(launchId)?.command).toBe("omp");
    expect(peekLaunchResumeHint(launchId)).toBeUndefined();
  });
});

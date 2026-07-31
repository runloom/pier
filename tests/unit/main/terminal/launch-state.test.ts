import { createTerminalLaunchRegistry } from "@main/state/terminal-launch-state.ts";
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
});

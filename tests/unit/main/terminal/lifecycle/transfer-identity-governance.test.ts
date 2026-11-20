import { describe, expect, it } from "vitest";
import { resolveAgentSpawnLifecycle } from "../../../../../src/main/ipc/terminal/create-launch.ts";
import { createNativeProcessRegistry } from "../../../../../src/main/ipc/terminal/process/registry.ts";
import {
  sessionIdentityForLiveLifecycle,
  terminalSessionLifecycleId,
} from "../../../../../src/main/state/terminal-session-identity.ts";
import { terminalPanelSessionSchema } from "../../../../../src/main/state/terminal-session-state-schemas.ts";

/**
 * Locks the three identity sources together: the spawn helper, the native
 * process registry, and session metadata. They are deliberately different
 * shapes (shells are `shell:<n>` live and `""` in session metadata), so a
 * change to any mapping must update this table.
 */
describe("terminal transfer identity mapping", () => {
  it("keeps spawn helper, registry and agent session metadata aligned", () => {
    const registry = createNativeProcessRegistry();

    const shell = registry.begin("101::shell", {
      lifecycleId: "",
      savedGeneration: 4,
    });
    const shellLaunch = resolveAgentSpawnLifecycle({ spawnGeneration: 5 });
    expect(shellLaunch).toEqual({ lifecycleId: "", surface: "shell" });
    expect(shell.lifecycleId).toBe("shell:5");
    expect(sessionIdentityForLiveLifecycle(shell.lifecycleId)).toBe(
      shellLaunch.lifecycleId
    );

    const agent = registry.begin("101::agent", { savedGeneration: 2 });
    const agentLaunch = resolveAgentSpawnLifecycle({
      launchAgentId: "claude",
      spawnGeneration: 3,
    });
    expect(agentLaunch).toEqual({ lifecycleId: "3", surface: "agent" });
    expect(agent.lifecycleId).toBe(agentLaunch.lifecycleId);
    expect(
      terminalSessionLifecycleId(
        terminalPanelSessionSchema.parse({
          agent: {
            agentId: "claude",
            launch: { agentId: "claude", command: "claude", cwd: "/repo" },
            restore: { spawnGeneration: 3 },
            startedAt: 1,
            status: "running",
          },
          updatedAt: "2026-01-01T00:00:00.000Z",
        })
      )
    ).toBe(agentLaunch.lifecycleId);

    const task = registry.begin("101::task", { lifecycleId: "run-7" });
    const taskLaunch = resolveAgentSpawnLifecycle({
      launchAgentId: "codex",
      spawnGeneration: 1,
      taskRunId: "run-7",
    });
    expect(taskLaunch).toEqual({ lifecycleId: "run-7", surface: "task" });
    expect(task.lifecycleId).toBe(taskLaunch.lifecycleId);
  });

  it("treats shells as the only live identity that maps to empty", () => {
    expect(sessionIdentityForLiveLifecycle("shell:5")).toBe("");
    expect(sessionIdentityForLiveLifecycle("")).toBe("");
    expect(sessionIdentityForLiveLifecycle("3")).toBe("3");
    expect(sessionIdentityForLiveLifecycle("run-7")).toBe("run-7");
  });
});

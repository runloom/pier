import { toRestoreLaunch } from "@main/ipc/terminal/initial-session.ts";
import {
  applyLaunchWrapForCreate,
  registerLaunchWrapHandler,
  resetLaunchWrapRegistryForTests,
  stripEphemeralEnvKeys,
} from "@main/services/terminal-launch-wrap/index.ts";
import { afterEach, describe, expect, it } from "vitest";

afterEach(() => {
  resetLaunchWrapRegistryForTests();
});

describe("spawn-ephemeral env", () => {
  it("keeps decorateSpawn keys in spawn env and omits them from restore launch", async () => {
    registerLaunchWrapHandler("pier.wrap.test", {
      wrap: async () => ({ decorateSpawn: true }),
      decorateSpawn: async () => ({
        env: {
          PIER_TMUX_SESSION: "session-1",
          TMUX: "/tmp/sessions/s.sock,1,0",
          TMUX_PANE: "%0",
        },
      }),
    });

    const spawn = await applyLaunchWrapForCreate({
      agentId: "claude",
      controlSocketPath: "/tmp/pier-control.sock",
      hookEnv: {},
      launch: {
        agentId: "claude",
        command: "claude",
        env: { PATH: "/usr/bin" },
      },
      panelId: "panel-new",
      windowId: "win-new",
    });
    expect(spawn.env?.TMUX).toBe("/tmp/sessions/s.sock,1,0");
    expect(spawn.env?.TMUX_PANE).toBe("%0");
    expect(spawn.env?.PIER_TMUX_SESSION).toBe("session-1");
    expect(spawn.env?.PIER_PANEL_ID).toBe("panel-new");

    const restore = toRestoreLaunch(spawn);
    expect(restore).not.toHaveProperty("env");
    expect(JSON.stringify(restore)).not.toContain("TMUX");
    expect(JSON.stringify(restore)).not.toContain("PIER_TMUX_SESSION");

    const stripped = stripEphemeralEnvKeys(spawn.env ?? {}, [
      "TMUX",
      "TMUX_PANE",
      "PIER_TMUX_SESSION",
    ]);
    expect(stripped.TMUX).toBeUndefined();
    expect(stripped.TMUX_PANE).toBeUndefined();
    expect(stripped.PIER_TMUX_SESSION).toBeUndefined();
    expect(stripped.PIER_PANEL_ID).toBeUndefined();
    expect(stripped.PIER_WINDOW_ID).toBeUndefined();
    expect(stripped.PIER_CONTROL_SOCKET).toBeUndefined();
    expect(stripped.PATH).toBe("/usr/bin");
  });

  it("restore T2 uses the new panel id rather than a previous identity", async () => {
    registerLaunchWrapHandler("pier.wrap.test", {
      wrap: async () => ({ decorateSpawn: true }),
      decorateSpawn: async (input) => ({
        env: {
          PIER_TMUX_SESSION: `session-${input.panelId}`,
          TMUX_PANE: input.panelId,
        },
      }),
    });

    const spawn = await applyLaunchWrapForCreate({
      agentId: "claude",
      hookEnv: {},
      launch: {
        agentId: "claude",
        command: "claude",
        env: {
          PATH: "/usr/bin",
          PIER_PANEL_ID: "panel-old",
          TMUX_PANE: "panel-old",
        },
      },
      panelId: "panel-restored",
      windowId: "win-restored",
    });
    expect(spawn.env?.PIER_PANEL_ID).toBe("panel-restored");
    expect(spawn.env?.TMUX_PANE).toBe("panel-restored");
    expect(spawn.env?.PIER_TMUX_SESSION).toBe("session-panel-restored");
  });
});

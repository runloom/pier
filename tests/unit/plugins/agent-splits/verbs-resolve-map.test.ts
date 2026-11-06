import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadSessionMap,
  SESSION_TTL_MS,
  saveSessionMap,
  sessionIdForLeader,
  tmuxValueForSession,
} from "../../../../packages/plugin-agent-splits/src/main/session-map.ts";
import type { JsonCommand } from "../../../../packages/plugin-agent-splits/src/tmux/types.ts";
import { runTmux } from "../../../../packages/plugin-agent-splits/src/tmux/verbs.ts";
import {
  LEADER_PANEL,
  makeWorkDir,
  okInvoke,
  PANE_ONE_PANEL,
  removeWorkDir,
  seedSession,
  WINDOW_ID,
} from "./harness.ts";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(removeWorkDir));
});

function unreachable(message: string) {
  return {
    error: { code: "platform_unavailable", message },
    ok: false as const,
    requestId: "r",
  };
}

function notFound() {
  return {
    error: { code: "not_found", message: "terminal panel not found" },
    ok: false as const,
    requestId: "r",
  };
}

describe("tmux session map resolution", () => {
  it("keeps live child panes when the leader probe fails transiently", async () => {
    const workDir = await makeWorkDir();
    dirs.push(workDir);
    const { env, sessionId } = seedSession(workDir, 2);
    const base = okInvoke();
    const invoke = async (command: JsonCommand) => {
      if (command.type === "terminal.get" && command.panelId === LEADER_PANEL) {
        return unreachable("host busy");
      }
      return await base(command);
    };

    const result = await runTmux(["list-panes", "-F", "#{pane_id}"], {
      env,
      invoke,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("%0\n%1\n");
    expect(
      Object.keys(loadSessionMap(workDir, sessionId)?.panes ?? {})
    ).toEqual(["%0", "%1"]);
  });

  it("promotes a live child pane when the leader is gone", async () => {
    const workDir = await makeWorkDir();
    dirs.push(workDir);
    const { env, sessionId } = seedSession(workDir, 2);
    const base = okInvoke();
    const invoke = async (command: JsonCommand) => {
      if (command.type === "terminal.get" && command.panelId === LEADER_PANEL) {
        return notFound();
      }
      return await base(command);
    };

    const result = await runTmux(["list-panes", "-F", "#{pane_id}"], {
      env,
      invoke,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("%1\n");
    const saved = loadSessionMap(workDir, sessionId);
    expect(saved?.leaderPaneId).toBe("%1");
    expect(Object.keys(saved?.panes ?? {})).toEqual(["%1"]);
  });

  it("drops only panes the host confirms are gone", async () => {
    const workDir = await makeWorkDir();
    dirs.push(workDir);
    const { env, sessionId } = seedSession(workDir, 3);
    const base = okInvoke();
    const invoke = async (command: JsonCommand) => {
      if (
        command.type === "terminal.get" &&
        (command.panelId === LEADER_PANEL || command.panelId === PANE_ONE_PANEL)
      ) {
        return notFound();
      }
      return await base(command);
    };

    const result = await runTmux(["list-panes", "-F", "#{pane_id}"], {
      env,
      invoke,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("%2\n");
    const saved = loadSessionMap(workDir, sessionId);
    expect(saved?.leaderPaneId).toBe("%2");
    expect(Object.keys(saved?.panes ?? {})).toEqual(["%2"]);
  });

  it("keeps a child pane whose probe result is unknown", async () => {
    const workDir = await makeWorkDir();
    dirs.push(workDir);
    const { env, sessionId } = seedSession(workDir, 2);
    const base = okInvoke();
    const invoke = async (command: JsonCommand) => {
      if (command.type === "terminal.get" && command.panelId === LEADER_PANEL) {
        return notFound();
      }
      if (
        command.type === "terminal.get" &&
        command.panelId === PANE_ONE_PANEL
      ) {
        return unreachable("host busy");
      }
      return await base(command);
    };

    const result = await runTmux(["list-panes", "-F", "#{pane_id}"], {
      env,
      invoke,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("%1\n");
    expect(
      Object.keys(loadSessionMap(workDir, sessionId)?.panes ?? {})
    ).toEqual(["%1"]);
  });

  it("prefers an alive pane over an unknown sibling when the leader is gone", async () => {
    const workDir = await makeWorkDir();
    dirs.push(workDir);
    const { env, sessionId } = seedSession(workDir, 3);
    const base = okInvoke();
    const invoke = async (command: JsonCommand) => {
      if (command.type === "terminal.get" && command.panelId === LEADER_PANEL) {
        return notFound();
      }
      if (
        command.type === "terminal.get" &&
        command.panelId === PANE_ONE_PANEL
      ) {
        return unreachable("host busy");
      }
      return await base(command);
    };

    const result = await runTmux(["list-panes", "-F", "#{pane_id}"], {
      env,
      invoke,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("%1\n%2\n");
    const saved = loadSessionMap(workDir, sessionId);
    // %1 探测结果未知、%2 确认存活：leader 必须是 %2。
    expect(saved?.leaderPaneId).toBe("%2");
    expect(Object.keys(saved?.panes ?? {})).toEqual(["%1", "%2"]);
  });

  it("renews an expired session instead of dropping live panes", async () => {
    const workDir = await makeWorkDir();
    dirs.push(workDir);
    const { env, sessionId } = seedSession(workDir, 2);
    const now = Date.now() + SESSION_TTL_MS + 60_000;

    const result = await runTmux(["list-panes", "-F", "#{pane_id}"], {
      env,
      invoke: okInvoke(),
      now,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("%0\n%1\n");
    const saved = loadSessionMap(workDir, sessionId);
    expect(Object.keys(saved?.panes ?? {})).toEqual(["%0", "%1"]);
    expect(saved?.createdAt).toBe(now);
  });

  it("follows the leader to its current window when the recorded window is stale", async () => {
    const workDir = await makeWorkDir();
    dirs.push(workDir);
    const { env, sessionId } = seedSession(workDir, 2);
    const base = okInvoke();
    const invoke = async (command: JsonCommand) => {
      if (command.type !== "terminal.get") {
        return await base(command);
      }
      if (command.windowId === WINDOW_ID) {
        return notFound();
      }
      return {
        data: {
          terminal: { canonicalPath: "/repo", windowId: "main" },
        },
        ok: true as const,
        requestId: "r",
      };
    };

    const result = await runTmux(["list-panes", "-F", "#{pane_id}"], {
      env,
      invoke,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("%0\n%1\n");
    const saved = loadSessionMap(workDir, sessionId);
    expect(saved?.panes["%0"]?.windowId).toBe("main");
    expect(Object.keys(saved?.panes ?? {})).toEqual(["%0", "%1"]);
  });

  it("keeps a pane written by another shim during the leader probe", async () => {
    const workDir = await makeWorkDir();
    dirs.push(workDir);
    const { env, sessionId } = seedSession(workDir, 2);
    const base = okInvoke();
    const invoke = async (command: JsonCommand) => {
      if (command.type !== "terminal.get") {
        return await base(command);
      }
      if (command.panelId === LEADER_PANEL) {
        // 探测期间另一个 shim 已绑定 %2；随后的位置刷新不能把它盖掉。
        const latest = loadSessionMap(workDir, sessionId);
        if (latest) {
          saveSessionMap(workDir, {
            ...latest,
            nextIndex: 3,
            panes: {
              ...latest.panes,
              "%2": { panelId: "panel-two", windowId: "main" },
            },
          });
        }
        return {
          data: {
            terminal: { canonicalPath: "/repo", windowId: "main" },
          },
          ok: true as const,
          requestId: "r",
        };
      }
      return await base(command);
    };

    const result = await runTmux(["list-panes", "-F", "#{pane_id}"], {
      env,
      invoke,
    });

    expect(result.exitCode).toBe(0);
    const saved = loadSessionMap(workDir, sessionId);
    expect(saved?.panes["%0"]?.windowId).toBe("main");
    expect(saved?.panes["%2"]).toEqual({
      panelId: "panel-two",
      windowId: "main",
    });
  });

  it("retains a child pane that moved to another window", async () => {
    const workDir = await makeWorkDir();
    dirs.push(workDir);
    const { env, sessionId } = seedSession(workDir, 2);
    const base = okInvoke();
    const invoke = async (command: JsonCommand) => {
      if (command.type !== "terminal.get") {
        return await base(command);
      }
      if (command.panelId === LEADER_PANEL) {
        return notFound();
      }
      if (command.windowId === WINDOW_ID) {
        return notFound();
      }
      return {
        data: {
          terminal: { canonicalPath: "/repo", windowId: "main" },
        },
        ok: true as const,
        requestId: "r",
      };
    };

    const result = await runTmux(["list-panes", "-F", "#{pane_id}"], {
      env,
      invoke,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("%1\n");
    const saved = loadSessionMap(workDir, sessionId);
    expect(saved?.leaderPaneId).toBe("%1");
    expect(saved?.panes["%1"]?.windowId).toBe("main");
  });

  it("rebinds the leader only when every pane is confirmed gone", async () => {
    const workDir = await makeWorkDir();
    dirs.push(workDir);
    const { env, sessionId } = seedSession(workDir, 2);
    const invoke = async () => notFound();

    const result = await runTmux(["list-panes", "-F", "#{pane_id}"], {
      env,
      invoke,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("%0\n");
    expect(
      Object.keys(loadSessionMap(workDir, sessionId)?.panes ?? {})
    ).toEqual(["%0"]);
  });

  it("binds a rebuilt leader session to the host's internal window id", async () => {
    const workDir = await makeWorkDir();
    dirs.push(workDir);
    const sessionId = sessionIdForLeader(WINDOW_ID, LEADER_PANEL);
    const env: NodeJS.Dict<string> = {
      PIER_CONTROL_SOCKET: join(workDir, "control.sock"),
      PIER_PANEL_ID: LEADER_PANEL,
      PIER_WINDOW_ID: WINDOW_ID,
      TMUX: tmuxValueForSession(workDir, sessionId, 1),
      TMUX_PANE: "%0",
    };
    const base = okInvoke();
    const invoke = async (command: JsonCommand) => {
      if (command.type === "terminal.get") {
        return {
          data: { terminal: { canonicalPath: "/repo", windowId: "main" } },
          ok: true as const,
          requestId: "r",
        };
      }
      return await base(command);
    };

    const result = await runTmux(["list-panes", "-F", "#{pane_id}"], {
      env,
      invoke,
    });

    expect(result.exitCode).toBe(0);
    expect(loadSessionMap(workDir, sessionId)?.panes["%0"]?.windowId).toBe(
      "main"
    );
  });

  it("retries a pane command in the pane's current window after a move", async () => {
    const workDir = await makeWorkDir();
    dirs.push(workDir);
    const { env, sessionId } = seedSession(workDir, 2);
    const base = okInvoke();
    const sends: JsonCommand[] = [];
    const invoke = async (command: JsonCommand) => {
      if (command.type === "terminal.get") {
        if (command.panelId === LEADER_PANEL) {
          return await base(command);
        }
        if (command.windowId === WINDOW_ID) {
          return notFound();
        }
        return {
          data: { terminal: { canonicalPath: "/repo", windowId: "main" } },
          ok: true as const,
          requestId: "r",
        };
      }
      if (command.type === "terminal.send") {
        sends.push(command);
        return command.windowId === "main"
          ? { data: { accepted: true }, ok: true as const, requestId: "r" }
          : notFound();
      }
      return await base(command);
    };

    const result = await runTmux(["send-keys", "-t", "%1", "hello"], {
      env,
      invoke,
    });

    expect(result.exitCode).toBe(0);
    expect(sends.map((command) => command.windowId)).toEqual([
      WINDOW_ID,
      "main",
    ]);
    expect(loadSessionMap(workDir, sessionId)?.panes["%1"]?.windowId).toBe(
      "main"
    );
  });
});

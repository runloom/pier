import { afterEach, describe, expect, it } from "vitest";
import {
  loadSessionMap,
  saveSessionMap,
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
} from "./harness.ts";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(removeWorkDir));
});

/** 宿主每次都回报归一化后的内部窗口 id。 */
function internalWindowInvoke() {
  const base = okInvoke();
  return async (command: JsonCommand) => {
    if (command.type !== "terminal.get") {
      return await base(command);
    }
    return {
      data: { terminal: { canonicalPath: "/repo", windowId: "main" } },
      ok: true as const,
      requestId: "r",
    };
  };
}

describe("tmux list verbs window identity", () => {
  it("normalizes legacy Electron-id bindings from successful host responses", async () => {
    const workDir = await makeWorkDir();
    dirs.push(workDir);
    const { env, sessionId } = seedSession(workDir, 2);
    const seeded = loadSessionMap(workDir, sessionId);
    if (!seeded) {
      throw new Error("seeded session map is missing");
    }
    // 升级前写入的 map：leader 已刷新为内部 id，子 pane 仍是 Electron id。
    saveSessionMap(workDir, {
      ...seeded,
      panes: {
        "%0": { panelId: LEADER_PANEL, windowId: "main" },
        "%1": { panelId: PANE_ONE_PANEL, windowId: "7" },
      },
    });

    const windows = await runTmux(["list-windows", "-F", "#{window_id}"], {
      env,
      invoke: internalWindowInvoke(),
    });
    expect(windows.exitCode).toBe(0);
    expect(windows.stdout).toBe("main\n");

    const panes = await runTmux(["list-panes", "-F", "#{window_id}"], {
      env,
      invoke: internalWindowInvoke(),
    });
    expect(panes.exitCode).toBe(0);
    expect(panes.stdout).toBe("main\nmain\n");
  });

  it("keeps the stored window id when the host lookup fails", async () => {
    const workDir = await makeWorkDir();
    dirs.push(workDir);
    const { env, sessionId } = seedSession(workDir, 2);
    const seeded = loadSessionMap(workDir, sessionId);
    if (!seeded) {
      throw new Error("seeded session map is missing");
    }
    saveSessionMap(workDir, {
      ...seeded,
      panes: {
        "%0": { panelId: LEADER_PANEL, windowId: "main" },
        "%1": { panelId: PANE_ONE_PANEL, windowId: "7" },
      },
    });
    const base = okInvoke();
    const invoke = async (command: JsonCommand) => {
      if (command.type === "terminal.get") {
        return {
          error: { code: "platform_unavailable", message: "renderer hung" },
          ok: false as const,
          requestId: "r",
        };
      }
      return await base(command);
    };

    const panes = await runTmux(["list-panes", "-F", "#{window_id}"], {
      env,
      invoke,
    });
    expect(panes.exitCode).toBe(0);
    expect(panes.stdout).toBe("main\n7\n");
  });
});

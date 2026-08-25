import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type SessionMap,
  saveSessionMap,
  sessionIdFromWindowId,
  tmuxValueForSession,
} from "../../../../packages/plugin-agent-splits/src/main/session-map.ts";
import type {
  ControlResult,
  JsonCommand,
} from "../../../../packages/plugin-agent-splits/src/tmux/types.ts";

export const WINDOW_ID = "win-1";
export const LEADER_PANEL = "panel-leader";
export const PANE_ONE_PANEL = "panel-one";
export const OPENED_PANEL = "panel-opened";

export async function makeWorkDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "pier-tmux-"));
}

export async function removeWorkDir(workDir: string): Promise<void> {
  await rm(workDir, { force: true, recursive: true });
}

export function seedSession(
  workDir: string,
  paneCount = 2
): { env: NodeJS.Dict<string>; map: SessionMap; sessionId: string } {
  const sessionId = sessionIdFromWindowId(WINDOW_ID);
  const panes: SessionMap["panes"] = {
    "%0": { panelId: LEADER_PANEL, windowId: WINDOW_ID },
  };
  if (paneCount > 1) {
    panes["%1"] = { panelId: PANE_ONE_PANEL, windowId: WINDOW_ID };
  }
  for (let index = 2; index < paneCount; index += 1) {
    panes[`%${index}`] = {
      panelId: `panel-${index}`,
      windowId: WINDOW_ID,
    };
  }
  const map: SessionMap = {
    createdAt: Date.now(),
    leaderPaneId: "%0",
    nextIndex: paneCount,
    panes,
    sessionId,
  };
  saveSessionMap(workDir, map);
  return {
    env: {
      PIER_CONTROL_SOCKET: join(workDir, "control.sock"),
      PIER_PANEL_ID: LEADER_PANEL,
      PIER_WINDOW_ID: WINDOW_ID,
      TMUX: tmuxValueForSession(workDir, sessionId, 1),
      TMUX_PANE: "%0",
    },
    map,
    sessionId,
  };
}

export function okInvoke(): (command: JsonCommand) => Promise<ControlResult> {
  return async (command) => {
    if (command.type === "terminal.list") {
      throw new Error("mapped pane listing must not call terminal.list");
    }
    if (command.type === "terminal.open") {
      return {
        data: {
          panelId:
            typeof command.panelId === "string"
              ? command.panelId
              : OPENED_PANEL,
          windowId: String(command.windowId ?? WINDOW_ID),
        },
        ok: true,
        requestId: "r",
      };
    }
    if (
      command.type === "terminal.screen" ||
      command.type === "terminal.read"
    ) {
      return {
        data: { text: "viewport text" },
        ok: true,
        requestId: "r",
      };
    }
    return {
      data: {
        panelId: command.panelId,
        terminal: { canonicalPath: "/repo" },
        windowId: command.windowId,
      },
      ok: true,
      requestId: "r",
    };
  };
}

export function findCommand(
  commands: JsonCommand[],
  type: string
): JsonCommand | undefined {
  return commands.find((command) => command.type === type);
}

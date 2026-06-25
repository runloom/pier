import type { WindowInfo } from "@shared/contracts/events.ts";
import type { TerminalRecentSessionSnapshot } from "@shared/contracts/terminal.ts";
import {
  listAllRecentTerminalPanelSessions,
  listRecentTerminalPanelSessions,
} from "../state/terminal-session-state.ts";

export interface TerminalSessionService {
  listRecentClosed(args: {
    windowId?: string | undefined;
    windows: readonly WindowInfo[];
  }): Promise<TerminalRecentSessionSnapshot[]>;
}

function toSnapshot(
  session: {
    closedAt: string;
    cwd: string;
    id: string;
    panelId: string;
    recordId: string;
    title?: string | undefined;
  },
  windowInfo: WindowInfo | undefined
): TerminalRecentSessionSnapshot {
  return {
    closedAt: session.closedAt,
    cwd: session.cwd,
    id: session.id,
    panelId: session.panelId,
    recordId: session.recordId,
    windowAlive: Boolean(windowInfo),
    ...(session.title ? { title: session.title } : {}),
    ...(windowInfo ? { windowId: windowInfo.id } : {}),
  };
}

export function createTerminalSessionService(): TerminalSessionService {
  return {
    async listRecentClosed({ windowId, windows }) {
      const windowByRecordId = new Map(
        windows.map((windowInfo) => [windowInfo.recordId, windowInfo])
      );
      if (windowId) {
        const windowInfo = windows.find(
          (candidate) => candidate.id === windowId
        );
        if (!windowInfo) {
          return [];
        }
        const sessions = await listRecentTerminalPanelSessions(
          windowInfo.recordId
        );
        return sessions.map((session) =>
          toSnapshot({ ...session, recordId: windowInfo.recordId }, windowInfo)
        );
      }
      const sessions = await listAllRecentTerminalPanelSessions();
      return sessions.map((session) =>
        toSnapshot(session, windowByRecordId.get(session.recordId))
      );
    },
  };
}

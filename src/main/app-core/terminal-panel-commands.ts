import type {
  PierCommand,
  PierCommandResult,
} from "@shared/contracts/commands.ts";
import type { WindowInfo } from "@shared/contracts/events.ts";
import type {
  TerminalListSnapshot,
  TerminalOpenSessionSnapshot,
} from "@shared/contracts/terminal.ts";
import type { RendererCommandService } from "../services/renderer-command-service.ts";
import type { TerminalSessionService } from "../services/terminal-session-service.ts";
import { commandFailure, commandSuccess } from "./command-results.ts";
import {
  asRecord,
  booleanValue,
  numberValue,
  stringValue,
} from "./command-value.ts";
import { orderedWindows, resolveCommandWindow } from "./window-routing.ts";

export interface TerminalCommandServices {
  rendererCommand: RendererCommandService;
  terminalSessions: TerminalSessionService;
  window: {
    list(): WindowInfo[];
  };
}

function normalizeOpenTerminalSnapshot(
  raw: unknown,
  windowInfo: WindowInfo,
  windowIndex: number
): TerminalOpenSessionSnapshot | null {
  const record = asRecord(raw);
  if (!record) {
    return null;
  }
  const panelId = stringValue(record, "panelId") ?? stringValue(record, "id");
  if (!panelId) {
    return null;
  }
  const active = booleanValue(record, "active");
  const cwd = stringValue(record, "cwd");
  const title = stringValue(record, "title");
  const terminalTitle = stringValue(record, "terminalTitle");
  return {
    groupIndex: numberValue(record, "groupIndex", 0),
    panelId,
    recordId: windowInfo.recordId,
    tabCount: numberValue(record, "tabCount", 1),
    tabIndex: numberValue(record, "tabIndex", 0),
    windowFocused: windowInfo.focused,
    windowId: windowInfo.id,
    windowIndex,
    ...(active === undefined ? {} : { active }),
    ...(cwd ? { cwd } : {}),
    ...(terminalTitle ? { terminalTitle } : {}),
    ...(title ? { title } : {}),
  };
}

export async function listTerminalSessions(
  command: Extract<PierCommand, { type: "terminal.list" }>,
  services: TerminalCommandServices
): Promise<TerminalListSnapshot> {
  const windows = orderedWindows(services.window.list());
  const targetWindows = command.windowId
    ? windows.filter((windowInfo) => windowInfo.id === command.windowId)
    : windows;
  const errors: TerminalListSnapshot["errors"] = [];
  if (command.windowId && targetWindows.length === 0) {
    errors.push({
      code: "not_found",
      message: `window not found: ${command.windowId}`,
      windowId: command.windowId,
    });
  }

  const open: TerminalOpenSessionSnapshot[] = [];
  for (const windowInfo of targetWindows) {
    const windowIndex = windows.findIndex(
      (candidate) => candidate.id === windowInfo.id
    );
    const result = await services.rendererCommand.execute({
      type: "terminal.list",
      windowId: windowInfo.id,
    });
    if (!result.ok) {
      errors.push({
        code: result.error.code,
        message: result.error.message,
        recordId: windowInfo.recordId,
        windowId: windowInfo.id,
      });
      continue;
    }
    if (!Array.isArray(result.data)) {
      errors.push({
        code: "platform_unavailable",
        message: "renderer returned invalid terminal list",
        recordId: windowInfo.recordId,
        windowId: windowInfo.id,
      });
      continue;
    }
    for (const rawPanel of result.data) {
      const snapshot = normalizeOpenTerminalSnapshot(
        rawPanel,
        windowInfo,
        windowIndex >= 0 ? windowIndex : 0
      );
      if (snapshot) {
        open.push(snapshot);
      }
    }
  }

  const recentClosed = await services.terminalSessions.listRecentClosed({
    windowId: command.windowId,
    windows,
  });

  return { errors, open, recentClosed };
}

export async function executeTerminalListCommand(
  requestId: string,
  command: Extract<PierCommand, { type: "terminal.list" }>,
  services: TerminalCommandServices
): Promise<PierCommandResult> {
  if (command.windowId) {
    const target = resolveCommandWindow(command.windowId, services);
    if (!target.window) {
      return commandFailure(
        requestId,
        "not_found",
        target.error ?? `window not found: ${command.windowId}`
      );
    }
  }
  const snapshot = await listTerminalSessions(command, services);
  if (command.windowId && snapshot.errors.length > 0) {
    const error = snapshot.errors[0];
    return commandFailure(
      requestId,
      error?.code ?? "platform_unavailable",
      error?.message ?? "terminal list failed"
    );
  }
  return commandSuccess(requestId, snapshot);
}

export async function executeTerminalOpenCommand(
  requestId: string,
  command: Extract<PierCommand, { type: "terminal.open" }>,
  services: TerminalCommandServices
): Promise<PierCommandResult> {
  const target = resolveCommandWindow(command.windowId, services, {
    requireStableDefault: !command.windowId,
  });
  if (!target.window) {
    return commandFailure(
      requestId,
      target.code ?? (command.windowId ? "not_found" : "platform_unavailable"),
      target.error ?? "no renderer window available"
    );
  }
  const routedCommand = { ...command, windowId: target.window.id };
  const result = await services.rendererCommand.execute(routedCommand);
  if (!result.ok) {
    return commandFailure(
      requestId,
      result.error.code ?? "platform_unavailable",
      result.error.message
    );
  }
  const record = asRecord(result.data);
  return commandSuccess(requestId, {
    ...(record ?? {}),
    windowId: target.window.id,
  });
}

export async function executeTerminalFocusCommand(
  requestId: string,
  command: Extract<PierCommand, { type: "terminal.focus" }>,
  services: TerminalCommandServices
): Promise<PierCommandResult> {
  if (command.windowId) {
    const target = resolveCommandWindow(command.windowId, services);
    if (!target.window) {
      return commandFailure(
        requestId,
        "not_found",
        target.error ?? `window not found: ${command.windowId}`
      );
    }
    const result = await services.rendererCommand.execute(command);
    if (!result.ok) {
      return commandFailure(
        requestId,
        result.error.code ?? "platform_unavailable",
        result.error.message
      );
    }
    const record = asRecord(result.data);
    return commandSuccess(requestId, {
      ...(record ?? {}),
      windowId: command.windowId,
    });
  }

  const sessions = await listTerminalSessions(
    { type: "terminal.list" },
    services
  );
  if (sessions.errors.length > 0) {
    return commandFailure(
      requestId,
      "platform_unavailable",
      "terminal list incomplete; pass --window"
    );
  }
  const matches = sessions.open.filter(
    (session) => session.panelId === command.panelId
  );
  if (matches.length === 0) {
    return commandFailure(
      requestId,
      "not_found",
      `terminal not found: ${command.panelId}`
    );
  }
  if (matches.length > 1) {
    return commandFailure(
      requestId,
      "invalid_command",
      `terminal id is ambiguous: ${command.panelId}; pass --window`
    );
  }

  const match = matches[0];
  if (!match) {
    return commandFailure(
      requestId,
      "not_found",
      `terminal not found: ${command.panelId}`
    );
  }
  const result = await services.rendererCommand.execute({
    ...command,
    windowId: match.windowId,
  });
  if (!result.ok) {
    return commandFailure(
      requestId,
      result.error.code ?? "platform_unavailable",
      result.error.message
    );
  }
  const record = asRecord(result.data);
  return commandSuccess(requestId, {
    ...(record ?? {}),
    windowId: match.windowId,
  });
}

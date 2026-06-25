import type { MruState } from "@shared/contracts/command-palette-mru.ts";
import {
  type PierCommand,
  type PierCommandErrorCode,
  type PierCommandResult,
  type ProjectPreferencesPatch,
  pierCommandEnvelopeSchema,
} from "@shared/contracts/commands.ts";
import type { WindowInfo } from "@shared/contracts/events.ts";
import type { ProjectPreferences } from "@shared/contracts/preferences.ts";
import type {
  TerminalListSnapshot,
  TerminalOpenSessionSnapshot,
} from "@shared/contracts/terminal.ts";
import type { WindowCreateOptions } from "@shared/contracts/window.ts";
import type { RendererCommandService } from "../services/renderer-command-service.ts";
import type { TerminalSessionService } from "../services/terminal-session-service.ts";
import type { PierClientRegistry } from "./client-registry.ts";
import { authorizeCommand } from "./permissions.ts";

export interface PierCoreServices {
  commandPaletteMru: {
    clear(): Promise<MruState>;
    read(): Promise<MruState>;
    recordUse(actionId: string): Promise<void>;
  };
  preferences: {
    read(): Promise<ProjectPreferences>;
    update(patch: ProjectPreferencesPatch): Promise<ProjectPreferences>;
  };
  rendererCommand: RendererCommandService;
  terminalSessions: TerminalSessionService;
  window: {
    close(windowId: string): void;
    create(options?: WindowCreateOptions): Promise<{
      recordId: string;
      windowId: string;
    }>;
    focus(windowId: string): void;
    flushOpenWindows(): Promise<void>;
    flushWindow(windowId: string): Promise<void>;
    list(): WindowInfo[];
    restoreMostRecentClosed(): Promise<{
      recordId: string;
      windowId: string;
    } | null>;
    restoreOpenWindows(): Promise<
      Array<{ recordId: string; windowId: string }>
    >;
  };
  workspace: {
    clearLayout(recordId: string): Promise<void>;
    readLayout(recordId: string): Promise<unknown | null>;
    saveLayout(layout: unknown, recordId: string): Promise<void>;
  };
}

export interface CommandRouter {
  execute(envelope: unknown): Promise<PierCommandResult>;
}

export interface CreateCommandRouterArgs {
  clients: PierClientRegistry;
  services: PierCoreServices;
}

function success(requestId: string, data: unknown): PierCommandResult {
  return { data, ok: true, requestId };
}

function failure(
  requestId: string,
  code: PierCommandErrorCode,
  message: string
): PierCommandResult {
  return {
    error: { code, message },
    ok: false,
    requestId,
  };
}

function requestIdOf(rawEnvelope: unknown): string {
  if (
    rawEnvelope &&
    typeof rawEnvelope === "object" &&
    "requestId" in rawEnvelope &&
    typeof rawEnvelope.requestId === "string" &&
    rawEnvelope.requestId.length > 0
  ) {
    return rawEnvelope.requestId;
  }
  return "unknown";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(
  record: Record<string, unknown>,
  key: string
): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(
  record: Record<string, unknown>,
  key: string,
  fallback: number
): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function booleanValue(
  record: Record<string, unknown>,
  key: string
): boolean | undefined {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
}

function orderedWindows(windows: readonly WindowInfo[]): WindowInfo[] {
  return [...windows].sort((a, b) => {
    if (a.focused === b.focused) {
      return 0;
    }
    return a.focused ? -1 : 1;
  });
}

function normalizeOpenTerminalSnapshot(
  raw: unknown,
  windowInfo: WindowInfo
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
  return {
    groupIndex: numberValue(record, "groupIndex", 0),
    panelId,
    recordId: windowInfo.recordId,
    tabCount: numberValue(record, "tabCount", 1),
    tabIndex: numberValue(record, "tabIndex", 0),
    windowFocused: windowInfo.focused,
    windowId: windowInfo.id,
    ...(active === undefined ? {} : { active }),
    ...(cwd ? { cwd } : {}),
    ...(title ? { title } : {}),
  };
}

export async function listTerminalSessions(
  command: Extract<PierCommand, { type: "terminal.list" }>,
  services: PierCoreServices
): Promise<TerminalListSnapshot> {
  const windows = orderedWindows(services.window.list());
  const targetWindows = command.windowId
    ? windows.filter((windowInfo) => windowInfo.id === command.windowId)
    : windows;
  const errors: TerminalListSnapshot["errors"] = [];
  if (command.windowId && targetWindows.length === 0) {
    errors.push({
      message: `window not found: ${command.windowId}`,
      windowId: command.windowId,
    });
  }

  const open: TerminalOpenSessionSnapshot[] = [];
  for (const windowInfo of targetWindows) {
    const result = await services.rendererCommand.execute({
      type: "terminal.list",
      windowId: windowInfo.id,
    });
    if (!result.ok) {
      errors.push({
        message: result.error.message,
        recordId: windowInfo.recordId,
        windowId: windowInfo.id,
      });
      continue;
    }
    if (!Array.isArray(result.data)) {
      errors.push({
        message: "renderer returned invalid terminal list",
        recordId: windowInfo.recordId,
        windowId: windowInfo.id,
      });
      continue;
    }
    for (const rawPanel of result.data) {
      const snapshot = normalizeOpenTerminalSnapshot(rawPanel, windowInfo);
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

async function rendererCommandResult(
  requestId: string,
  command: Extract<
    PierCommand,
    | { type: "panel.focus" }
    | { type: "panel.list" }
    | { type: "terminal.open" }
    | { type: "workspace.open" }
  >,
  services: PierCoreServices
): Promise<PierCommandResult> {
  const result = await services.rendererCommand.execute(command);
  if (result.ok) {
    return success(requestId, result.data);
  }
  return failure(requestId, "platform_unavailable", result.error.message);
}

async function terminalFocusResult(
  requestId: string,
  command: Extract<PierCommand, { type: "terminal.focus" }>,
  services: PierCoreServices
): Promise<PierCommandResult> {
  if (command.windowId) {
    const result = await services.rendererCommand.execute(command);
    return result.ok
      ? success(requestId, result.data)
      : failure(requestId, "platform_unavailable", result.error.message);
  }

  const sessions = await listTerminalSessions(
    { type: "terminal.list" },
    services
  );
  const matches = sessions.open.filter(
    (session) => session.panelId === command.panelId
  );
  if (matches.length === 0) {
    return failure(
      requestId,
      "not_found",
      `terminal not found: ${command.panelId}`
    );
  }
  if (matches.length > 1) {
    return failure(
      requestId,
      "invalid_command",
      `terminal id is ambiguous: ${command.panelId}; pass --window`
    );
  }

  const match = matches[0];
  if (!match) {
    return failure(
      requestId,
      "not_found",
      `terminal not found: ${command.panelId}`
    );
  }
  const result = await services.rendererCommand.execute({
    ...command,
    windowId: match.windowId,
  });
  return result.ok
    ? success(requestId, result.data)
    : failure(requestId, "platform_unavailable", result.error.message);
}

export function createCommandRouter({
  clients,
  services,
}: CreateCommandRouterArgs): CommandRouter {
  return {
    async execute(rawEnvelope) {
      const requestId = requestIdOf(rawEnvelope);
      const parsed = pierCommandEnvelopeSchema.safeParse(rawEnvelope);
      if (!parsed.success) {
        return failure(requestId, "invalid_command", "invalid command");
      }

      const { clientId, command } = parsed.data;
      const client = clients.get(clientId);
      if (!client) {
        return failure(requestId, "permission_denied", "unknown client");
      }

      const auth = authorizeCommand(command, client);
      if (!auth.ok) {
        return failure(requestId, "permission_denied", auth.reason);
      }

      try {
        switch (command.type) {
          case "app.status":
            return success(requestId, {
              clients: clients.list().length,
              protocolVersion: 1,
            });
          case "commandPaletteMru.clear":
            return success(requestId, await services.commandPaletteMru.clear());
          case "commandPaletteMru.read":
            return success(requestId, await services.commandPaletteMru.read());
          case "commandPaletteMru.record":
            await services.commandPaletteMru.recordUse(command.actionId);
            return success(requestId, null);
          case "preferences.read":
            return success(requestId, await services.preferences.read());
          case "preferences.update":
            return success(
              requestId,
              await services.preferences.update(command.patch)
            );
          case "window.close":
            services.window.close(command.windowId);
            return success(requestId, null);
          case "window.create":
            return success(requestId, await services.window.create());
          case "window.focus":
            services.window.focus(command.windowId);
            return success(requestId, null);
          case "window.list":
            return success(requestId, services.window.list());
          case "workspace.layout.clear":
            await services.workspace.clearLayout(command.recordId);
            return success(requestId, null);
          case "workspace.layout.read":
            return success(
              requestId,
              await services.workspace.readLayout(command.recordId)
            );
          case "workspace.layout.save":
            await services.workspace.saveLayout(
              command.layout,
              command.recordId
            );
            return success(requestId, null);
          case "panel.focus":
          case "panel.list":
          case "terminal.open":
          case "workspace.open":
            return await rendererCommandResult(requestId, command, services);
          case "terminal.list":
            return success(
              requestId,
              await listTerminalSessions(command, services)
            );
          case "terminal.focus":
            return await terminalFocusResult(requestId, command, services);
          default: {
            const _exhaustive: never = command;
            return failure(
              requestId,
              "invalid_command",
              `unsupported command: ${String(_exhaustive)}`
            );
          }
        }
      } catch (err) {
        return failure(
          requestId,
          "internal_error",
          err instanceof Error ? err.message : String(err)
        );
      }
    },
  };
}

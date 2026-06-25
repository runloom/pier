import type { MruState } from "@shared/contracts/command-palette-mru.ts";
import {
  type PierCommandResult,
  type ProjectPreferencesPatch,
  pierCommandEnvelopeSchema,
} from "@shared/contracts/commands.ts";
import type { WindowInfo } from "@shared/contracts/events.ts";
import type { ProjectPreferences } from "@shared/contracts/preferences.ts";
import type { WindowCreateOptions } from "@shared/contracts/window.ts";
import type { RendererCommandService } from "../services/renderer-command-service.ts";
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
  code: PierCommandResult extends infer R
    ? R extends { ok: false; error: { code: infer C } }
      ? C
      : never
    : never,
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
          case "terminal.focus":
          case "terminal.list":
          case "terminal.open":
          case "workspace.open": {
            const result = await services.rendererCommand.execute(command);
            if (result.ok) {
              return success(requestId, result.data);
            }
            return failure(
              requestId,
              "platform_unavailable",
              result.error.message
            );
          }
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

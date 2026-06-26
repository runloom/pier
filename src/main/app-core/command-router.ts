import type { MruState } from "@shared/contracts/command-palette-mru.ts";
import {
  type PierCommandResult,
  type ProjectPreferencesPatch,
  pierCommandEnvelopeSchema,
} from "@shared/contracts/commands.ts";
import type { WindowInfo } from "@shared/contracts/events.ts";
import {
  type PanelContext,
  panelSnapshotSchema,
} from "@shared/contracts/panel.ts";
import type { ProjectPreferences } from "@shared/contracts/preferences.ts";
import type { WindowCreateOptions } from "@shared/contracts/window.ts";
import type { RendererCommandService } from "../services/renderer-command-service.ts";
import type { WorktreeService } from "../services/worktree-service.ts";
import type { PierClientRegistry } from "./client-registry.ts";
import {
  commandFailure as failure,
  commandSuccess as success,
} from "./command-results.ts";
import {
  executePanelFocusCommand,
  executePanelListCommand,
  executePanelOpenCommand,
} from "./panel-commands.ts";
import { authorizeCommand } from "./permissions.ts";
import { orderedWindows } from "./window-routing.ts";

export interface PierCoreServices {
  commandPaletteMru: {
    clear(): Promise<MruState>;
    read(): Promise<MruState>;
    recordUse(actionId: string): Promise<void>;
  };
  panelContexts: {
    listRecent(): Promise<PanelContext[]>;
    recordRecent(context: PanelContext): Promise<void>;
    resolveForPath(path: string): Promise<PanelContext>;
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
  worktrees: WorktreeService;
}

export interface CommandRouter {
  execute(envelope: unknown): Promise<PierCommandResult>;
}

export interface CreateCommandRouterArgs {
  clients: PierClientRegistry;
  services: PierCoreServices;
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

async function deriveActivePanelContext(
  services: PierCoreServices
): Promise<PanelContext | null> {
  const focusedWindow = orderedWindows(services.window.list()).find(
    (windowInfo) => windowInfo.focused
  );
  if (!focusedWindow) {
    return null;
  }
  const result = await services.rendererCommand.execute({
    type: "panel.list",
    windowId: focusedWindow.id,
  });
  if (!(result.ok && Array.isArray(result.data))) {
    return null;
  }
  for (const rawPanel of result.data) {
    const parsed = panelSnapshotSchema.safeParse(rawPanel);
    if (parsed.success && parsed.data.active) {
      return parsed.data.context ?? null;
    }
  }
  return null;
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
              panelContext: {
                active: await deriveActivePanelContext(services),
                recent: await services.panelContexts.listRecent(),
              },
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
            return await executePanelFocusCommand(requestId, command, services);
          case "panel.list":
            return await executePanelListCommand(requestId, command, services);
          case "panel.open":
            return await executePanelOpenCommand(requestId, command, services);
          case "worktree.list":
            return success(requestId, await services.worktrees.list(command));
          case "worktree.create":
            return success(requestId, await services.worktrees.create(command));
          case "worktree.open":
            return await executePanelOpenCommand(
              requestId,
              {
                focus: command.focus,
                path: command.path,
                placement: command.placement,
                type: "panel.open",
                windowId: command.windowId,
              },
              services
            );
          case "worktree.remove":
            return failure(
              requestId,
              "unsupported",
              "worktree.remove is not supported yet"
            );
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

import type { MruState } from "@shared/contracts/command-palette-mru.ts";
import {
  type PierCommand,
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
import type { ResolvedTerminalLaunchOptions } from "@shared/contracts/terminal-launch.ts";
import type { WindowCreateOptions } from "@shared/contracts/window.ts";
import {
  type PluginService,
  PluginServiceError,
} from "../services/plugin-service.ts";
import type { RendererCommandService } from "../services/renderer-command-service.ts";
import {
  type WorktreeService,
  WorktreeServiceError,
} from "../services/worktree-service.ts";
import type { PierClientRegistry } from "./client-registry.ts";
import {
  commandFailure as failure,
  commandSuccess as success,
} from "./command-results.ts";
import {
  executePanelFocusCommand,
  executePanelListCommand,
  executePanelOpenCommand,
  executeTerminalOpenCommand,
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
  plugins: PluginService;
  preferences: {
    read(): Promise<ProjectPreferences>;
    update(patch: ProjectPreferencesPatch): Promise<ProjectPreferences>;
  };
  rendererCommand: RendererCommandService;
  terminalLaunches: {
    consume(
      launchId: string
    ):
      | Promise<ResolvedTerminalLaunchOptions | null>
      | ResolvedTerminalLaunchOptions
      | null;
    discard(launchId: string): Promise<void> | void;
    read(
      launchId: string
    ):
      | Promise<ResolvedTerminalLaunchOptions | null>
      | ResolvedTerminalLaunchOptions
      | null;
    register(launch: ResolvedTerminalLaunchOptions): Promise<string> | string;
    sweepExpired?(): Promise<number> | number;
  };
  terminalProfiles: {
    delete(profileId: string): Promise<boolean>;
    list(): Promise<Record<string, ResolvedTerminalLaunchOptions>>;
    read(profileId: string): Promise<ResolvedTerminalLaunchOptions | null>;
    resolve(
      profileId: string
    ):
      | Promise<ResolvedTerminalLaunchOptions | null>
      | ResolvedTerminalLaunchOptions
      | null;
    upsert(
      profileId: string,
      profile: ResolvedTerminalLaunchOptions
    ): Promise<ResolvedTerminalLaunchOptions>;
  };
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

async function executePluginCommand(
  requestId: string,
  command: PierCommand,
  services: PierCoreServices
): Promise<PierCommandResult | null> {
  switch (command.type) {
    case "plugin.list":
      return success(requestId, await services.plugins.list());
    case "plugin.inspect": {
      const plugin = await services.plugins.inspect(command.id);
      if (!plugin) {
        return failure(
          requestId,
          "not_found",
          `plugin not found: ${command.id}`
        );
      }
      return success(requestId, plugin);
    }
    default:
      return null;
  }
}

async function executeWorktreeCommand(
  requestId: string,
  command: PierCommand,
  services: PierCoreServices
): Promise<PierCommandResult | null> {
  switch (command.type) {
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
      return success(requestId, await services.worktrees.remove(command));
    default:
      return null;
  }
}

async function executeAppStateCommand(
  requestId: string,
  command: PierCommand,
  clients: PierClientRegistry,
  services: PierCoreServices
): Promise<PierCommandResult | null> {
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
    default:
      return null;
  }
}

async function executeWindowWorkspaceCommand(
  requestId: string,
  command: PierCommand,
  services: PierCoreServices
): Promise<PierCommandResult | null> {
  switch (command.type) {
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
      await services.workspace.saveLayout(command.layout, command.recordId);
      return success(requestId, null);
    default:
      return null;
  }
}

async function executePanelCommand(
  requestId: string,
  command: PierCommand,
  services: PierCoreServices
): Promise<PierCommandResult | null> {
  switch (command.type) {
    case "panel.focus":
      return await executePanelFocusCommand(requestId, command, services);
    case "panel.list":
      return await executePanelListCommand(requestId, command, services);
    case "panel.open":
      return await executePanelOpenCommand(requestId, command, services);
    default:
      return null;
  }
}

async function executeTerminalCommand(
  requestId: string,
  command: PierCommand,
  services: PierCoreServices
): Promise<PierCommandResult | null> {
  switch (command.type) {
    case "terminal.open":
      return await executeTerminalOpenCommand(requestId, command, services);
    case "terminal.profile.delete":
      return success(
        requestId,
        await services.terminalProfiles.delete(command.profileId)
      );
    case "terminal.profile.list":
      return success(requestId, await services.terminalProfiles.list());
    case "terminal.profile.read":
      return success(
        requestId,
        await services.terminalProfiles.read(command.profileId)
      );
    case "terminal.profile.upsert":
      return success(
        requestId,
        await services.terminalProfiles.upsert(
          command.profileId,
          command.profile
        )
      );
    default:
      return null;
  }
}

async function executeKnownCommand(
  requestId: string,
  command: PierCommand,
  clients: PierClientRegistry,
  services: PierCoreServices
): Promise<PierCommandResult> {
  try {
    const executors = [
      (cmd: PierCommand) => executePluginCommand(requestId, cmd, services),
      (cmd: PierCommand) => executeWorktreeCommand(requestId, cmd, services),
      (cmd: PierCommand) => executeTerminalCommand(requestId, cmd, services),
      (cmd: PierCommand) =>
        executeAppStateCommand(requestId, cmd, clients, services),
      (cmd: PierCommand) =>
        executeWindowWorkspaceCommand(requestId, cmd, services),
      (cmd: PierCommand) => executePanelCommand(requestId, cmd, services),
    ];
    for (const executor of executors) {
      const result = await executor(command);
      if (result) {
        return result;
      }
    }
    return failure(
      requestId,
      "invalid_command",
      `unsupported command: ${command.type}`
    );
  } catch (err) {
    if (err instanceof WorktreeServiceError) {
      return failure(requestId, err.reason, err.message);
    }
    if (err instanceof PluginServiceError) {
      const code =
        err.code === "invalid_manifest" ? "invalid_command" : err.code;
      return failure(requestId, code, err.message);
    }
    return failure(
      requestId,
      "internal_error",
      err instanceof Error ? err.message : String(err)
    );
  }
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

      return await executeKnownCommand(requestId, command, clients, services);
    },
  };
}

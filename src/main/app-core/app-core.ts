import type { MruState } from "@shared/contracts/command-palette-mru.ts";
import { RENDERER_COMMAND_CHANNEL } from "@shared/contracts/renderer-command-channels.ts";
import { app } from "electron";
import {
  createMainPluginHostApi,
  type MainPluginHostApi,
} from "../plugins/host-api.ts";
import { createCommandPaletteMruService } from "../services/command-palette-service.ts";
import { createPanelContextService } from "../services/panel-context-service.ts";
import { createPluginService } from "../services/plugin-service.ts";
import { createDefaultPluginSources } from "../services/plugin-sources.ts";
import { createPreferencesService } from "../services/preferences-service.ts";
import { createRendererCommandService } from "../services/renderer-command-service.ts";
import { createTaskService } from "../services/tasks/task-service.ts";
import { createTerminalProfileService } from "../services/terminal-profile-service.ts";
import { createWindowService } from "../services/window-service.ts";
import { createWorkspaceService } from "../services/workspace-service.ts";
import { createWorktreeService } from "../services/worktree-service.ts";
import { terminalLaunchRegistry } from "../state/terminal-launch-state.ts";
import type { AppWindow } from "../windows/app-window.ts";
import { windowManager } from "../windows/window-manager.ts";
import {
  createClientRegistry,
  type PierClientRegistry,
} from "./client-registry.ts";
import {
  type CommandRouter,
  createCommandRouter,
  type PierCoreServices,
} from "./command-router.ts";
import { createPierEventBus, type PierEventBus } from "./event-bus.ts";

export interface PierAppCore {
  clients: PierClientRegistry;
  commandRouter: CommandRouter;
  eventBus: PierEventBus;
  pluginHost: MainPluginHostApi;
  services: PierCoreServices;
}

function broadcastMruState(state: MruState): void {
  for (const win of windowManager.getAll()) {
    if (!win.isDestroyed()) {
      win.webContents.send("pier:command-palette-mru:changed", state);
    }
  }
}

function focusRendererTarget(win: AppWindow): void {
  if (win.isMinimized()) {
    win.restore();
  }
  if (process.platform === "darwin") {
    app.focus({ steal: true });
  }
  win.focus();
  win.webContents.focus();
}

function sendRendererCommand(
  envelope: unknown,
  windowId?: string,
  options: { focus?: boolean } = {}
): boolean {
  if (windowId) {
    const target = windowManager.get(windowId);
    if (!target || target.isDestroyed()) {
      return false;
    }
    if (options.focus) {
      focusRendererTarget(target);
    }
    target.webContents.send(RENDERER_COMMAND_CHANNEL, envelope);
    return true;
  }
  const focused =
    windowManager.getFocused() ??
    windowManager.getAll().find((win) => !win.isDestroyed()) ??
    null;
  if (!focused || focused.isDestroyed()) {
    return false;
  }
  if (options.focus) {
    focusRendererTarget(focused);
  }
  focused.webContents.send(RENDERER_COMMAND_CHANNEL, envelope);
  return true;
}

function createPierAppCore(): PierAppCore {
  const eventBus = createPierEventBus();
  const clients = createClientRegistry();
  const rendererCommand = createRendererCommandService({
    host: { send: sendRendererCommand },
  });
  const pluginHost = createMainPluginHostApi({
    plugins: createPluginService({ sources: createDefaultPluginSources }),
  });
  const services: PierCoreServices = {
    commandPaletteMru: createCommandPaletteMruService({
      broadcast: broadcastMruState,
    }),
    preferences: createPreferencesService({ eventBus }),
    plugins: pluginHost.plugins,
    panelContexts: createPanelContextService(),
    rendererCommand,
    tasks: createTaskService(),
    terminalProfiles: createTerminalProfileService(),
    terminalLaunches: terminalLaunchRegistry,
    window: createWindowService({
      flushRendererLayout: async (windowId) => {
        const result = await rendererCommand.execute({
          type: "workspace.flushLayout",
          windowId,
        });
        if (!result.ok) {
          throw new Error(result.error.message);
        }
      },
    }),
    workspace: createWorkspaceService(),
    worktrees: createWorktreeService(),
  };
  return {
    clients,
    commandRouter: createCommandRouter({ clients, services }),
    eventBus,
    pluginHost,
    services,
  };
}

export const appCore = createPierAppCore();

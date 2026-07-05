import type { MruState } from "@shared/contracts/command-palette-mru.ts";
import type { PluginRegistryListResult } from "@shared/contracts/plugin.ts";
import { RENDERER_COMMAND_CHANNEL } from "@shared/contracts/renderer-command-channels.ts";
import type { TerminalStatusBarPrefs } from "@shared/contracts/terminal-status-bar.ts";
import { PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { app } from "electron";
import { foregroundActivityService } from "../ipc/foreground-activity.ts";
import {
  createMainPluginHostApi,
  type MainPluginHostApi,
} from "../plugins/host-api.ts";
import { createAgentDetectionService } from "../services/agents/agent-detection-service.ts";
import { createAiService } from "../services/ai/ai-service.ts";
import { createCommandPaletteMruService } from "../services/command-palette-service.ts";
import { createFileService } from "../services/file-service.ts";
import { createGitService } from "../services/git-service.ts";
import { createGitWatchService } from "../services/git-watch-service.ts";
import { createPanelContextService } from "../services/panel-context-service.ts";
import { createPluginService } from "../services/plugin-service.ts";
import { createPluginSettingsService } from "../services/plugin-settings-service.ts";
import { createDefaultPluginSources } from "../services/plugin-sources.ts";
import { createPreferencesService } from "../services/preferences-service.ts";
import { createProcessEnvironmentService } from "../services/process-environment-service.ts";
import { createRendererCommandService } from "../services/renderer-command-service.ts";
import { createTaskService } from "../services/tasks/task-service.ts";
import { createTerminalProfileService } from "../services/terminal-profile-service.ts";
import { createWindowService } from "../services/window-service.ts";
import { createWorkspaceService } from "../services/workspace-service.ts";
import { createWorktreeService } from "../services/worktree-service.ts";
import { createSecretsStore } from "../state/secrets-store.ts";
import { terminalLaunchRegistry } from "../state/terminal-launch-state.ts";
import {
  applyTerminalStatusBarItemOverridePatch,
  applyTerminalStatusBarItemOverridePatches,
  readTerminalStatusBarPrefs,
  resetTerminalStatusBarItem,
} from "../state/terminal-status-bar-prefs.ts";
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
      win.webContents.send(PIER_BROADCAST.COMMAND_PALETTE_MRU_CHANGED, state);
    }
  }
}

function broadcastTerminalStatusBarPrefs(prefs: TerminalStatusBarPrefs): void {
  for (const win of windowManager.getAll()) {
    if (!win.isDestroyed()) {
      win.webContents.send(
        PIER_BROADCAST.TERMINAL_STATUS_BAR_PREFS_CHANGED,
        prefs
      );
    }
  }
}

function broadcastPluginRegistryChanged(
  result: PluginRegistryListResult
): void {
  for (const win of windowManager.getAll()) {
    if (!win.isDestroyed()) {
      win.webContents.send(PIER_BROADCAST.PLUGINS_CHANGED, result);
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
  const basePlugins = createPluginService({
    sources: createDefaultPluginSources,
  });
  const pluginSettings = createPluginSettingsService({ plugins: basePlugins });
  pluginSettings.onDidChange((payload) => {
    for (const win of windowManager.getAll()) {
      if (!win.isDestroyed()) {
        win.webContents.send(PIER_BROADCAST.PLUGIN_SETTINGS_CHANGED, payload);
      }
    }
  });
  const pluginHost = createMainPluginHostApi({
    onRegistryChanged: broadcastPluginRegistryChanged,
    plugins: basePlugins,
    settings: pluginSettings,
  });
  const preferences = createPreferencesService({ eventBus });
  const secrets = createSecretsStore();
  // AI 复用本机 CLI agent:探测走 agents 检测服务,选择遵循 defaultAgentId
  const agentDetection = createAgentDetectionService();
  const services: PierCoreServices = {
    ai: createAiService({
      detectAgents: async () => (await agentDetection.detect()).detectedIds,
      readPreferences: () => preferences.read(),
    }),
    commandPaletteMru: createCommandPaletteMruService({
      broadcast: broadcastMruState,
    }),
    files: createFileService(),
    preferences,
    secrets,
    processEnvironment: createProcessEnvironmentService(),
    plugins: pluginHost.plugins,
    pluginSettings,
    panelContexts: createPanelContextService(),
    rendererCommand,
    tasks: createTaskService({
      onTaskActivity: {
        onLaunched: (panelId, windowId, task) => {
          if (!windowId) {
            // windowId 缺失的 activity 永远路由不到任何 renderer（广播按
            // electron id 定向），入聚合器只会留一个不可见 slot——拒收并留痕。
            // 生产 openTerminalForLaunch 无 windowId 会直接 throw, 此处仅防
            // 类型层面的 undefined。
            console.warn(
              "[task-activity] missing windowId, activity skipped:",
              panelId
            );
            return;
          }
          foregroundActivityService.taskLaunched(panelId, windowId, task);
        },
        onFinished: (panelId, args) => {
          foregroundActivityService.taskFinished(panelId, args);
        },
      },
    }),
    terminalProfiles: createTerminalProfileService(),
    terminalStatusBarPrefs: {
      applyOverrides: async (patches) => {
        // F8:一次 mutate 应用全部 patch + 恰一次广播(而非逐项 N 次 IPC)。
        const next = await applyTerminalStatusBarItemOverridePatches(patches);
        broadcastTerminalStatusBarPrefs(next);
        return next;
      },
      getAll: () => readTerminalStatusBarPrefs(),
      resetItem: async (itemId) => {
        const next = await resetTerminalStatusBarItem(itemId);
        broadcastTerminalStatusBarPrefs(next);
        return next;
      },
      setItemOverride: async (itemId, patch) => {
        // F7:main 侧单线程合成(patch → withItemOverridePatch),不再接收
        // renderer 合成好的整体覆盖,消除 lost-update 竞态。
        const next = await applyTerminalStatusBarItemOverridePatch(
          itemId,
          patch
        );
        broadcastTerminalStatusBarPrefs(next);
        return next;
      },
    },
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
    worktrees: createWorktreeService({
      readPreferences: () => preferences.read(),
    }),
    ...(() => {
      // git 与 gitWatch 一体：watch 广播需带 status snapshot（多订阅共享 + 免竞态），
      // 所以在这里显式绑 getStatus，避免拆构造顺序
      const git = createGitService();
      return {
        git,
        gitWatch: createGitWatchService({
          getStatus: (gitRoot, prefetched) =>
            git.getStatus(gitRoot, prefetched),
          // poll 仅在有窗口聚焦时执行；后台错过的 poll 由聚焦补课 pulse 弥补（index.ts）
          isPollActive: () => windowManager.getFocused() !== null,
        }),
      };
    })(),
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

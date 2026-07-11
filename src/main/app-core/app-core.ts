import { join } from "node:path";
import { RENDERER_COMMAND_CHANNEL } from "@shared/contracts/renderer-command-channels.ts";
import { PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { createLogger } from "@shared/logger.ts";
import { app } from "electron";
import { foregroundActivityService } from "../ipc/foreground-activity.ts";
import {
  createExternalMainPluginRuntime,
  type ExternalMainPluginContext,
  type ExternalMainPluginRuntime,
} from "../plugins/external-main-runtime.ts";
import {
  createMainPluginHostApi,
  type MainPluginHostApi,
} from "../plugins/host-api.ts";
import {
  createPluginRpcBus,
  type PluginRpcBus,
} from "../plugins/plugin-rpc-bus.ts";
import { registerPluginRpcIpc } from "../plugins/plugin-rpc-ipc.ts";
import { isDevRuntime } from "../runtime-mode.ts";
import { createCodexLegacyMigrationAdapter } from "../services/agent-accounts/legacy-migration-adapter.ts";
import { createAgentDetectionService } from "../services/agents/agent-detection-service.ts";
import { createAiService } from "../services/ai/ai-service.ts";
import { createAppUpdateService } from "../services/app-updates/app-update-service.ts";
import { createElectronAppUpdaterAdapter } from "../services/app-updates/electron-updater-adapter.ts";
import { createCommandPaletteMruService } from "../services/command-palette-service.ts";
import { createFileDraftsService } from "../services/file-drafts-service.ts";
import { createFileService } from "../services/file-service.ts";
import { createFileWatchService } from "../services/file-watch-service.ts";
import { createGitService } from "../services/git-service.ts";
import { createGitWatchService } from "../services/git-watch-service.ts";
import { createLocalEnvironmentService } from "../services/local-environments-service.ts";
import { createNodeHttpAssetFetcher } from "../services/managed-plugins/http-asset-fetcher.ts";
import { createHttpOfficialIndexProvider } from "../services/managed-plugins/http-index-provider.ts";
import { createManagedPluginIndexStore } from "../services/managed-plugins/index-state.ts";
import {
  createManagedPluginInstallService,
  type ManagedPluginInstallService,
} from "../services/managed-plugins/install-service.ts";
import { createManagedPluginOperationLog } from "../services/managed-plugins/operation-log.ts";
import { createManagedPluginPaths } from "../services/managed-plugins/paths.ts";
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
import { showNativeWindowCloseFailure } from "../windows/native-window-close-failure.ts";
import { windowManager } from "../windows/window-manager.ts";
import { requireAppCoreInitialization } from "./app-core-readiness.ts";
import { readBundledPlugin } from "./bundled-plugin-reader.ts";
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
import { createLazyAppCore } from "./lazy-app-core.ts";
import {
  type ManagedPluginDevRuntimeWatch,
  startManagedPluginDevRuntimeWatch,
} from "./managed-plugin-dev-runtime-watch.ts";
import { createManagedPluginRuntimeReconciler } from "./managed-plugin-runtime-reconciler.ts";
import { PluginDisableTransitionCoordinator } from "./plugin-disable-transition.ts";
import {
  broadcastAppUpdateChanged,
  broadcastEnvironmentsChanged,
  broadcastMruState,
  broadcastPluginRegistryChanged,
  broadcastTaskBackgroundSnapshot,
  broadcastTerminalStatusBarPrefs,
} from "./window-broadcasts.ts";

export interface PierAppCore {
  clients: PierClientRegistry;
  commandRouter: CommandRouter;
  disposeManagedPluginDevRuntimeWatch(): void;
  eventBus: PierEventBus;
  flushExternalPluginsBeforeQuit(): Promise<void>;
  pluginHost: MainPluginHostApi;
  ready: Promise<void>;
  services: PierCoreServices;
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
  const pluginDisableTransitions = new PluginDisableTransitionCoordinator();
  const managedPluginPaths = createManagedPluginPaths(app.getPath("userData"));
  const managedPluginIndexStore = createManagedPluginIndexStore(
    managedPluginPaths.indexFile
  );
  const managedPluginOpLog = createManagedPluginOperationLog(
    managedPluginPaths.operationLogFile
  );
  const codexBundle = readBundledPlugin({
    devPackageDir: "packages/plugin-codex",
    fallbackId: "pier.codex",
    fallbackName: "Codex",
    fallbackVersion: "1.0.0",
    prodPluginDirName: "pier.codex",
  });
  const codexSeedAvailable = codexBundle !== null;
  let pluginHostRef: MainPluginHostApi | null = null;
  const httpIndex = createHttpOfficialIndexProvider({
    cachePath: managedPluginPaths.officialIndexCacheFile,
    logger: (diagnostics) => {
      for (const d of diagnostics) {
        console.error(`[managed-plugins] official index: ${d.message}`);
      }
    },
    runtimeMode: isDevRuntime() ? "development" : "production",
  });
  const assetFetcher = createNodeHttpAssetFetcher();
  let externalMainRuntimeReconciler: ReturnType<
    typeof createManagedPluginRuntimeReconciler
  > | null = null;
  let managedPluginDevRuntimeWatch: ManagedPluginDevRuntimeWatch | null = null;
  const managedPlugins: ManagedPluginInstallService =
    createManagedPluginInstallService({
      appendOperationLog: (record) => managedPluginOpLog.append(record),
      assetFetcher,
      bundledPlugins: codexBundle
        ? [
            {
              archivePath: codexBundle.archivePath,
              contributionCounts: codexBundle.contributionCounts,
              displayName: codexBundle.name,
              id: "pier.codex",
              sha256: codexBundle.sha256,
              version: codexBundle.version,
              ...(codexBundle.description
                ? { description: codexBundle.description }
                : {}),
              ...(codexBundle.locales ? { locales: codexBundle.locales } : {}),
              ...(codexBundle.size ? { size: codexBundle.size } : {}),
            },
          ]
        : [],
      officialIndexProvider: () => httpIndex.snapshot(),
      officialIndexRefresh: async (refreshOptions) => {
        await httpIndex.refresh(refreshOptions);
      },
      onRuntimeSourcesChanged: async (sources) => {
        if (externalMainRuntimeReconciler) {
          await externalMainRuntimeReconciler.reconcile(sources);
        }
        if (pluginHostRef) {
          await pluginHostRef.refresh();
        }
      },
      paths: managedPluginPaths,
      pierVersion: "0.1.0",
      runtimeMode: isDevRuntime() ? "development" : "production",
      store: managedPluginIndexStore,
    });
  const basePlugins = createPluginService({
    sources: createDefaultPluginSources,
    externalRuntimeSources: () =>
      managedPlugins.getRuntimeSources().map((s) => ({
        enabled: s.enabled,
        id: s.id,
        manifest: {
          ...s.manifest,
          source: {
            kind: s.kind === "devOverride" ? "devOverride" : "official",
          },
        },
        rendererEntryUrl: s.rendererEntryUrl,
        source: s.kind === "devOverride" ? "devOverride" : "official",
        ...(s.sourceRevision ? { sourceRevision: s.sourceRevision } : {}),
        version: s.version,
      })),
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
  const pluginRpcBus: PluginRpcBus = createPluginRpcBus({
    broadcast: (payload) => {
      for (const win of windowManager.getAll()) {
        if (!win.isDestroyed()) {
          win.webContents.send(PIER_BROADCAST.PLUGIN_RPC_EVENT, payload);
        }
      }
    },
  });
  registerPluginRpcIpc(pluginRpcBus);
  const externalMainRuntime: ExternalMainPluginRuntime =
    createExternalMainPluginRuntime({
      createContext: (source): ExternalMainPluginContext => ({
        events: {
          emit: (event, payload) =>
            pluginRpcBus.emit(source.id, event, payload),
        },
        lifecycle: { onBeforeQuit: () => {} },
        ...(source.id === "pier.codex"
          ? {
              legacyCodexAccounts: createCodexLegacyMigrationAdapter({
                secretsStore: secrets,
                userDataDir: app.getPath("userData"),
              }),
            }
          : {}),
        logger: createLogger(source.id),
        paths: {
          dataDir: managedPluginPaths.workDir,
          workDir: join(managedPluginPaths.workDir, source.id),
        },
        plugin: { id: source.id, version: source.version },
        rpc: {
          handle: (method, handler) =>
            pluginRpcBus.handle(source.id, method, handler),
        },
      }),
      recordActivationResult: (input) =>
        managedPlugins.recordActivationResult(input),
      rpcBus: pluginRpcBus,
    });
  externalMainRuntimeReconciler =
    createManagedPluginRuntimeReconciler(externalMainRuntime);
  pluginHostRef = pluginHost;
  const managedPluginsReady = requireAppCoreInitialization(
    managedPlugins.init(),
    (err) => console.error("[managed-plugins] init failed:", err)
  ).then(async () => {
    // Kick off async official-index refresh — non-blocking. Cache hit
    // becomes catalog immediately; network response updates on arrival.
    httpIndex.refresh().catch((err: unknown) => {
      console.error("[managed-plugins] official-index refresh failed:", err);
    });
    // Dev-only: if a bundled plugin is already installed at the same version,
    // point runtime at the source package and watch built dist entries.
    if (isDevRuntime() && codexSeedAvailable) {
      const codexDevPackageDir = join(process.cwd(), "packages/plugin-codex");
      const index = managedPlugins.getIndex();
      const codex = index.plugins["pier.codex"];
      if (
        codex?.activeVersion === codexBundle?.version &&
        !codex.uninstalledAt
      ) {
        await managedPlugins
          .setDevOverride("pier.codex", codexDevPackageDir)
          .then(() => managedPlugins.simulateRestartForTests())
          .catch((err: unknown) => {
            console.error("[managed-plugins] dev override sync failed:", err);
          });
        managedPluginDevRuntimeWatch ??= startManagedPluginDevRuntimeWatch({
          logger: createLogger("managed-plugins"),
          packageDir: codexDevPackageDir,
          refreshRuntimeSources: () => managedPlugins.refreshRuntimeSources(),
        });
      }
    }
  });
  const processEnvironment = createProcessEnvironmentService();
  const fileDrafts = createFileDraftsService({
    userDataDir: app.getPath("userData"),
  });
  const runtimeMode = isDevRuntime() ? "development" : "production";
  // AI 复用本机 CLI agent:探测走 agents 检测服务,选择遵循 defaultAgentId
  const agentDetection = createAgentDetectionService();
  const services: PierCoreServices = {
    ai: createAiService({
      detectAgents: async () => (await agentDetection.detect()).detectedIds,
      readPreferences: () => preferences.read(),
    }),
    appUpdates: createAppUpdateService({
      currentVersion: app.getVersion(),
      onChange: broadcastAppUpdateChanged,
      runtimeMode,
      ...(runtimeMode === "production"
        ? { updater: createElectronAppUpdaterAdapter() }
        : {}),
    }),
    commandPaletteMru: createCommandPaletteMruService({
      broadcast: broadcastMruState,
    }),
    fileDrafts,
    files: createFileService(),
    fileWatch: createFileWatchService(),
    preferences,
    secrets,
    processEnvironment,
    localEnvironments: createLocalEnvironmentService({ processEnvironment }),
    plugins: pluginHost.plugins,
    managedPlugins,
    pluginDisableTransitions,
    pluginSettings,
    panelContexts: createPanelContextService(),
    rendererCommand,
    tasks: createTaskService({
      onBackgroundTasksChanged: broadcastTaskBackgroundSnapshot,
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
      processEnvironment,
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
      finalizeRendererClose: async (windowId, transitionId, outcome) => {
        const result = await rendererCommand.execute({
          outcome,
          transitionId,
          type: "workspace.finalizeClose",
          windowId,
        });
        if (!result.ok) {
          throw new Error(result.error.message);
        }
      },
      flushCriticalState: () => fileDrafts.flush(),
      prepareRendererClose: async (windowId, reason, transitionId) => {
        const result = await rendererCommand.execute({
          reason,
          transitionId,
          type: "workspace.prepareClose",
          windowId,
        });
        if (!result.ok) {
          throw new Error(result.error.message);
        }
      },
      reportCloseFailure: async (windowId, error) => {
        const result = await rendererCommand.execute({
          body: error instanceof Error ? error.message : String(error),
          type: "workspace.reportCloseFailure",
          windowId,
        });
        if (!result.ok) {
          throw new Error(result.error.message);
        }
      },
      reportCloseFailureFallback: showNativeWindowCloseFailure,
      runWhenPluginTransitionsIdle: (operation) =>
        pluginDisableTransitions.runWindowCreation(operation),
    }),
    workspace: createWorkspaceService(),
    worktrees: createWorktreeService({
      readPreferences: () => preferences.read(),
    }),
    ...(() => {
      // git 与 gitWatch 一体：watch 广播需带 status snapshot（多订阅共享 + 免竞态），
      // 所以在这里显式绑 getStatus，避免拆构造顺序
      const git = createGitService({
        resolveEnvironment: async (cwd) =>
          (await processEnvironment.resolve({ cwd, source: "plugin" })).env,
      });
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
    commandRouter: createCommandRouter({
      clients,
      onEnvironmentsChanged: broadcastEnvironmentsChanged,
      services,
    }),
    eventBus,
    disposeManagedPluginDevRuntimeWatch: () => {
      managedPluginDevRuntimeWatch?.dispose();
      managedPluginDevRuntimeWatch = null;
    },
    flushExternalPluginsBeforeQuit: () =>
      externalMainRuntime.flushAllBeforeQuit(),
    pluginHost,
    ready: managedPluginsReady,
    services,
  };
}

export const appCore = createLazyAppCore(createPierAppCore);

import { join } from "node:path";
import { PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { createLogger } from "@shared/logger.ts";
import { app } from "electron";
import { foregroundActivityService } from "../ipc/foreground-activity.ts";
import {
  getTerminalTaskLifecycleForTransfer,
  getTerminalTaskOutputBindingsForTransfer,
  getTerminalTaskServiceForTransfer,
} from "../ipc/terminal.ts";
import {
  createExternalMainPluginRuntime,
  type ExternalMainPluginContext,
  type ExternalMainPluginRuntime,
} from "../plugins/external-main-runtime.ts";
import { createExternalPluginProcessEnv } from "../plugins/external-plugin-process-env.ts";
import {
  createMainPluginHostApi,
  type MainPluginHostApi,
} from "../plugins/host-api.ts";
import { registerPluginActivationIpc } from "../plugins/plugin-activation-ipc.ts";
import {
  createPluginRpcBus,
  type PluginRpcBus,
} from "../plugins/plugin-rpc-bus.ts";
import { registerPluginRpcIpc } from "../plugins/plugin-rpc-ipc.ts";
import { createPluginSecretsFacade } from "../plugins/plugin-secrets.ts";
import { isDevRuntime } from "../runtime-mode.ts";
import { createCodexLegacyMigrationAdapter } from "../services/agent-accounts/legacy-migration-adapter.ts";
import { createAgentRuntimeIndexService } from "../services/agent-runtime-index/index.ts";
import { createAgentDetectionService } from "../services/agents/agent-detection-service.ts";
import { createAgentUsageService } from "../services/agents/agent-usage-service.ts";
import { createAiService } from "../services/ai/ai-service.ts";
import { createAppUpdateService } from "../services/app-updates/app-update-service.ts";
import { createElectronAppUpdaterAdapter } from "../services/app-updates/electron-updater-adapter.ts";
import { createCommandPaletteMruService } from "../services/command-palette-service.ts";
import { createFileDraftsService } from "../services/file-drafts-service.ts";
import { FilePathTransactionLock } from "../services/file-path-transaction-lock.ts";
import { createFileService } from "../services/file-service.ts";
import { createFileWatchService } from "../services/file-watch-service.ts";
import { GitReviewService } from "../services/git-review/git-review-service.ts";
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
import {
  getPierPluginMode,
  listConfiguredWorkspaceRoots,
} from "../services/managed-plugins/plugin-mode.ts";
import { bootWorkspacePluginMode } from "../services/managed-plugins/workspace-boot.ts";
import { createPanelContextService } from "../services/panel-context-service.ts";
import { createPluginService } from "../services/plugin-service.ts";
import { createPluginSettingsService } from "../services/plugin-settings-service.ts";
import { createDefaultPluginSources } from "../services/plugin-sources.ts";
import { createPreferencesService } from "../services/preferences-service.ts";
import { createProcessEnvironmentService } from "../services/process-environment-service.ts";
import { createRendererCommandService } from "../services/renderer-command-service.ts";
import { createTaskService } from "../services/tasks/task-service.ts";
import { createTerminalProfileService } from "../services/terminal-profile-service.ts";
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
import { showNativeWindowCloseFailure } from "../windows/native-window-close-failure.ts";
import { windowManager } from "../windows/window-manager.ts";
import { wireAppCoreWindowAndPanelTransfer } from "./app-core-panel-transfer.ts";
import { requireAppCoreInitialization } from "./app-core-readiness.ts";
import { createAppCoreUsageData } from "./app-core-usage-data.ts";
import {
  collectBundledPluginRegistrations,
  OFFICIAL_BUNDLED_PLUGIN_SPECS,
} from "./bundled-official-plugins.ts";
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
import { createManagedPluginDevRuntimeWatchRegistry } from "./managed-plugin-dev-runtime-watch.ts";
import { createManagedPluginRuntimeReconciler } from "./managed-plugin-runtime-reconciler.ts";
import { PluginDisableTransitionCoordinator } from "./plugin-disable-transition.ts";
import { wireProjectSkills } from "./project-skills-wiring.ts";
import { sendRendererCommand } from "./renderer-command-host.ts";
import { createTaskActivityHandlers } from "./task-activity-wiring.ts";
import {
  broadcastAppUpdateChanged,
  broadcastEnvironmentsChanged,
  broadcastMruState,
  broadcastPluginRegistryChanged,
  broadcastProjectSkillsInvalidated,
  broadcastTaskRunsSnapshot,
  broadcastTerminalStatusBarPrefs,
  broadcastWorktreeCreateProgress,
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
  const { registrations: bundledPluginRegistrations } =
    collectBundledPluginRegistrations();
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
  const managedPluginDevRuntimeWatches =
    createManagedPluginDevRuntimeWatchRegistry();
  const pluginMode = getPierPluginMode(process.cwd());
  const workspaceDevPluginSpecs = [
    ...OFFICIAL_BUNDLED_PLUGIN_SPECS.map((s) => ({
      devPackageDir: s.devPackageDir,
      id: s.id,
    })),
    ...listConfiguredWorkspaceRoots(process.cwd()).map((r) => ({
      devPackageDir: r.path,
      id: r.id,
    })),
  ];
  // Custom roots override first-party when id collides.
  const workspaceSpecById = new Map<
    string,
    { devPackageDir: string; id: string }
  >();
  for (const spec of workspaceDevPluginSpecs)
    workspaceSpecById.set(spec.id, spec);
  const dedupedSpecs = [...workspaceSpecById.values()];
  const managedPlugins: ManagedPluginInstallService =
    createManagedPluginInstallService({
      appendOperationLog: (record) => managedPluginOpLog.append(record),
      assetFetcher,
      bundledPlugins: bundledPluginRegistrations,
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
      expectedRendererWindowIds: () =>
        windowManager.list().map((item) => item.id),
      pierVersion: "0.1.0",
      pluginMode,
      runtimeMode: isDevRuntime() ? "development" : "production",
      store: managedPluginIndexStore,
      workspaceDevPluginSpecs: pluginMode === "workspace" ? dedupedSpecs : [],
    });
  registerPluginActivationIpc(managedPlugins);
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
  const { ready: usageDataReady, usageData } = createAppCoreUsageData(
    app.getPath("userData")
  );
  const pluginRpcBus: PluginRpcBus = createPluginRpcBus({
    broadcast: (payload) => {
      for (const win of windowManager.getAll()) {
        if (!win.isDestroyed()) {
          win.webContents.send(PIER_BROADCAST.PLUGIN_RPC_EVENT, payload);
        }
      }
    },
  });
  // PATH hydrate must exist before external plugins activate — GUI Electron
  // lacks login-shell bins (e.g. ~/.grok/bin). ensurePath is memoized.
  const agentDetection = createAgentDetectionService();
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
                userDataDir: app.getPath("userData"),
              }),
            }
          : {}),
        logger: createLogger(source.id),
        paths: {
          dataDir: managedPluginPaths.workDir,
          workDir: join(managedPluginPaths.workDir, source.id),
        },
        processEnv: createExternalPluginProcessEnv(),
        plugin: { id: source.id, version: source.version },
        rpc: {
          handle: (method, handler) =>
            pluginRpcBus.handle(source.id, method, handler),
        },
        secrets: createPluginSecretsFacade(secrets, source.id, {
          read: source.manifest.permissions.includes("secret:read"),
          write: source.manifest.permissions.includes("secret:write"),
        }),
        usageData: usageData.createPluginFacade(
          source.id,
          source.manifest.permissions.includes("usage:publish")
        ),
      }),
      recordActivationResult: (input) =>
        managedPlugins.recordActivationResult(input),
      rpcBus: pluginRpcBus,
    });
  externalMainRuntimeReconciler = createManagedPluginRuntimeReconciler(
    externalMainRuntime,
    { ensurePath: agentDetection.ensurePath }
  );
  pluginHostRef = pluginHost;
  const managedPluginsReady = usageDataReady
    .then(() =>
      requireAppCoreInitialization(managedPlugins.init(), (err) =>
        console.error("[managed-plugins] init failed:", err)
      )
    )
    .then(async () => {
      // Kick off async official-index refresh — non-blocking. Cache hit
      // becomes catalog immediately; network response updates on arrival.
      httpIndex.refresh().catch((err: unknown) => {
        console.error("[managed-plugins] official-index refresh failed:", err);
      });
      // Workspace mode: pin runtime to local package dirs (first-party + custom roots).
      if (pluginMode === "workspace") {
        await bootWorkspacePluginMode(dedupedSpecs, {
          managedPlugins,
          managedPluginIndexStore,
          managedPluginDevRuntimeWatches,
          officialBundledPluginIds: OFFICIAL_BUNDLED_PLUGIN_SPECS.map(
            (s) => s.id
          ),
        });
      } else {
        createLogger("managed-plugins").info(
          "[managed-plugins] plugin mode: release"
        );
      }
    });
  const processEnvironment = createProcessEnvironmentService();
  const fileDrafts = createFileDraftsService({
    userDataDir: app.getPath("userData"),
  });
  const runtimeMode = isDevRuntime() ? "development" : "production";
  const agentUsage = createAgentUsageService({
    userDataDir: app.getPath("userData"),
  });
  const agentRuntimeIndex = createAgentRuntimeIndexService({
    snapshot: () => foregroundActivityService.snapshot(),
    rendererCommand,
  });

  const filePathTransactionLock = new FilePathTransactionLock();
  const files = createFileService({
    transactionLock: filePathTransactionLock,
  });
  const localEnvironments = createLocalEnvironmentService({
    processEnvironment,
  });
  const panelContexts = createPanelContextService();
  const { projectSkills, agentLaunchGate } = wireProjectSkills({
    userData: app.getPath("userData"),
    isProduction: runtimeMode === "production",
    transactionLock: filePathTransactionLock,
    panelContexts,
    localEnvironments,
    listInstalledAgents: async () =>
      (await agentDetection.detect()).detectedIds,
    onInvalidated: (event) => {
      broadcastProjectSkillsInvalidated(event);
    },
  });

  const workspaceService = createWorkspaceService();
  const { panelTransfer: panelTransferRef, window: windowService } =
    wireAppCoreWindowAndPanelTransfer({
      fileDrafts,
      fileDraftsFlush: () => fileDrafts.flush(),
      getTaskLifecycle: () => getTerminalTaskLifecycleForTransfer(),
      getTaskOutputBindings: () => getTerminalTaskOutputBindingsForTransfer(),
      getTaskService: () => getTerminalTaskServiceForTransfer(),
      pluginDisableTransitions,
      rendererCommand,
      reportCloseFailureFallback: showNativeWindowCloseFailure,
      workspace: workspaceService,
    });

  const services: PierCoreServices = {
    agentDetection,
    agentRuntimeIndex,
    agentUsage,
    agentLaunchGate,
    ai: createAiService({
      detectAgents: async () => (await agentDetection.detect()).detectedIds,
      readAgentUsage: () => agentUsage.read(),
      readPreferences: () => preferences.read(),
      launchGate: agentLaunchGate,
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
    files,
    fileWatch: createFileWatchService(),
    preferences,
    projectSkills,
    secrets,
    usageData,
    processEnvironment,
    localEnvironments,
    plugins: pluginHost.plugins,
    managedPlugins,
    pluginDisableTransitions,
    pluginSettings,
    panelContexts,
    rendererCommand,
    tasks: createTaskService({
      onTaskRunsChanged: broadcastTaskRunsSnapshot,
      onTaskActivity: createTaskActivityHandlers(foregroundActivityService),
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
    window: windowService,
    panelTransfer: panelTransferRef,
    workspace: workspaceService,
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
        gitReview: new GitReviewService(),
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
      onWorktreeCreateProgress: broadcastWorktreeCreateProgress,
      services,
    }),
    eventBus,
    disposeManagedPluginDevRuntimeWatch: () => {
      managedPluginDevRuntimeWatches.dispose();
    },
    flushExternalPluginsBeforeQuit: () =>
      externalMainRuntime.flushAllBeforeQuit(),
    pluginHost,
    ready: managedPluginsReady,
    services,
  };
}

export const appCore = createLazyAppCore(createPierAppCore);

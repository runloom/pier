import { join } from "node:path";
import { PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { createLogger } from "@shared/logger.ts";
import { app } from "electron";
import { foregroundActivityService } from "../ipc/foreground-activity.ts";
import {
  getTerminalTaskLifecycleForTransfer,
  getTerminalTaskOutputBindingsForTransfer,
  getTerminalTaskServiceForTransfer,
} from "../ipc/terminal/index.ts";
import { registerPluginActivationIpc } from "../plugins/activation-ipc.ts";
import {
  createExternalMainPluginRuntime,
  type ExternalMainPluginRuntime,
} from "../plugins/external-main-runtime.ts";
import {
  createMainPluginHostApi,
  type MainPluginHostApi,
} from "../plugins/host-api.ts";
import { createPluginRpcBus, type PluginRpcBus } from "../plugins/rpc-bus.ts";
import { registerPluginRpcIpc } from "../plugins/rpc-ipc.ts";
import { isDevRuntime } from "../runtime-mode.ts";
import { createAgentRuntimeIndexService } from "../services/agent-runtime-index/index.ts";
import { createAgentDetectionService } from "../services/agents/detection-service.ts";
import { createAgentUsageService } from "../services/agents/usage-service.ts";
import { createAiService } from "../services/ai/service.ts";
import { createCommandPaletteMruService } from "../services/command-palette-service.ts";
import { createCommentsService } from "../services/comments/service.ts";
import { createFileDraftsService } from "../services/files/drafts-service.ts";
import { FilePathTransactionLock } from "../services/files/path-transaction-lock.ts";
import { createFileService } from "../services/files/service.ts";
import { createFileWatchService } from "../services/files/watch-service.ts";
import { createGitService } from "../services/git/service.ts";
import { createGitWatchService } from "../services/git/watch/service.ts";
import { createWorktreeService } from "../services/git/worktree/service.ts";
import { GitReviewService } from "../services/git-review/service.ts";
import { createNodeHttpAssetFetcher } from "../services/managed-plugins/http-asset-fetcher.ts";
import { createHttpOfficialIndexProvider } from "../services/managed-plugins/http-index-provider.ts";
import { createManagedPluginIndexStore } from "../services/managed-plugins/index-state.ts";
import {
  createManagedPluginInstallService,
  type ManagedPluginInstallService,
} from "../services/managed-plugins/install-service.ts";
import {
  getPierPluginMode,
  listConfiguredWorkspaceRoots,
} from "../services/managed-plugins/mode.ts";
import { createManagedPluginOperationLog } from "../services/managed-plugins/operation-log.ts";
import { createManagedPluginPaths } from "../services/managed-plugins/paths.ts";
import { bootWorkspacePluginMode } from "../services/managed-plugins/workspace-boot.ts";
import { createPanelContextService } from "../services/panel-context-service.ts";
import { createPluginService } from "../services/plugin-service.ts";
import { createPluginSettingsService } from "../services/plugin-settings-service.ts";
import { createDefaultPluginSources } from "../services/plugin-sources.ts";
import { createPreferencesService } from "../services/preferences-service.ts";
import { resolveProjectEnvForSpawn } from "../services/process-environment/resolve-project-env.ts";
import { createRendererCommandService } from "../services/renderer-command-service.ts";
import { createTaskService } from "../services/tasks/service.ts";
import { createTerminalProfileService } from "../services/terminal-profile-service.ts";
import { createWorkspaceService } from "../services/workspace-service.ts";
import { createSecretsStore } from "../state/secrets-store.ts";
import { terminalLaunchRegistry } from "../state/terminal-launch-state.ts";
import {
  applyTerminalStatusBarItemOverridePatch,
  applyTerminalStatusBarItemOverridePatches,
  readTerminalStatusBarPrefs,
  resetTerminalStatusBarItem,
} from "../state/terminal-status-bar-prefs.ts";
import { windowManager } from "../windows/manager.ts";
import { showNativeWindowCloseFailure } from "../windows/native-close-failure.ts";
import { createBootedAgentLifecycleService } from "./agent-lifecycle-boot.ts";
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
import { createExternalMainPluginContextFactory } from "./external-plugin-context.ts";
import { createLazyAppCore } from "./lazy.ts";
import { createAppLiveModulesService } from "./live-modules-wiring.ts";
import { createManagedPluginDevRuntimeWatchRegistry } from "./managed-plugin-dev-runtime-watch.ts";
import { createManagedPluginRuntimeReconciler } from "./managed-plugin-runtime-reconciler.ts";
import { wireAppCoreWindowAndPanelTransfer } from "./panel-transfer.ts";
import { wireAppCorePierHomeAndSkills } from "./pier-home.ts";
import { PluginDisableTransitionCoordinator } from "./plugin-disable-transition.ts";
import { requireAppCoreInitialization } from "./readiness.ts";
import { sendRendererCommand } from "./renderer-command-host.ts";
import { createShellEnvironmentBoot } from "./shell-environment-boot.ts";
import { createTaskActivityHandlers } from "./task-activity-wiring.ts";
import { createWiredAppUpdateService } from "./update-wiring.ts";
import { createAppCoreUsageData } from "./usage-data.ts";
import {
  broadcastCommentsChanged,
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

  // --- Shell env parity (sole hydration; before plugin activate / agent detect)
  const { processEnvironment, waitForHostEnv } = createShellEnvironmentBoot({
    eventBus,
    readPreferences: () => preferences.read(),
  });

  const pluginRpcBus: PluginRpcBus = createPluginRpcBus({
    broadcast: (payload) => {
      for (const win of windowManager.getAll()) {
        if (!win.isDestroyed()) {
          win.webContents.send(PIER_BROADCAST.PLUGIN_RPC_EVENT, payload);
        }
      }
    },
  });
  // Wait for host shell env (single dump); no second echo $PATH.
  // Detection and lifecycle share PES env so PATH probes stay consistent.
  const resolveAgentEnv = async () => {
    const { env } = await processEnvironment.resolve({ source: "agent" });
    return env;
  };
  const agentDetection = createAgentDetectionService({
    waitForHostEnv,
    getEnv: resolveAgentEnv,
  });
  const agentLifecycle = createBootedAgentLifecycleService({
    waitForHostEnv,
    getEnv: resolveAgentEnv,
    preferences,
    refreshDetection: async () => {
      await agentDetection.refresh();
    },
  });
  registerPluginRpcIpc(pluginRpcBus);
  const externalMainRuntime: ExternalMainPluginRuntime =
    createExternalMainPluginRuntime({
      createContext: createExternalMainPluginContextFactory({
        managedPluginWorkDir: managedPluginPaths.workDir,
        pluginRpcBus,
        processEnvironment,
        secrets,
        usageData,
        userDataDir: app.getPath("userData"),
      }),
      recordActivationResult: (input) =>
        managedPlugins.recordActivationResult(input),
      rpcBus: pluginRpcBus,
    });
  externalMainRuntimeReconciler = createManagedPluginRuntimeReconciler(
    externalMainRuntime,
    { waitForHostEnv }
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
  const fileDrafts = createFileDraftsService({
    userDataDir: app.getPath("userData"),
  });
  const comments = createCommentsService({
    userDataDir: app.getPath("userData"),
    broadcast: broadcastCommentsChanged,
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
  const panelContexts = createPanelContextService();
  const {
    agentLaunchGate,
    agentMcpCatalog,
    agentRules,
    localEnvironments,
    pierBindings,
    pierHome,
    projectSkills,
  } = wireAppCorePierHomeAndSkills({
    appVersion: app.getVersion(),
    isProduction: runtimeMode === "production",
    listInstalledAgents: async () =>
      (await agentDetection.detect()).detectedIds,
    onProjectSkillsInvalidated: broadcastProjectSkillsInvalidated,
    panelContexts,
    processEnvironment,
    resourcesRoot:
      runtimeMode === "development"
        ? join(process.cwd(), "resources")
        : process.resourcesPath,
    transactionLock: filePathTransactionLock,
    userDataPath: app.getPath("userData"),
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
    agentLifecycle,
    agentRuntimeIndex,
    agentUsage,
    agentLaunchGate,
    agentMcpCatalog,
    agentRules,
    ai: createAiService({
      detectAgents: async () => (await agentDetection.detect()).detectedIds,
      readAgentUsage: () => agentUsage.read(),
      readPreferences: () => preferences.read(),
      launchGate: agentLaunchGate,
      processEnvironment,
    }),
    appUpdates: createWiredAppUpdateService(runtimeMode),
    commandPaletteMru: createCommandPaletteMruService({
      broadcast: broadcastMruState,
    }),
    comments,
    fileDrafts,
    files,
    fileWatch: createFileWatchService(),
    preferences,
    projectSkills,
    secrets,
    usageData,
    processEnvironment,
    localEnvironments,
    liveModules: createAppLiveModulesService({
      resolveHomeRoot: () => pierHome.rootPath(),
    }),
    pierHome,
    pierBindings,
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
      resolveProjectEnv: (input) =>
        resolveProjectEnvForSpawn({
          ...input,
          localEnvironments,
        }),
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

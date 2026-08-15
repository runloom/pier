import type { AgentLifecycleProbe } from "@shared/contracts/agent/lifecycle.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import type { AppUpdateSnapshot } from "@shared/contracts/app-update.ts";
import type { ManagedPluginCatalogSnapshot } from "@shared/contracts/plugin/managed.ts";
import type {
  AppUpdateRuntimeMode,
  AppUpdateService,
} from "../services/app-updates/service.ts";
import {
  agentInventoryPath,
  appUpdateLastCheckPath,
  createDomainSnapshotStore,
  managedPluginCatalogPath,
} from "../services/host-catalog/persist.ts";
import { createAgentCliCatalogProvider } from "../services/host-catalog/providers/agent-cli.ts";
import { createManagedPluginCatalogProvider } from "../services/host-catalog/providers/managed-plugin.ts";
import { createPierAppCatalogProvider } from "../services/host-catalog/providers/pier-app.ts";
import type { HostCatalogRuntime } from "../services/host-catalog/service.ts";
import { createHostCatalogRuntime } from "../services/host-catalog/service.ts";
import { createWiredAppUpdateService } from "./update-wiring.ts";
import { broadcastHostCatalogChanged } from "./window-broadcasts.ts";

export function createBootedHostCatalogRuntime(options: {
  detect: () => Promise<{ detectedIds: readonly AgentKind[] }>;
  getAppStatus?: () => AppUpdateSnapshot;
  getEnv: () => Promise<NodeJS.ProcessEnv>;
  listPlugins?: () => Promise<ManagedPluginCatalogSnapshot>;
  probe: (checkLatest: boolean) => Promise<readonly AgentLifecycleProbe[]>;
  refreshPluginIndex?: (force: boolean) => Promise<void>;
  userDataDir: string;
  waitForHostEnv: () => Promise<void>;
  waitPluginsReady?: () => Promise<void>;
}): HostCatalogRuntime {
  const runtime = createHostCatalogRuntime({
    getEnv: options.getEnv,
    onChanged: broadcastHostCatalogChanged,
  });
  runtime.register(
    createAgentCliCatalogProvider({
      detect: options.detect,
      persist: createDomainSnapshotStore(
        agentInventoryPath(options.userDataDir),
        "agent-cli"
      ),
      probe: options.probe,
    })
  );
  if (options.listPlugins && options.refreshPluginIndex) {
    const waitReady = options.waitPluginsReady ?? (async () => undefined);
    runtime.register(
      createManagedPluginCatalogProvider({
        list: options.listPlugins,
        persist: createDomainSnapshotStore(
          managedPluginCatalogPath(options.userDataDir),
          "managed-plugin"
        ),
        refreshOfficial: options.refreshPluginIndex,
        waitReady,
      })
    );
  }
  if (options.getAppStatus) {
    runtime.register(
      createPierAppCatalogProvider({
        getStatus: options.getAppStatus,
        persist: createDomainSnapshotStore(
          appUpdateLastCheckPath(options.userDataDir),
          "pier-app"
        ),
      })
    );
  }
  runtime
    .hydrateFromDisk()
    .catch((err: unknown) => {
      console.error("[host-catalog] hydrateFromDisk failed:", err);
    })
    .then(() => options.waitForHostEnv())
    .then(() => {
      runtime.startScheduler();
    })
    .catch((err: unknown) => {
      console.error("[host-catalog] startScheduler gate failed:", err);
    });
  return runtime;
}

export function wireHostCatalogAndAppUpdates(options: {
  detect: () => Promise<{ detectedIds: readonly AgentKind[] }>;
  getEnv: () => Promise<NodeJS.ProcessEnv>;
  listPlugins: () => Promise<ManagedPluginCatalogSnapshot>;
  probe: (checkLatest: boolean) => Promise<readonly AgentLifecycleProbe[]>;
  refreshPluginIndex: (force: boolean) => Promise<void>;
  runtimeMode: AppUpdateRuntimeMode;
  userDataDir: string;
  waitForHostEnv: () => Promise<void>;
  waitPluginsReady: () => Promise<void>;
}): {
  appUpdates: AppUpdateService;
  hostCatalog: HostCatalogRuntime;
} {
  const pierAppStamp: { runtime: HostCatalogRuntime | null } = {
    runtime: null,
  };
  const appUpdates = createWiredAppUpdateService(options.runtimeMode, {
    stampPierApp: async () => {
      await pierAppStamp.runtime?.ensureFresh("pier-app", {
        class: "local",
        force: true,
      });
    },
  });
  const hostCatalog = createBootedHostCatalogRuntime({
    detect: options.detect,
    getAppStatus: () => appUpdates.getStatus(),
    getEnv: options.getEnv,
    listPlugins: options.listPlugins,
    probe: options.probe,
    refreshPluginIndex: options.refreshPluginIndex,
    userDataDir: options.userDataDir,
    waitForHostEnv: options.waitForHostEnv,
    waitPluginsReady: options.waitPluginsReady,
  });
  pierAppStamp.runtime = hostCatalog;
  return { appUpdates, hostCatalog };
}

import { createLogger } from "@shared/logger.ts";
import type { ManagedPluginIndexStore } from "./index-state.ts";
import type { ManagedPluginDevRuntimeWatchRegistry } from "./install-runtime.ts";
import type { ManagedPluginInstallService } from "./install-service.ts";
import {
  createSeededWorkspaceIndexEntry,
  syncWorkspaceDevPluginOverrides,
  workspacePackageDir,
} from "./workspace-dev-plugins.ts";

interface WorkspaceBootHost {
  managedPluginDevRuntimeWatches: ManagedPluginDevRuntimeWatchRegistry;
  managedPluginIndexStore: ManagedPluginIndexStore;
  managedPlugins: ManagedPluginInstallService;
  officialBundledPluginIds: readonly string[];
}

/**
 * Workspace mode boot: sync dev overrides + start file watches for
 * first-party and custom workspace plugin packages.
 */
export async function bootWorkspacePluginMode(
  specs: readonly { devPackageDir: string; id: string }[],
  host: WorkspaceBootHost
): Promise<void> {
  const logger = createLogger("managed-plugins");
  logger.info("[managed-plugins] plugin mode: workspace");
  await syncWorkspaceDevPluginOverrides({
    applyEffective: () => host.managedPlugins.simulateRestartForTests(),
    cwd: process.cwd(),
    ensureInstalled: async (id) => {
      if (host.officialBundledPluginIds.includes(id)) {
        return host.managedPlugins.install(id);
      }
      return {
        error: {
          code: "not_found" as const,
          message: `no bundled package for custom plugin ${id}`,
        },
        ok: false as const,
      };
    },
    seedWorkspaceEntry: async (id, version) => {
      host.managedPluginIndexStore.mutate((state) => ({
        ...state,
        plugins: {
          ...state.plugins,
          [id]: createSeededWorkspaceIndexEntry(id, version, Date.now()),
        },
      }));
      await host.managedPluginIndexStore.flush();
    },
    getIndex: () => host.managedPlugins.getIndex(),
    logger: {
      error: (message, meta) => {
        if (meta === undefined) {
          logger.error(message);
          return;
        }
        logger.error(
          message,
          typeof meta === "object" && meta !== null
            ? (meta as Record<string, unknown>)
            : { detail: meta }
        );
      },
      info: (message) => logger.info(message),
    },
    setDevOverride: (id, path) => host.managedPlugins.setDevOverride(id, path),
    specs,
  });
  for (const spec of specs) {
    const packageDir = workspacePackageDir(process.cwd(), spec);
    host.managedPluginDevRuntimeWatches.ensure(spec.id, {
      logger,
      packageDir,
      refreshRuntimeSources: () => host.managedPlugins.refreshRuntimeSources(),
    });
  }
}

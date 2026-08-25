import type { RendererLiveModulesApi } from "@plugins/api/live-modules-context.ts";
import type { PierCapability } from "@shared/contracts/permissions.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";

function assertPluginCapability(
  entry: PluginRegistryEntry | undefined,
  capability: PierCapability
): void {
  if (!entry || entry.effectivePermissions.includes(capability)) {
    return;
  }
  throw new Error(
    `plugin capability not granted: ${entry.manifest.id}:${capability}`
  );
}

/** Build the plugin-facing Live Modules façade (capability-gated). */
export function createHostLiveModulesApi(
  entry: PluginRegistryEntry | undefined
): RendererLiveModulesApi {
  return {
    compile: (rootId, relPath) => {
      assertPluginCapability(entry, "file:read");
      return window.pier.liveModules.compile(rootId, relPath);
    },
    getUrl: (rootId, moduleId) => {
      assertPluginCapability(entry, "file:read");
      return window.pier.liveModules.getUrl(rootId, moduleId);
    },
    onChanged: (cb) => {
      assertPluginCapability(entry, "file:read");
      return window.pier.liveModules.onChanged(cb);
    },
    registerRoot: (spec) => {
      assertPluginCapability(entry, "file:write");
      return window.pier.liveModules.registerRoot(spec);
    },
    unregisterRoot: (rootId) => {
      assertPluginCapability(entry, "file:write");
      return window.pier.liveModules.unregisterRoot(rootId);
    },
    trustStatus: (projectRootPath) => {
      assertPluginCapability(entry, "preferences:read");
      return window.pier.liveModules.trustStatus(projectRootPath);
    },
    grantTrust: (projectRootPath) => {
      assertPluginCapability(entry, "preferences:write");
      return window.pier.liveModules.grantTrust(projectRootPath);
    },
    revokeTrust: (projectRootPath) => {
      assertPluginCapability(entry, "preferences:write");
      return window.pier.liveModules.revokeTrust(projectRootPath);
    },
  };
}

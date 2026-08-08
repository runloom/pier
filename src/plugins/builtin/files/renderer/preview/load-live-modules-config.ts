/**
 * Files-panel entry for Live Modules project config.
 * Implementation lives under renderer/lib (shared with Project → General).
 */
export {
  applyLiveModulesProjectConfigAfterSave,
  applyLiveModulesProjectConfigFromDiskContents,
  ensureLiveModulesProjectConfigLoaded,
  invalidateLiveModulesProjectConfigCache,
  notifyLiveModulesProjectConfigChanged,
  resetLiveModulesProjectConfigCacheForTests,
  subscribeLiveModulesProjectConfigChanged,
} from "@/lib/live-modules/project-config-cache.ts";

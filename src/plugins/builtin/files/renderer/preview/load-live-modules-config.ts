/**
 * Files-panel entry for Live Modules project config.
 * Implementation lives under plugins/api (shared with Project → General;
 * plugins must not import src/renderer host modules).
 */
export {
  applyLiveModulesProjectConfigAfterSave,
  applyLiveModulesProjectConfigFromDiskContents,
  ensureLiveModulesProjectConfigLoaded,
  invalidateLiveModulesProjectConfigCache,
  notifyLiveModulesProjectConfigChanged,
  resetLiveModulesProjectConfigCacheForTests,
  subscribeLiveModulesProjectConfigChanged,
} from "@plugins/api/live-modules-project-config-cache.ts";

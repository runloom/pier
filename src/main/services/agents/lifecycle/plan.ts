/**
 * Re-export planner surface. Implementation lives in plan/*.
 */
export {
  brewPackageTokenFromBinPath,
  buildGuideCommands,
  buildInstallCommand,
  buildInstallPlan,
  buildUninstallCommand,
  buildUninstallPlan,
  buildUpdateCommand,
  buildUpdatePlan,
  planLifecycle,
  planLifecycleCommand,
} from "./plan/build.ts";
export { filterUninstallChannels } from "./plan/source-policy.ts";
export type { PlannedInvocation, PlannedPlan } from "./plan/types.ts";
export { previewInvocation, previewPlan } from "./plan/types.ts";
export type {
  UninstallProbeDefaultInstall,
  UninstallProbeFields,
} from "./plan/uninstall.ts";
export {
  deriveUninstallChannels,
  resolveUninstallProbeFields,
} from "./plan/uninstall.ts";

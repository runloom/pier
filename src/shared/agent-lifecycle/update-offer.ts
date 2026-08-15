import type { AgentLifecycleProbe } from "@shared/contracts/agent/lifecycle.ts";

type UpdateOfferProbe = Pick<
  AgentLifecycleProbe,
  | "canInstall"
  | "detected"
  | "installedButBroken"
  | "support"
  | "updateAvailable"
>;

/**
 * Pending update (versioned newer or broken repair).
 * Reinstall-only installs are not pending updates.
 */
export function isAgentUpdateOffered(
  probe: UpdateOfferProbe | undefined
): boolean {
  if (!(probe && probe.support === "full" && probe.canInstall)) {
    return false;
  }
  if (probe.installedButBroken === true) {
    return true;
  }
  return probe.detected === true && probe.updateAvailable === true;
}

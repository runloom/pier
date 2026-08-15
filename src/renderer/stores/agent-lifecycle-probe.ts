import { isAgentUpdateAvailable } from "@shared/agent-lifecycle/version-compare.ts";
import type { AgentLifecycleProbe } from "@shared/contracts/agent/lifecycle.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";

export function hasCachedProbes(
  probesById: Partial<Record<AgentKind, AgentLifecycleProbe>>
): boolean {
  for (const probe of Object.values(probesById)) {
    if (probe) {
      return true;
    }
  }
  return false;
}

/**
 * Derive offer/available flags from a probe + optional retained latest.
 * Always recompute — never OR-sticky previous updateOffered (that inflated
 * "Update all (N)" across refreshes without re-check).
 */
export function withDerivedUpdateFlags(
  probe: AgentLifecycleProbe,
  latestVersion: string | null | undefined
): AgentLifecycleProbe {
  const latest =
    latestVersion === undefined || latestVersion === null
      ? null
      : latestVersion;
  const updateAvailable =
    probe.updateMode === "versioned" &&
    latest !== null &&
    isAgentUpdateAvailable(probe.version, latest);
  const updateOffered =
    probe.canInstall &&
    (probe.installedButBroken ||
      (probe.detected &&
        (probe.updateMode === "reinstall" || updateAvailable)));
  return {
    ...probe,
    latestVersion: latest,
    updateAvailable,
    updateOffered,
  };
}

/**
 * Merge probe results. When the new probe skipped latest fetch (checkLatest
 * false), keep the last known latestVersion but **recompute** availability
 * against the newly detected install version — never freeze updateAvailable.
 */
export function mergeProbes(
  prev: Partial<Record<AgentKind, AgentLifecycleProbe>>,
  next: AgentLifecycleProbe[]
): Partial<Record<AgentKind, AgentLifecycleProbe>> {
  const out = { ...prev };
  for (const probe of next) {
    const previous = out[probe.agentId];
    const hasFreshLatest =
      probe.latestVersion !== null && probe.latestVersion !== undefined;
    if (hasFreshLatest) {
      // Main already computed flags for this latest; trust the probe.
      out[probe.agentId] = probe;
      continue;
    }
    // No latest on this response: retain previous latest if any, re-derive flags.
    const retainedLatest = previous?.latestVersion ?? null;
    out[probe.agentId] = withDerivedUpdateFlags(probe, retainedLatest);
  }
  return out;
}

/**
 * Batch / "Update all" eligibility.
 * Prefer real versioned updates + broken installs — not reinstall-mode
 * always-on offers (cursor/hermes/kiro) which inflated the toolbar count.
 * Per-row Update still uses `probe.updateOffered` (includes reinstall).
 */
export function isLifecycleUpdateCandidate(
  probe: AgentLifecycleProbe | undefined,
  options?: { disabled?: boolean }
): boolean {
  if (options?.disabled === true) {
    return false;
  }
  if (!(probe && probe.support === "full" && probe.canInstall)) {
    return false;
  }
  return probe.updateAvailable === true || probe.installedButBroken === true;
}

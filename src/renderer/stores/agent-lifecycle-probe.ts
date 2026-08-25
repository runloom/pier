import { isAgentUpdateOffered } from "@shared/agent-lifecycle/update-offer.ts";
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
 * Always recompute — never OR-sticky previous updateOffered.
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
  const next = {
    ...probe,
    latestVersion: latest,
    updateAvailable,
  };
  return {
    ...next,
    updateOffered: isAgentUpdateOffered(next),
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
 * Toolbar count, row Update, and Update all.
 * Disabled is a preference — not part of probe.updateOffered.
 */
export function isLifecycleUpdateCandidate(
  probe: AgentLifecycleProbe | undefined,
  options?: { disabled?: boolean }
): boolean {
  if (options?.disabled === true) {
    return false;
  }
  return isAgentUpdateOffered(probe);
}

export function listLifecycleUpdateCandidates(
  probesById: Partial<Record<AgentKind, AgentLifecycleProbe>>,
  disabledAgentIds: readonly string[] = []
): AgentKind[] {
  const disabled = new Set(disabledAgentIds);
  const out: AgentKind[] = [];
  for (const probe of Object.values(probesById)) {
    if (
      probe &&
      isLifecycleUpdateCandidate(probe, {
        disabled: disabled.has(probe.agentId),
      })
    ) {
      out.push(probe.agentId);
    }
  }
  return out;
}

export function countLifecycleUpdateCandidates(
  probesById: Partial<Record<AgentKind, AgentLifecycleProbe>>,
  disabledAgentIds: readonly string[] = []
): number {
  return listLifecycleUpdateCandidates(probesById, disabledAgentIds).length;
}

/**
 * Details-only force-refresh: script-only reinstall, or versioned agents
 * whose latest is probe-only (`canForceReinstall`). Never overlaps Update all.
 */
export function isLifecycleReinstallCandidate(
  probe: AgentLifecycleProbe | undefined,
  options?: { disabled?: boolean }
): boolean {
  if (options?.disabled === true) {
    return false;
  }
  if (!(probe && probe.support === "full" && probe.canInstall)) {
    return false;
  }
  if (isLifecycleUpdateCandidate(probe, options)) {
    return false;
  }
  if (probe.detected !== true) {
    return false;
  }
  return probe.updateMode === "reinstall" || probe.canForceReinstall === true;
}

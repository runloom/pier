import { isAgentUpdateAvailable } from "@shared/agent-lifecycle/version-compare.ts";
import type { AgentLifecycleProbe } from "@shared/contracts/agent/lifecycle.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";

/** Local install/version probe freshness for full-catalog probes. */
export const AGENT_LIFECYCLE_PROBE_TTL_MS = 10 * 60 * 1000;
/**
 * Remote "check latest" freshness. Settings open respects this so re-entering
 * the agents page does not re-hit npm/brew/network every time.
 * Manual refresh uses force and bypasses both TTLs.
 */
export const AGENT_LIFECYCLE_CHECK_LATEST_TTL_MS = 10 * 60 * 1000;

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

/** Non-empty agentIds list → targeted probe (mirrors main `probeAgents`). */
export function isTargetedAgentIds(
  agentIds: readonly AgentKind[] | undefined
): boolean {
  return Array.isArray(agentIds) && agentIds.length > 0;
}

/**
 * Whether a full-catalog probe can be skipped (settings re-open path).
 * Targeted agentIds and force always run. checkLatest needs both local and
 * latest timestamps fresh — it no longer bypasses TTL by itself.
 * Empty `agentIds: []` is not targeted (same as full catalog).
 */
export function shouldSkipFullCatalogProbe(options: {
  force?: boolean;
  checkLatest?: boolean;
  agentIds?: readonly AgentKind[];
  lastProbeAt: number | null;
  lastCheckLatestAt: number | null;
  probesById: Partial<Record<AgentKind, AgentLifecycleProbe>>;
  now?: number;
}): boolean {
  if (options.force === true || isTargetedAgentIds(options.agentIds)) {
    return false;
  }
  if (!hasCachedProbes(options.probesById)) {
    return false;
  }
  const now = options.now ?? Date.now();
  const localFresh =
    options.lastProbeAt !== null &&
    now - options.lastProbeAt < AGENT_LIFECYCLE_PROBE_TTL_MS;
  if (!localFresh) {
    return false;
  }
  if (options.checkLatest !== true) {
    return true;
  }
  return (
    options.lastCheckLatestAt !== null &&
    now - options.lastCheckLatestAt < AGENT_LIFECYCLE_CHECK_LATEST_TTL_MS
  );
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

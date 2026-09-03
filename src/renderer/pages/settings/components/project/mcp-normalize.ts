import {
  type McpAgentEffectCell,
  type McpEnabledRollup,
  type McpGap,
  type McpOwnership,
  type McpServerListing,
  type McpServerView,
  type McpTransport,
  type McpTransportRollup,
  PIER_MANAGED_MCP_SERVER_NAME,
} from "@shared/contracts/agent/assets.ts";

const OWNERSHIP_ORDER: Record<McpOwnership, number> = {
  "pier-managed": 0,
  project: 1,
  user: 2,
};

function isScope(value: unknown): value is McpServerListing["scopeLabel"] {
  return value === "project" || value === "user";
}

function isTransport(value: unknown): value is McpTransport {
  return value === "stdio" || value === "http" || value === "unknown";
}

function isOwnership(value: unknown): value is McpOwnership {
  return value === "pier-managed" || value === "project" || value === "user";
}

function isEnabledRollup(value: unknown): value is McpEnabledRollup {
  return value === "on" || value === "off" || value === "mixed";
}

function isTransportRollup(value: unknown): value is McpTransportRollup {
  return (
    value === "stdio" ||
    value === "http" ||
    value === "unknown" ||
    value === "mixed"
  );
}

function fallbackOwnership(
  name: string,
  listings: readonly McpServerListing[]
): McpOwnership {
  if (name === PIER_MANAGED_MCP_SERVER_NAME) return "pier-managed";
  if (listings.some((listing) => listing.scopeLabel === "project")) {
    return "project";
  }
  return "user";
}

function fallbackTransport(
  listings: readonly McpServerListing[]
): McpTransportRollup {
  const known = new Set(
    listings
      .map((listing) => listing.transport)
      .filter((item) => item !== "unknown")
  );
  if (known.size === 0) return "unknown";
  if (known.size === 1) return [...known][0] as McpTransport;
  return "mixed";
}

function fallbackEnabled(
  listings: readonly McpServerListing[]
): McpEnabledRollup {
  const flags = new Set(listings.map((listing) => listing.enabled));
  if (flags.size === 1) return listings[0]?.enabled ? "on" : "off";
  return "mixed";
}

export function compareMcpServerViews(
  a: McpServerView,
  b: McpServerView
): number {
  const ownership = OWNERSHIP_ORDER[a.ownership] - OWNERSHIP_ORDER[b.ownership];
  if (ownership !== 0) return ownership;
  return a.name.localeCompare(b.name);
}

export function normalizeServers(value: unknown): McpServerView[] {
  if (!Array.isArray(value)) return [];
  const out: McpServerView[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const name = typeof rec.name === "string" ? rec.name : "";
    const listingsRaw = Array.isArray(rec.listings) ? rec.listings : [];
    if (!name || listingsRaw.length === 0) continue;
    const listings: McpServerListing[] = [];
    for (const item of listingsRaw) {
      if (!item || typeof item !== "object") continue;
      const listing = item as Partial<McpServerListing>;
      if (
        typeof listing.absolutePath !== "string" ||
        typeof listing.agentId !== "string" ||
        typeof listing.agentLabel !== "string" ||
        typeof listing.displayPath !== "string" ||
        typeof listing.entryId !== "string" ||
        !isScope(listing.scopeLabel)
      ) {
        continue;
      }
      listings.push({
        absolutePath: listing.absolutePath,
        agentId: listing.agentId,
        agentLabel: listing.agentLabel,
        displayPath: listing.displayPath,
        enabled: listing.enabled !== false,
        entryId: listing.entryId,
        scopeLabel: listing.scopeLabel,
        transport: isTransport(listing.transport)
          ? listing.transport
          : "unknown",
      });
    }
    if (listings.length === 0) continue;
    const effectsRaw = Array.isArray(rec.effects) ? rec.effects : [];
    const effects: McpAgentEffectCell[] = [];
    for (const item of effectsRaw) {
      if (!item || typeof item !== "object") continue;
      const cell = item as Partial<McpAgentEffectCell>;
      if (typeof cell.agentKind !== "string" || !cell.effect) continue;
      if (cell.effect.state === "discoverable") {
        if (typeof cell.effect.viaRoot !== "string") continue;
        effects.push({
          agentKind: cell.agentKind,
          effect: { state: "discoverable", viaRoot: cell.effect.viaRoot },
        });
      } else if (cell.effect.state === "agent-not-installed") {
        effects.push({
          agentKind: cell.agentKind,
          effect: { state: "agent-not-installed" },
        });
      }
    }
    const resolvedEffects =
      effects.length > 0
        ? effects
        : listings.map((listing) => ({
            agentKind: listing.agentId,
            effect: {
              state: "discoverable" as const,
              viaRoot: listing.displayPath,
            },
          }));
    const gapsRaw = Array.isArray(rec.gaps) ? rec.gaps : [];
    const gaps: McpGap[] = [];
    for (const item of gapsRaw) {
      if (!item || typeof item !== "object") continue;
      const gap = item as Partial<McpGap>;
      if (typeof gap.agentKind !== "string" || gap.agentKind.length === 0) {
        continue;
      }
      gaps.push({ agentKind: gap.agentKind });
    }
    const ownership = isOwnership(rec.ownership)
      ? rec.ownership
      : fallbackOwnership(name, listings);
    const transport = isTransportRollup(rec.transport)
      ? rec.transport
      : fallbackTransport(listings);
    const enabled = isEnabledRollup(rec.enabled)
      ? rec.enabled
      : fallbackEnabled(listings);
    out.push({
      enabled,
      effects: resolvedEffects,
      gaps,
      listings,
      name,
      ownership,
      transport,
    });
  }
  return out.sort(compareMcpServerViews);
}

import {
  type McpEnabledRollup,
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

export function ownershipFor(
  name: string,
  listings: readonly McpServerListing[]
): McpOwnership {
  if (name === PIER_MANAGED_MCP_SERVER_NAME) return "pier-managed";
  if (listings.some((listing) => listing.scopeLabel === "project")) {
    return "project";
  }
  return "user";
}

export function rollupTransport(
  listings: readonly McpServerListing[]
): McpTransportRollup {
  const known = new Set<McpTransport>();
  for (const listing of listings) {
    if (listing.transport !== "unknown") known.add(listing.transport);
  }
  if (known.size === 0) return "unknown";
  if (known.size === 1) {
    return [...known][0] as McpTransport;
  }
  return "mixed";
}

export function rollupEnabled(
  listings: readonly McpServerListing[]
): McpEnabledRollup {
  const flags = new Set(listings.map((listing) => listing.enabled));
  if (flags.size === 1) return listings[0]?.enabled ? "on" : "off";
  return "mixed";
}

export function deriveGaps(
  listings: readonly McpServerListing[],
  installedConsumers: readonly string[]
): McpServerView["gaps"] {
  const declared = new Set(listings.map((listing) => listing.agentId));
  return installedConsumers
    .filter((agentKind) => !declared.has(agentKind))
    .map((agentKind) => ({ agentKind }))
    .sort((a, b) => a.agentKind.localeCompare(b.agentKind));
}

export function compareServerViews(a: McpServerView, b: McpServerView): number {
  const ownership = OWNERSHIP_ORDER[a.ownership] - OWNERSHIP_ORDER[b.ownership];
  if (ownership !== 0) return ownership;
  return a.name.localeCompare(b.name);
}

export function toServerView(
  name: string,
  listings: readonly McpServerListing[],
  effects: McpServerView["effects"],
  installedConsumers: readonly string[]
): McpServerView {
  return {
    enabled: rollupEnabled(listings),
    effects,
    gaps: deriveGaps(listings, installedConsumers),
    listings: [...listings],
    name,
    ownership: ownershipFor(name, listings),
    transport: rollupTransport(listings),
  };
}

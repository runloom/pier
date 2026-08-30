import { homedir } from "node:os";
import { getAgentCatalogEntry } from "@shared/agent-catalog.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import {
  type McpConfigLocation,
  type McpDiscoveryAdapter,
  resolveMcpUserConfigPath,
} from "./adapter-facts.ts";
import { MCP_CORE_ADAPTERS } from "./adapter-facts-core.ts";
import { MCP_EXTENDED_ADAPTERS } from "./adapter-facts-extended.ts";
import { MCP_NONE_ADAPTERS } from "./adapter-facts-none.ts";
import type { McpConfigFormat } from "./parse-server-names.ts";

export type {
  McpConfigLocation,
  McpDiscoveryAdapter,
} from "./adapter-facts.ts";
export { resolveMcpUserConfigPath } from "./adapter-facts.ts";

/**
 * MCP discovery adapter fact table (skills `adapter-facts.ts` parallel).
 * Every AgentKind is consuming or explicit non-support.
 */
export const MCP_DISCOVERY_ADAPTERS: readonly McpDiscoveryAdapter[] = [
  ...MCP_CORE_ADAPTERS,
  ...MCP_EXTENDED_ADAPTERS,
  ...MCP_NONE_ADAPTERS,
];

/**
 * Derived unique on-disk probe (one entry per absolute location). Consumers
 * are every adapter that declared the same scope+path.
 */
export interface McpPathCandidate {
  consumerAgentIds: readonly AgentKind[];
  format: McpConfigFormat;
  id: string;
  officialDocsUrl?: string;
  projectRelativePath?: string;
  scopeLabel: "project" | "user";
  userAbsolutePath?: (home?: string, env?: NodeJS.ProcessEnv) => string;
}

function normalizeHomeRelative(path: string): string {
  return path.replace(/^~\//, "").replace(/^\//, "");
}

function pathKey(loc: McpConfigLocation): string {
  if (loc.scope === "project") {
    return `project:${loc.path}`;
  }
  return `user:${normalizeHomeRelative(loc.path)}`;
}

function agentLabel(agentId: string): string {
  return getAgentCatalogEntry(agentId as AgentKind)?.label ?? agentId;
}

/**
 * Flatten agent-centric adapters → unique path probes + consumer lists.
 * Adding an agent never requires editing path rows — only `adapter-facts.ts`.
 */
export function deriveMcpPathCandidates(
  adapters: readonly McpDiscoveryAdapter[] = MCP_DISCOVERY_ADAPTERS
): readonly McpPathCandidate[] {
  interface Acc {
    consumerAgentIds: AgentKind[];
    format: McpConfigFormat;
    id: string;
    officialDocsUrl?: string;
    projectRelativePath?: string;
    scopeLabel: "project" | "user";
    userLoc?: McpConfigLocation;
  }
  const byKey = new Map<string, Acc>();

  for (const adapter of adapters) {
    if (!adapter.consumesMcp) continue;
    const locations = [...adapter.projectConfigs, ...adapter.userConfigs];
    for (const loc of locations) {
      const key = pathKey(loc);
      const existing = byKey.get(key);
      if (existing) {
        if (!existing.consumerAgentIds.includes(adapter.agentKind)) {
          existing.consumerAgentIds.push(adapter.agentKind);
        }
        continue;
      }
      byKey.set(key, {
        id: key.replaceAll("/", "__").replaceAll(":", "-"),
        scopeLabel: loc.scope,
        format: loc.format,
        consumerAgentIds: [adapter.agentKind],
        officialDocsUrl: adapter.officialDocsUrl,
        ...(loc.scope === "project"
          ? { projectRelativePath: loc.path }
          : { userLoc: loc }),
      });
    }
  }

  return [...byKey.values()]
    .map((row) => {
      const consumerAgentIds = [...row.consumerAgentIds].sort((a, b) =>
        a.localeCompare(b)
      ) as AgentKind[];
      return {
        id: row.id,
        scopeLabel: row.scopeLabel,
        format: row.format,
        consumerAgentIds,
        ...(row.officialDocsUrl
          ? { officialDocsUrl: row.officialDocsUrl }
          : {}),
        ...(row.projectRelativePath
          ? { projectRelativePath: row.projectRelativePath }
          : {}),
        ...(row.userLoc
          ? {
              userAbsolutePath: (
                home: string = homedir(),
                env: NodeJS.ProcessEnv = process.env
              ) =>
                resolveMcpUserConfigPath(
                  row.userLoc as McpConfigLocation,
                  home,
                  env
                ),
            }
          : {}),
      } satisfies McpPathCandidate;
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Stable derived probe table for the catalog service. */
export const MCP_PATH_CANDIDATES: readonly McpPathCandidate[] =
  deriveMcpPathCandidates();

export function pathCandidateById(
  entryId: string
): McpPathCandidate | undefined {
  return MCP_PATH_CANDIDATES.find((c) => c.id === entryId);
}

export function consumersForPath(entryId: string): readonly string[] {
  return pathCandidateById(entryId)?.consumerAgentIds ?? [];
}

export function labelForAgent(agentId: string): string {
  return agentLabel(agentId);
}

export function displayPathForCandidate(
  candidate: Pick<
    McpPathCandidate,
    "scopeLabel" | "projectRelativePath" | "userAbsolutePath" | "id"
  >,
  _projectRootPath: string | null
): string {
  if (candidate.scopeLabel === "project" && candidate.projectRelativePath) {
    return candidate.projectRelativePath;
  }
  if (candidate.userAbsolutePath) {
    return candidate.userAbsolutePath();
  }
  return candidate.id;
}

export function createMcpDiscoveryAdapterRegistry(
  adapters: readonly McpDiscoveryAdapter[] = MCP_DISCOVERY_ADAPTERS
) {
  const byKind = new Map(
    adapters.map((adapter) => [adapter.agentKind, adapter] as const)
  );
  return {
    get(agentKind: AgentKind): McpDiscoveryAdapter | undefined {
      return byKind.get(agentKind);
    },
    isApplicable(agentKind: AgentKind): boolean {
      return byKind.get(agentKind)?.consumesMcp === true;
    },
    list(): readonly McpDiscoveryAdapter[] {
      return adapters;
    },
  };
}

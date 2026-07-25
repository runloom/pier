import type { AgentKind } from "@shared/contracts/agent.ts";
import type { McpConfigFormat } from "./parse-server-names.ts";

/**
 * One MCP config location an agent recognizes (skills `discoveryRoots` /
 * `userDiscoveryRoots` parallel). Project paths are repo-relative; user
 * paths are `~`-relative (resolved under `homedir()`).
 */
export interface McpConfigLocation {
  format: McpConfigFormat;
  /** Project-relative (`scope=project`) or `~`-relative (`scope=user`). */
  path: string;
  scope: "project" | "user";
}

/**
 * MCP discovery adapter — **one row per AgentKind**, same shape as skills
 * `SkillDiscoveryAdapter`. Adding a new agent = append a row here with the
 * paths that agent officially scans; availability is derived from these
 * locations (server name present + agent installed).
 */
export interface McpDiscoveryAdapter {
  agentKind: AgentKind;
  /**
   * When false, audit-only (no catalog participation). v1 adapters are all
   * `true` once registered.
   */
  consumesMcp: boolean;
  officialDocsUrl: string;
  /** Project-scoped MCP config files this agent reads. */
  projectConfigs: readonly McpConfigLocation[];
  /** User-scoped (`~`) MCP config files this agent reads. Pier never writes. */
  userConfigs: readonly McpConfigLocation[];
  verifiedOn: string;
}

function project(
  path: string,
  format: McpConfigFormat = "json-mcp-servers"
): McpConfigLocation {
  return { format, path, scope: "project" };
}

function user(
  path: string,
  format: McpConfigFormat = "json-mcp-servers"
): McpConfigLocation {
  return { format, path, scope: "user" };
}

/**
 * MCP discovery adapter fact table (skills `adapter-facts.ts` parallel).
 *
 * Only agents listed here participate in MCP availability. Shared paths
 * (e.g. `.mcp.json` for Claude + OMP) are declared on each consumer — the
 * registry derives unique probes and multi-agent effects.
 */
export const MCP_DISCOVERY_ADAPTERS: readonly McpDiscoveryAdapter[] = [
  {
    agentKind: "claude",
    consumesMcp: true,
    projectConfigs: [project(".mcp.json")],
    userConfigs: [user(".claude.json", "claude-user-json")],
    officialDocsUrl: "https://code.claude.com/docs/en/mcp",
    verifiedOn: "2026-07-24",
  },
  {
    agentKind: "cursor",
    consumesMcp: true,
    projectConfigs: [project(".cursor/mcp.json")],
    userConfigs: [user(".cursor/mcp.json")],
    officialDocsUrl: "https://cursor.com/docs/context/mcp",
    verifiedOn: "2026-07-24",
  },
  {
    agentKind: "codex",
    consumesMcp: true,
    projectConfigs: [project(".codex/config.toml", "codex-toml")],
    userConfigs: [user(".codex/config.toml", "codex-toml")],
    officialDocsUrl: "https://developers.openai.com/codex/mcp",
    verifiedOn: "2026-07-24",
  },
  {
    agentKind: "opencode",
    consumesMcp: true,
    // OpenCode native config uses `mcp` (not project `.mcp.json`).
    projectConfigs: [project("opencode.json", "opencode-json")],
    userConfigs: [user(".config/opencode/opencode.json", "opencode-json")],
    officialDocsUrl: "https://opencode.ai/docs/mcp-servers",
    verifiedOn: "2026-07-24",
  },
  {
    agentKind: "gemini",
    consumesMcp: true,
    projectConfigs: [project(".gemini/settings.json")],
    userConfigs: [user(".gemini/settings.json")],
    officialDocsUrl: "https://geminicli.com/docs/tools/mcp-server/",
    verifiedOn: "2026-07-24",
  },
  {
    agentKind: "omp",
    consumesMcp: true,
    // OMP native + documented cross-tool discovery (omp.sh/docs/mcp).
    projectConfigs: [
      project(".omp/mcp.json"),
      project(".mcp.json"),
      project("mcp.json"),
      project(".cursor/mcp.json"),
      project("opencode.json", "opencode-json"),
    ],
    userConfigs: [
      user(".omp/agent/mcp.json"),
      user(".cursor/mcp.json"),
      user(".config/opencode/opencode.json", "opencode-json"),
    ],
    officialDocsUrl: "https://omp.sh/docs/mcp",
    verifiedOn: "2026-07-24",
  },
];

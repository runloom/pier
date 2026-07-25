/**
 * MCP path probes are **derived** from agent-centric adapter facts
 * (`adapter-facts.ts` via `adapters.ts`). Do not add path→consumer rows here —
 * append an agent row in `adapter-facts.ts` instead (skills pattern).
 */
export {
  consumersForPath,
  createMcpDiscoveryAdapterRegistry,
  deriveMcpPathCandidates,
  displayPathForCandidate,
  labelForAgent,
  MCP_DISCOVERY_ADAPTERS,
  MCP_PATH_CANDIDATES,
  type McpConfigLocation,
  type McpDiscoveryAdapter,
  type McpPathCandidate,
  pathCandidateById,
} from "./adapters.ts";

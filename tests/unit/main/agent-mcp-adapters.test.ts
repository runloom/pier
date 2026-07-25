import {
  deriveMcpPathCandidates,
  MCP_DISCOVERY_ADAPTERS,
  MCP_PATH_CANDIDATES,
} from "@main/services/agent-mcp-catalog/adapters.ts";
import { describe, expect, it } from "vitest";

describe("MCP discovery adapters", () => {
  it("is agent-centric: every adapter declares its own config locations", () => {
    for (const adapter of MCP_DISCOVERY_ADAPTERS) {
      expect(adapter.consumesMcp).toBe(true);
      expect(
        adapter.projectConfigs.length + adapter.userConfigs.length
      ).toBeGreaterThan(0);
    }
  });

  it("derives shared-path consumers (e.g. .mcp.json → claude + omp)", () => {
    const paths = deriveMcpPathCandidates();
    const dotMcp = paths.find((p) => p.projectRelativePath === ".mcp.json");
    expect(dotMcp?.consumerAgentIds).toEqual(["claude", "omp"]);
    const cursor = paths.find(
      (p) => p.projectRelativePath === ".cursor/mcp.json"
    );
    expect(cursor?.consumerAgentIds).toEqual(["cursor", "omp"]);
  });

  it("does not attribute .mcp.json to OpenCode (opencode.json only)", () => {
    const paths = deriveMcpPathCandidates();
    const dotMcp = paths.find((p) => p.projectRelativePath === ".mcp.json");
    expect(dotMcp?.consumerAgentIds.includes("opencode")).toBe(false);
    const opencode = paths.find(
      (p) => p.projectRelativePath === "opencode.json"
    );
    expect(opencode?.consumerAgentIds).toEqual(["omp", "opencode"]);
  });

  it("exposes a stable derived probe table", () => {
    expect(MCP_PATH_CANDIDATES.length).toBeGreaterThan(5);
    expect(new Set(MCP_PATH_CANDIDATES.map((p) => p.id)).size).toBe(
      MCP_PATH_CANDIDATES.length
    );
  });
});

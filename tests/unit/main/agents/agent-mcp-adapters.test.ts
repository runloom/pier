import {
  memoryFormatFor,
  memoryGlobalTargets,
} from "@main/services/agent-managed-assets/memory-targets.ts";
import {
  deriveMcpPathCandidates,
  MCP_DISCOVERY_ADAPTERS,
  MCP_PATH_CANDIDATES,
  resolveMcpUserConfigPath,
} from "@main/services/agent-mcp-catalog/adapters.ts";
import { agentKindSchema } from "@shared/contracts/agent.ts";
import { describe, expect, it } from "vitest";

describe("MCP discovery adapters", () => {
  it("covers every AgentKind as consuming or explicit non-support", () => {
    const registered = MCP_DISCOVERY_ADAPTERS.map(
      (adapter) => adapter.agentKind
    );
    expect([...registered].sort()).toEqual([...agentKindSchema.options].sort());
    expect(new Set(registered).size).toBe(registered.length);
  });

  it("gives consuming adapters a native user config; others have none", () => {
    for (const adapter of MCP_DISCOVERY_ADAPTERS) {
      if (adapter.consumesMcp) {
        expect(
          adapter.userConfigs.length,
          `${adapter.agentKind} consuming MCP must declare a user write path`
        ).toBeGreaterThan(0);
      } else {
        expect(adapter.projectConfigs).toEqual([]);
        expect(adapter.userConfigs).toEqual([]);
      }
    }
  });

  it("resolves user probes with homeEnv the same way memory writes do", () => {
    const grok = MCP_DISCOVERY_ADAPTERS.find(
      (adapter) => adapter.agentKind === "grok"
    )?.userConfigs[0];
    expect(grok).toBeTruthy();
    if (!grok) {
      return;
    }
    const env = { GROK_HOME: "~/alt-grok", XDG_CONFIG_HOME: "/xdg" };
    const home = "/home/u";
    const catalogAbs = resolveMcpUserConfigPath(grok, home, env);
    expect(catalogAbs).toBe("/home/u/alt-grok/config.toml");
    expect(
      memoryGlobalTargets({ env, home }).find((target) =>
        target.consumers.includes("grok")
      )?.abs
    ).toBe(catalogAbs);
    const grokPath = deriveMcpPathCandidates().find(
      (path) =>
        path.consumerAgentIds.includes("grok") && path.scopeLabel === "user"
    );
    expect(grokPath?.userAbsolutePath?.(home, env)).toBe(catalogAbs);
    const goose = MCP_DISCOVERY_ADAPTERS.find(
      (adapter) => adapter.agentKind === "goose"
    )?.userConfigs[0];
    expect(goose).toBeTruthy();
    if (!goose) {
      return;
    }
    expect(resolveMcpUserConfigPath(goose, home, env)).toBe(
      "/xdg/goose/config.yaml"
    );
  });

  it("includes grok as a consuming TOML client", () => {
    const grok = MCP_DISCOVERY_ADAPTERS.find(
      (adapter) => adapter.agentKind === "grok"
    );
    expect(grok?.consumesMcp).toBe(true);
    expect(grok?.userConfigs[0]?.path).toBe(".grok/config.toml");
    expect(grok?.userConfigs[0]?.format).toBe("codex-toml");
    expect(grok?.userConfigs[0]?.homeEnv).toBe("GROK_HOME");
  });

  it("keeps known MCP clients consuming (never parked in none)", () => {
    const mustConsume = [
      "amp",
      "antigravity",
      "goose",
      "grok",
      "hermes",
      "mistral-vibe",
      "qodercli",
      "rovo",
    ] as const;
    for (const id of mustConsume) {
      expect(
        MCP_DISCOVERY_ADAPTERS.find((adapter) => adapter.agentKind === id)
          ?.consumesMcp,
        `${id} must consume MCP`
      ).toBe(true);
    }
    const none = new Set(
      MCP_DISCOVERY_ADAPTERS.filter((adapter) => !adapter.consumesMcp).map(
        (adapter) => adapter.agentKind
      )
    );
    for (const id of mustConsume) {
      expect(none.has(id)).toBe(false);
    }
  });

  it("registers pier-memory for every consuming adapter (no parallel allowlist)", () => {
    const targets = memoryGlobalTargets({ env: {}, home: "/home/u" });
    const covered = new Set(targets.flatMap((target) => [...target.consumers]));
    for (const adapter of MCP_DISCOVERY_ADAPTERS) {
      if (!adapter.consumesMcp) {
        expect(covered.has(adapter.agentKind)).toBe(false);
        continue;
      }
      const preferred = adapter.userConfigs[0];
      expect(preferred, `${adapter.agentKind} missing userConfig`).toBeTruthy();
      expect(memoryFormatFor(preferred?.format ?? "json-mcp-servers")).not.toBe(
        null
      );
      expect(
        covered.has(adapter.agentKind),
        `${adapter.agentKind} missing from memory global targets`
      ).toBe(true);
    }
    expect(covered.has("grok")).toBe(true);
  });

  it("derives shared-path consumers (e.g. .mcp.json → claude + omp + forks)", () => {
    const paths = deriveMcpPathCandidates();
    const dotMcp = paths.find((p) => p.projectRelativePath === ".mcp.json");
    expect(dotMcp?.consumerAgentIds).toEqual([
      "claude",
      "codebuddy",
      "copilot",
      "omp",
      "openclaude",
      "qodercli",
    ]);
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

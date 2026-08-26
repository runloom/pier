import { selectMemoryTargets } from "@main/services/agent-managed-assets/write-targets.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import { describe, expect, it } from "vitest";

describe("selectMemoryTargets", () => {
  it("omp alone writes only .mcp.json", () => {
    expect(selectMemoryTargets(["omp"])).toEqual([
      {
        consumers: ["omp"],
        format: "mcp-servers-json",
        relativePath: ".mcp.json",
      },
    ]);
  });

  it("claude+omp dedupe into one target", () => {
    const rows = selectMemoryTargets(["claude", "omp"]);
    expect(rows).toHaveLength(1);
    expect([...rows[0]!.consumers].sort()).toEqual(["claude", "omp"]);
  });

  it("covers every installed agent exactly once across targets", () => {
    const all: AgentKind[] = [
      "claude",
      "codex",
      "cursor",
      "gemini",
      "opencode",
      "omp",
    ];
    const rows = selectMemoryTargets(all);
    expect(rows).toHaveLength(5);
    const covered = rows.flatMap((row) => row.consumers).sort();
    expect(covered).toEqual([...all].sort());
    expect(rows.map((row) => row.relativePath)).toEqual([
      ".codex/config.toml",
      ".cursor/mcp.json",
      ".gemini/settings.json",
      ".mcp.json",
      "opencode.json",
    ]);
  });

  it("ignores agents without a preferred write target", () => {
    expect(selectMemoryTargets(["aider", "goose"])).toEqual([]);
  });
});

import { platform } from "node:os";
import type { AgentKind } from "@shared/contracts/agent.ts";
import { describe, expect, it } from "vitest";
import { buildUpdatePlan } from "../../../../../src/main/services/agents/lifecycle/plan/build.ts";
import { getAgentLifecycleSpec } from "../../../../../src/main/services/agents/lifecycle/specs/index.ts";

/**
 * Table-driven primary step kind for common (agent × source) pairs.
 * Locks source-policy + specs against silent order regressions.
 *
 * Brew *cask* upgrades are planned only on darwin (see build.ts); Linux CI
 * falls through to CLI self-update for the same source hint.
 */
const MATRIX: ReadonlyArray<{
  agentId: AgentKind;
  source: string;
  primary:
    | { kind: "argv"; fileEndsWith?: string; args0?: string; file?: string }
    | { kind: "official-script" };
}> = [
  {
    agentId: "omp",
    source: "bun",
    primary: { kind: "argv", fileEndsWith: "omp", args0: "update" },
  },
  {
    agentId: "pi",
    source: "npm",
    primary: { kind: "argv", fileEndsWith: "pi", args0: "update" },
  },
  {
    agentId: "claude",
    source: "path",
    primary: { kind: "argv", fileEndsWith: "claude", args0: "update" },
  },
  {
    agentId: "claude",
    source: "brew",
    primary:
      platform() === "darwin"
        ? { kind: "argv", file: "brew", args0: "upgrade" }
        : { kind: "argv", fileEndsWith: "claude", args0: "update" },
  },
  {
    agentId: "kimi",
    source: "path",
    primary: { kind: "official-script" },
  },
  {
    agentId: "cursor",
    source: "path",
    // Script reinstall first (self update is auth-gated and exits 0 on failure).
    primary: { kind: "official-script" },
  },
  {
    agentId: "gemini",
    source: "npm",
    primary: { kind: "argv", file: "npm" },
  },
];

describe("lifecycle update primary step matrix", () => {
  for (const row of MATRIX) {
    it(`${row.agentId} @ ${row.source}`, () => {
      const plan = buildUpdatePlan(getAgentLifecycleSpec(row.agentId), {
        host: "posix",
        defaultBinPath: `/tmp/bin/${row.agentId}`,
        installSource: row.source,
      });
      expect(plan).not.toBeNull();
      const step = plan?.steps[0];
      expect(step?.kind).toBe(row.primary.kind);
      if (row.primary.kind === "argv" && step?.kind === "argv") {
        if (row.primary.file) {
          expect(step.file).toBe(row.primary.file);
        }
        if (row.primary.fileEndsWith) {
          expect(step.file.endsWith(row.primary.fileEndsWith)).toBe(true);
        }
        if (row.primary.args0) {
          expect(step.args[0]).toBe(row.primary.args0);
        }
      }
    });
  }
});

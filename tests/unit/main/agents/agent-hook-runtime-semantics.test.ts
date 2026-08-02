import { readFileSync } from "node:fs";
import { join } from "node:path";
import { agentKindSchema } from "@shared/contracts/agent.ts";
import { describe, expect, it } from "vitest";
import {
  AGENT_HOOK_INTEGRATIONS,
  getAgentHookIntegration,
} from "../../../../src/main/services/agents/integrations/registry.ts";

describe("agent hook runtime semantics", () => {
  it("每个 hook 集成都显式声明 Stop 权威等级，且注册表无重复", () => {
    expect(
      new Set(AGENT_HOOK_INTEGRATIONS.map((integration) => integration.id)).size
    ).toBe(AGENT_HOOK_INTEGRATIONS.length);
    expect(
      AGENT_HOOK_INTEGRATIONS.every(
        (integration) => integration.runtime.stopAuthority !== undefined
      )
    ).toBe(true);
  });

  it("锁定经原生事件审计后的 30 个集成分类", () => {
    const expected = {
      advisory: [
        "antigravity",
        "aug",
        "claude",
        "codebuddy",
        "command-code",
        "copilot",
        "cursor",
        "devin",
        "droid",
        "gemini",
        "goose",
        "grok",
        "kimi",
        "mistral-vibe",
        "openclaude",
        "qodercli",
        "qwen-code",
      ],
      authoritative: ["autohand", "kilo", "mimo-code", "omp", "opencode", "pi"],
      none: ["aider", "amp", "cline", "crush", "hermes", "kiro"],
    } as const;

    for (const [authority, agentIds] of Object.entries(expected)) {
      expect(
        agentIds.map((agentId) => ({
          agentId,
          authority: getAgentHookIntegration(agentId)?.runtime.stopAuthority,
        }))
      ).toEqual(agentIds.map((agentId) => ({ agentId, authority })));
    }
  });

  it("只有审计过的原生活动起点拥有无关联重开权威", () => {
    const actual = AGENT_HOOK_INTEGRATIONS.flatMap((integration) =>
      integration.runtime.emittedMappings
        .filter((mapping) => mapping.turnStartAuthority === "authoritative")
        .map((mapping) => ({
          agentId: integration.id,
          nativeEvent: mapping.nativeEvent,
          pierEvent: mapping.pierEvent,
        }))
    );

    expect(actual).toEqual([
      {
        agentId: "antigravity",
        nativeEvent: "PreInvocation",
        pierEvent: "processing",
      },
      {
        agentId: "cline",
        nativeEvent: "TaskResume",
        pierEvent: "running",
      },
    ]);
    expect(
      actual.every(({ pierEvent }) =>
        ["processing", "running"].includes(pierEvent)
      )
    ).toBe(true);
  });

  it("审计矩阵逐行覆盖运行时映射与两类 authority", () => {
    const audit = readFileSync(
      join(
        process.cwd(),
        "docs/superpowers/specs/2026-07-13-agent-status-adapter-contract-audit.md"
      ),
      "utf8"
    );
    const rows = new Map(
      audit
        .split("\n")
        .filter((line) => line.startsWith("| "))
        .map((line) => {
          const cells = line
            .split("|")
            .slice(1, -1)
            .map((cell) => cell.trim());
          return [cells[0], cells] as const;
        })
        .filter(([, cells]) => cells.length === 6)
    );

    for (const integration of AGENT_HOOK_INTEGRATIONS) {
      const cells = rows.get(integration.id);
      expect(cells, integration.id).toBeDefined();
      const mappingCell = cells?.[3] ?? "";
      for (const mapping of integration.runtime.emittedMappings) {
        expect(
          mappingCell,
          `${integration.id}:${mapping.nativeEvent}`
        ).toContain(mapping.nativeEvent);
        expect(mappingCell, `${integration.id}:${mapping.pierEvent}`).toContain(
          mapping.pierEvent
        );
      }
      expect(cells?.[4], `${integration.id}:stopAuthority`).toBe(
        `\`${integration.runtime.stopAuthority}\``
      );
      const authoritativeStarts = integration.runtime.emittedMappings.filter(
        (mapping) => mapping.turnStartAuthority === "authoritative"
      );
      if (authoritativeStarts.length === 0) {
        expect(cells?.[5], `${integration.id}:turnStartAuthority`).toBe("无");
      } else {
        for (const mapping of authoritativeStarts) {
          expect(cells?.[5]).toContain(
            `${mapping.nativeEvent}: ${mapping.turnStartAuthority}`
          );
        }
      }
    }
    expect(audit).toContain("| `SessionStart` | 缺席 | `idle` |");
  });

  it("launch-only agent 不伪造 hook 运行语义", () => {
    const launchOnly = ["ante", "codebuff", "continue", "rovo", "openclaw"];
    expect(
      agentKindSchema.options.filter(
        (agentId) => getAgentHookIntegration(agentId) === null
      )
    ).toEqual(launchOnly);
  });
});

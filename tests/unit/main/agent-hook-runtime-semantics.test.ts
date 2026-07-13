import { agentKindSchema } from "@shared/contracts/agent.ts";
import { describe, expect, it } from "vitest";
import {
  AGENT_HOOK_INTEGRATIONS,
  getAgentHookIntegration,
} from "../../../src/main/services/agents/integrations/registry.ts";

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
        "autohand",
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
        "kiro",
        "openclaude",
        "qodercli",
        "qwen-code",
      ],
      authoritative: [
        "amp",
        "cline",
        "kilo",
        "mimo-code",
        "mistral-vibe",
        "omp",
        "opencode",
        "pi",
      ],
      none: ["aider", "crush"],
      "reset-only": ["hermes"],
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

  it("launch-only agent 不伪造 hook 运行语义", () => {
    const launchOnly = ["ante", "codebuff", "continue", "rovo", "openclaw"];
    expect(
      agentKindSchema.options.filter(
        (agentId) => getAgentHookIntegration(agentId) === null
      )
    ).toEqual(launchOnly);
  });
});

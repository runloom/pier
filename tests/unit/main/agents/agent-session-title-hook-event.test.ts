import type { AgentHookEventPayload } from "@shared/contracts/agent/session.ts";
import { describe, expect, it } from "vitest";
import { promptSnippetForAgentSessionTitle } from "../../../../src/main/services/agents/session-title/index.ts";

function promptEvent(v: 2 | 3): AgentHookEventPayload {
  return {
    agent: "claude",
    event: "PromptSubmit",
    kind: "agentEvent",
    nativeEvent: "UserPromptSubmit",
    panelId: "panel-1",
    promptSnippet: "fix the parser",
    v,
    windowId: "1",
  };
}

describe("agent session title hook prompt", () => {
  it("v2 与 v3 的直接 promptSnippet 使用同一读取规则", () => {
    expect(promptSnippetForAgentSessionTitle(promptEvent(2))).toBe(
      "fix the parser"
    );
    expect(promptSnippetForAgentSessionTitle(promptEvent(3))).toBe(
      "fix the parser"
    );
  });
});

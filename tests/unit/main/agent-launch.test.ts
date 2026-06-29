import { resolveAgentCommand } from "@main/services/agents/agent-launch.ts";
import { describe, expect, it } from "vitest";

describe("resolveAgentCommand", () => {
  it("无权限参数时只用目录 launchCmd", () => {
    expect(
      resolveAgentCommand({ agentId: "claude", agentDefaultArgs: {} })
    ).toBe("claude");
  });
  it("带权限参数时追加在 base 后", () => {
    expect(
      resolveAgentCommand({
        agentId: "claude",
        agentDefaultArgs: { claude: "--dangerously-skip-permissions" },
      })
    ).toBe("claude --dangerously-skip-permissions");
  });
  it("binary 覆盖优先于目录 launchCmd", () => {
    expect(
      resolveAgentCommand({
        agentId: "claude",
        override: "/opt/claude",
        agentDefaultArgs: { claude: "--yolo" },
      })
    ).toBe("/opt/claude --yolo");
  });
  it("未知 agent 返回 null", () => {
    expect(
      resolveAgentCommand({ agentId: "nope" as never, agentDefaultArgs: {} })
    ).toBeNull();
  });
});

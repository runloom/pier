import { getAgentCatalogEntry } from "@main/services/agents/agent-catalog.ts";
import { resolveAgentCommand } from "@main/services/agents/agent-launch.ts";
import type { AgentCatalogEntry, AgentKind } from "@shared/contracts/agent.ts";
import { describe, expect, it, vi } from "vitest";

// 默认透传真实目录，仅在需要时用 mockReturnValueOnce 注入桩，保留其余用例走真实 catalog。
vi.mock("@main/services/agents/agent-catalog.ts", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@main/services/agents/agent-catalog.ts")
    >();
  return {
    ...actual,
    getAgentCatalogEntry: vi.fn((id: AgentKind) =>
      actual.getAgentCatalogEntry(id)
    ),
  };
});

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
  it("平台特定 launchCmdByPlatform 优先于 launchCmd", () => {
    const stub: AgentCatalogEntry = {
      id: "claude",
      label: "Claude",
      launchCmd: "claude",
      launchCmdByPlatform: { [process.platform]: "/platform/claude" },
      detectCmd: "claude",
      expectedProcess: "claude",
    };
    vi.mocked(getAgentCatalogEntry).mockReturnValueOnce(stub);
    expect(
      resolveAgentCommand({ agentId: "claude", agentDefaultArgs: {} })
    ).toBe("/platform/claude");
  });
});

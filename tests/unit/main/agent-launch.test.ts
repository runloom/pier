import {
  resolveAgentCommand,
  resolveOneShotInvocation,
} from "@main/services/agents/agent-launch.ts";
import { getAgentCatalogEntry } from "@shared/agent-catalog.ts";
import type { AgentCatalogEntry, AgentKind } from "@shared/contracts/agent.ts";
import { describe, expect, it, vi } from "vitest";

// 默认透传真实目录，仅在需要时用 mockReturnValueOnce 注入桩，保留其余用例走真实 catalog。
vi.mock("@shared/agent-catalog.ts", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@shared/agent-catalog.ts")>();
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
  it("多 token yolo flag 整串拼接、不拆分（qwen-code）", () => {
    expect(
      resolveAgentCommand({
        agentId: "qwen-code",
        agentDefaultArgs: { "qwen-code": "--approval-mode yolo" },
      })
    ).toBe("qwen-code --approval-mode yolo");
  });
  it("带参 launchCmd + yolo flag 拼接（kiro）", () => {
    expect(
      resolveAgentCommand({
        agentId: "kiro",
        agentDefaultArgs: { kiro: "--trust-all-tools" },
      })
    ).toBe("kiro-cli chat --tui --trust-all-tools");
  });
});

describe("resolveOneShotInvocation", () => {
  it("复用 launchCmd/defaultArgs,再 append catalog oneShotArgs", () => {
    const result = resolveOneShotInvocation({
      agentId: "claude",
      agentDefaultArgs: { claude: "--dangerously-skip-permissions" },
      prompt: "hello",
    });
    expect(result).toEqual({
      binary: "claude",
      args: ["--dangerously-skip-permissions", "-p", "hello"],
    });
  });

  it("binary 覆盖与 defaultArgs 一并参与分词", () => {
    const result = resolveOneShotInvocation({
      agentId: "claude",
      override: "/opt/bin/claude --model haiku",
      agentDefaultArgs: {},
      prompt: "hello",
    });
    expect(result).toEqual({
      binary: "/opt/bin/claude",
      args: ["--model", "haiku", "-p", "hello"],
    });
  });

  it("无 oneShotArgs 的 agent 返回 null", () => {
    expect(
      resolveOneShotInvocation({
        agentId: "aider",
        agentDefaultArgs: {},
        prompt: "hello",
      })
    ).toBeNull();
  });
});

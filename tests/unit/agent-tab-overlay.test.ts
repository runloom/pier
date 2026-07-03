import type { AgentSessionSnapshot } from "@shared/contracts/agent-session.ts";
import { describe, expect, it } from "vitest";
import { agentTabChromeOverlay } from "../../src/renderer/panel-kits/terminal/terminal-tab-chrome.ts";

function session(
  overrides: Partial<AgentSessionSnapshot> = {}
): AgentSessionSnapshot {
  return {
    agentId: "claude",
    panelId: "p1",
    source: "hook",
    stateStartedAt: 0,
    status: "processing",
    subagentCount: 0,
    updatedAt: 0,
    windowId: "1",
    ...overrides,
  };
}

describe("agentTabChromeOverlay", () => {
  it("hook 会话 → 状态点 + agent 图标 + 目录 label 标题（单源）", () => {
    expect(agentTabChromeOverlay(session())).toEqual({
      state: { status: "running" },
      icon: { id: "agent:claude" },
      title: "Claude",
    });
  });

  it.each([
    ["processing", "running"],
    ["tool", "running"],
    ["waiting", "waiting"],
    ["error", "failed"],
    ["ready", "idle"],
  ] as const)("状态映射 %s → tab %s", (status, tab) => {
    expect(agentTabChromeOverlay(session({ status }))?.state).toEqual({
      status: tab,
    });
  });

  it("无会话 → null（tab 呈现回退到 cwd/默认）", () => {
    expect(agentTabChromeOverlay(undefined)).toBeNull();
  });
});

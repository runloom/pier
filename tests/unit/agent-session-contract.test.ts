import {
  agentHookEventSchema,
  agentKindFromTabIconId,
  agentTabIconId,
  runtimeStatusForHookEvent,
  tabStatusForAgentStatus,
} from "@shared/contracts/agent-session.ts";
import { describe, expect, it } from "vitest";

describe("agentHookEventSchema", () => {
  it("接受合法 hook 事件", () => {
    const parsed = agentHookEventSchema.safeParse({
      v: 1,
      agent: "claude",
      event: "PromptSubmit",
      panelId: "panel-1",
      windowId: "3",
    });
    expect(parsed.success).toBe(true);
  });

  it("拒绝未知 agent、缺 panelId、缺 windowId", () => {
    expect(
      agentHookEventSchema.safeParse({
        v: 1,
        agent: "not-an-agent",
        event: "Stop",
        panelId: "p",
        windowId: "3",
      }).success
    ).toBe(false);
    expect(
      agentHookEventSchema.safeParse({
        v: 1,
        agent: "claude",
        event: "Stop",
        windowId: "3",
      }).success
    ).toBe(false);
    expect(
      agentHookEventSchema.safeParse({
        v: 1,
        agent: "claude",
        event: "Stop",
        panelId: "p",
      }).success
    ).toBe(false);
  });

  it("拒绝超长 event 名(>64)", () => {
    expect(
      agentHookEventSchema.safeParse({
        v: 1,
        agent: "claude",
        event: "x".repeat(65),
        panelId: "p",
        windowId: "3",
      }).success
    ).toBe(false);
  });
});

describe("runtimeStatusForHookEvent", () => {
  it.each([
    ["PermissionRequest", "waiting"],
    ["ToolStart", "tool"],
    ["ToolComplete", "tool"],
    ["error", "error"],
    ["SessionStart", "ready"],
    ["Stop", "ready"],
    ["SessionEnd", "ready"],
    ["PromptSubmit", "processing"],
    ["SubagentStart", "processing"],
    ["SubagentStop", "processing"],
  ] as const)("%s → %s", (event, status) => {
    expect(runtimeStatusForHookEvent(event)).toBe(status);
  });

  it("未知事件 → null", () => {
    expect(runtimeStatusForHookEvent("SomethingElse")).toBeNull();
  });
});

describe("tabStatusForAgentStatus", () => {
  it.each([
    ["processing", "running"],
    ["tool", "running"],
    ["waiting", "waiting"],
    ["error", "failed"],
    ["ready", "idle"],
  ] as const)("%s → %s", (status, tab) => {
    expect(tabStatusForAgentStatus(status)).toBe(tab);
  });
});

describe("agent tab icon id", () => {
  it("agentTabIconId 生成带前缀的 id", () => {
    expect(agentTabIconId("claude")).toBe("agent:claude");
  });

  it("agentKindFromTabIconId 解析合法 agent id", () => {
    expect(agentKindFromTabIconId("agent:claude")).toBe("claude");
    expect(agentKindFromTabIconId("agent:codex")).toBe("codex");
  });

  it.each([
    undefined,
    "",
    "pier.task",
    "agent:",
    "agent:not-an-agent",
  ])("非 agent icon id → null: %s", (iconId) => {
    expect(agentKindFromTabIconId(iconId)).toBeNull();
  });
});

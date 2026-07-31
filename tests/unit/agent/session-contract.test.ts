import {
  type AgentHookEventPayloadV3,
  agentHookEventSchema,
  agentKindFromTabIconId,
  agentTabIconId,
} from "@shared/contracts/agent/session.ts";
import {
  activityStatusForHookEvent,
  tabStatusForActivityStatus,
} from "@shared/contracts/foreground-activity.ts";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { PierHookCommandV3Spec } from "../../../src/main/services/agents/integrations/shared.ts";

describe("agentHookEventSchema", () => {
  it("接受合法 agentEvent 分支", () => {
    const parsed = agentHookEventSchema.safeParse({
      v: 1,
      kind: "agentEvent",
      agent: "claude",
      event: "PromptSubmit",
      panelId: "panel-1",
      windowId: "3",
    });
    expect(parsed.success).toBe(true);
  });

  it("接受保留原生事件语义的 v2 agentEvent", () => {
    expect(
      agentHookEventSchema.safeParse({
        v: 2,
        kind: "agentEvent",
        agent: "cline",
        event: "Stop",
        nativeEvent: "TaskCancel",
        panelId: "panel-1",
        windowId: "3",
      }).success
    ).toBe(true);
  });

  it("v2 兼容读取旧 PermissionRequest，v3 严格拒绝", () => {
    const base = {
      kind: "agentEvent",
      agent: "claude",
      event: "PermissionRequest",
      nativeEvent: "PermissionRequest",
      panelId: "panel-1",
      windowId: "3",
    };
    expect(agentHookEventSchema.safeParse({ ...base, v: 2 }).success).toBe(
      true
    );
    expect(agentHookEventSchema.safeParse({ ...base, v: 3 }).success).toBe(
      false
    );
  });

  it("v3 payload 与生成器类型均不接受旧 PermissionRequest", () => {
    expectTypeOf<
      "PermissionRequest" extends AgentHookEventPayloadV3["event"]
        ? true
        : false
    >().toEqualTypeOf<false>();
    expectTypeOf<
      "PermissionRequest" extends PierHookCommandV3Spec["event"] ? true : false
    >().toEqualTypeOf<false>();
  });

  it("接受带具名交互事实的 v3 InteractionRequested", () => {
    expect(
      agentHookEventSchema.safeParse({
        v: 3,
        kind: "agentEvent",
        agent: "claude",
        event: "InteractionRequested",
        nativeEvent: "PermissionRequest",
        interactionId: "permission-1",
        interactionKind: "permission",
        panelId: "panel-1",
        windowId: "3",
      }).success
    ).toBe(true);
  });

  it("接受带结果的 v3 InteractionResolved", () => {
    expect(
      agentHookEventSchema.safeParse({
        v: 3,
        kind: "agentEvent",
        agent: "claude",
        event: "InteractionResolved",
        nativeEvent: "PermissionResult",
        interactionId: "permission-1",
        interactionKind: "permission",
        interactionOutcome: "accepted",
        panelId: "panel-1",
        windowId: "3",
      }).success
    ).toBe(true);
  });

  it.each([
    "SessionStart",
    "PromptSubmit",
    "ToolStart",
    "ToolComplete",
    "SubagentStart",
    "SubagentStop",
    "processing",
    "running",
    "Stop",
    "TurnCompleted",
    "TurnInterrupted",
    "SessionEnd",
    "error",
  ])("接受 v3 标准非交互事件 %s", (event) => {
    expect(
      agentHookEventSchema.safeParse({
        v: 3,
        kind: "agentEvent",
        agent: "claude",
        event,
        nativeEvent: event,
        panelId: "panel-1",
        windowId: "3",
      }).success
    ).toBe(true);
  });

  it("接受合法 commandStart 分支", () => {
    const parsed = agentHookEventSchema.safeParse({
      v: 1,
      kind: "commandStart",
      panelId: "panel-1",
      windowId: "3",
      commandLine: "codex --resume",
    });
    expect(parsed.success).toBe(true);
  });

  it("接受合法 commandFinished 分支", () => {
    const parsed = agentHookEventSchema.safeParse({
      v: 1,
      kind: "commandFinished",
      panelId: "panel-1",
      windowId: "3",
      exitCode: 0,
    });
    expect(parsed.success).toBe(true);
  });

  it("拒绝缺 kind 的老 body", () => {
    expect(
      agentHookEventSchema.safeParse({
        v: 1,
        agent: "claude",
        event: "Stop",
        panelId: "p",
        windowId: "3",
      }).success
    ).toBe(false);
  });

  it("拒绝未知 agent、缺 panelId、缺 windowId", () => {
    expect(
      agentHookEventSchema.safeParse({
        v: 1,
        kind: "agentEvent",
        agent: "not-an-agent",
        event: "Stop",
        panelId: "p",
        windowId: "3",
      }).success
    ).toBe(false);
    expect(
      agentHookEventSchema.safeParse({
        v: 1,
        kind: "agentEvent",
        agent: "claude",
        event: "Stop",
        windowId: "3",
      }).success
    ).toBe(false);
    expect(
      agentHookEventSchema.safeParse({
        v: 1,
        kind: "agentEvent",
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
        kind: "agentEvent",
        agent: "claude",
        event: "x".repeat(65),
        panelId: "p",
        windowId: "3",
      }).success
    ).toBe(false);
  });

  it("v3 非交互事件拒绝携带交互字段", () => {
    expect(
      agentHookEventSchema.safeParse({
        v: 3,
        kind: "agentEvent",
        agent: "claude",
        event: "ToolStart",
        nativeEvent: "PreToolUse",
        interactionId: "not-an-interaction",
        interactionKind: "permission",
        panelId: "panel-1",
        windowId: "3",
      }).success
    ).toBe(false);
  });

  it("v3 交互事件拒绝非法种类和结果", () => {
    const base = {
      v: 3,
      kind: "agentEvent",
      agent: "claude",
      event: "InteractionResolved",
      nativeEvent: "PermissionResult",
      panelId: "panel-1",
      windowId: "3",
    };
    expect(
      agentHookEventSchema.safeParse({
        ...base,
        interactionKind: "tool",
      }).success
    ).toBe(false);
    expect(
      agentHookEventSchema.safeParse({
        ...base,
        interactionKind: "permission",
        interactionOutcome: "approved",
      }).success
    ).toBe(false);
  });
});

describe("activityStatusForHookEvent", () => {
  it.each([
    ["ToolStart", "tool"],
    ["ToolComplete", "processing"],
    ["error", "error"],
    ["Stop", "ready"],
    ["TurnCompleted", "ready"],
    ["PromptSubmit", "processing"],
    ["SubagentStart", "processing"],
    ["SubagentStop", "processing"],
    ["InteractionRequested", "waiting"],
    ["InteractionResolved", "processing"],
  ] as const)("%s → %s", (event, status) => {
    expect(activityStatusForHookEvent(event)).toBe(status);
  });

  it("未知事件 → null", () => {
    expect(activityStatusForHookEvent("SomethingElse")).toBeNull();
  });

  it.each([
    "SessionStart",
    "SessionEnd",
  ])("%s 只提供生命周期证据，不映射为 ready", (event) => {
    expect(activityStatusForHookEvent(event)).toBeNull();
  });

  it("严格 v3 状态词汇不接受旧 PermissionRequest", () => {
    expect(activityStatusForHookEvent("PermissionRequest")).toBeNull();
  });
});

describe("tabStatusForActivityStatus", () => {
  it.each([
    ["processing", "running"],
    ["tool", "running"],
    ["waiting", "waiting"],
    ["error", "failed"],
    ["ready", "idle"],
  ] as const)("%s → %s", (status, tab) => {
    expect(tabStatusForActivityStatus(status)).toBe(tab);
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

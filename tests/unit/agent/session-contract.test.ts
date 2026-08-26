import {
  type AgentHookEventPayloadV3,
  agentHookEventSchema,
  agentKindFromTabIconId,
  agentTabIconId,
  HOOK_WORK_ID_MAX,
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

  it("接受 OMP ask 实测长度的 toolUseId / interactionId", () => {
    const ompAskId =
      "call-03435de8-1557-4d10-b08f-e49c075729b1-0|K8TGf/h4nJMapPL8yM3t44JgGgk3TKEOI+jwKkoboyPoTTTb3qGLC3+8gxvAK1DM96zSbuGQwFAy5vs/5oMz/SIIxyEPUyabg33AkqAeL35VVtH4FOmWeTq2BqBolwQtzTZB8LIpjT21VOkwqa5vfiBNucbgZEBzgygMDAXFe+NW6AlFVX7Q3XZAgWBJRoR9UvnTIBEoug84EvXwJhXySOKLhuRKdFqoFRzaD7nZhdJBOULdabd2prc/NlU2iLaSMLoYp6g8AX0fGj3Jg5MMOtd8FTMnF0XYeH+JvS/+mQ2Yax8MoPwkE5Q9pO4gRJZQ9yUpzRmkhBKOk6FOLlxEqb5q2BNj4RkH7XFKbGcdlmpY43FSk5amhaAyNHfl0+uYghhTU8d/UA==";
    expect(ompAskId.length).toBeGreaterThan(128);
    expect(ompAskId.length).toBeLessThanOrEqual(HOOK_WORK_ID_MAX);
    expect(
      agentHookEventSchema.safeParse({
        v: 3,
        kind: "agentEvent",
        agent: "omp",
        event: "InteractionRequested",
        nativeEvent: "tool_execution_start.ask",
        interactionId: ompAskId,
        interactionKind: "question",
        toolName: "ask",
        toolUseId: ompAskId,
        panelId: "panel-1",
        windowId: "1",
      }).success
    ).toBe(true);
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

  it("接受 v3 SessionEnd 带可选 spawnGeneration，缺字段仍能 parse", () => {
    const base = {
      v: 3 as const,
      kind: "agentEvent" as const,
      agent: "omp" as const,
      event: "SessionEnd" as const,
      nativeEvent: "session_shutdown",
      panelId: "panel-1",
      windowId: "3",
    };
    expect(agentHookEventSchema.safeParse(base).success).toBe(true);
    expect(
      agentHookEventSchema.safeParse({ ...base, spawnGeneration: 2 }).success
    ).toBe(true);
    expect(
      agentHookEventSchema.safeParse({ ...base, extraUnknown: true }).success
    ).toBe(false);
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

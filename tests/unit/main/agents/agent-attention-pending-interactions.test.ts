/**
 * 未决交互注册表（M1 审批回写）：
 * InteractionRequested 且带 interactionId 才登记（同 agentRef 覆盖）；
 * InteractionResolved 清除（id 匹配清该条；无 id 清 agent 当前记录；
 * id 不符的陈旧 Resolved 不误清）。
 */
import {
  createPendingInteractionRegistry,
  type PendingInteractionRegistry,
} from "@main/services/agent-attention/pending-interactions.ts";
import { createAgentAttentionService } from "@main/services/agent-attention/service.ts";
import { makeAgentRef } from "@shared/contracts/agent/runtime-index.ts";
import type { AgentHookEventPayloadV3 } from "@shared/contracts/agent/session.ts";
import { describe, expect, it, vi } from "vitest";

const AGENT_REF = makeAgentRef("w1", "p1");

function requested(interactionId?: string): AgentHookEventPayloadV3 {
  return {
    agent: "claude",
    event: "InteractionRequested",
    interactionKind: "permission",
    kind: "agentEvent",
    nativeEvent: "PreToolUse",
    panelId: "p1",
    v: 3,
    windowId: "w1",
    ...(interactionId ? { interactionId } : {}),
  };
}

function resolved(interactionId?: string): AgentHookEventPayloadV3 {
  return {
    agent: "claude",
    event: "InteractionResolved",
    interactionKind: "permission",
    kind: "agentEvent",
    nativeEvent: "PostToolUse",
    panelId: "p1",
    v: 3,
    windowId: "w1",
    ...(interactionId ? { interactionId } : {}),
  };
}

function toolStart(): AgentHookEventPayloadV3 {
  return {
    agent: "claude",
    event: "ToolStart",
    kind: "agentEvent",
    nativeEvent: "PreToolUse",
    panelId: "p1",
    v: 3,
    windowId: "w1",
  };
}

describe("PendingInteractionRegistry", () => {
  it("Requested 带 interactionId → 登记；assertCurrent 通过", () => {
    const registry = createPendingInteractionRegistry();
    registry.onHookEvent(requested("ix-1"), AGENT_REF);
    expect(registry.assertCurrent(AGENT_REF, "ix-1")).toBe(true);
    expect(registry.currentInteractionId(AGENT_REF)).toBe("ix-1");
  });

  it("Requested 不带 interactionId → 不登记", () => {
    const registry = createPendingInteractionRegistry();
    registry.onHookEvent(requested(), AGENT_REF);
    expect(registry.assertCurrent(AGENT_REF, "ix-1")).toBe(false);
    expect(registry.currentInteractionId(AGENT_REF)).toBeUndefined();
  });

  it("同 agentRef 新 Requested 覆盖旧记录", () => {
    const registry = createPendingInteractionRegistry();
    registry.onHookEvent(requested("ix-1"), AGENT_REF);
    registry.onHookEvent(requested("ix-2"), AGENT_REF);
    expect(registry.assertCurrent(AGENT_REF, "ix-1")).toBe(false);
    expect(registry.assertCurrent(AGENT_REF, "ix-2")).toBe(true);
    expect(registry.currentInteractionId(AGENT_REF)).toBe("ix-2");
  });

  it("Resolved id 匹配 → 清除", () => {
    const registry = createPendingInteractionRegistry();
    registry.onHookEvent(requested("ix-1"), AGENT_REF);
    registry.onHookEvent(resolved("ix-1"), AGENT_REF);
    expect(registry.assertCurrent(AGENT_REF, "ix-1")).toBe(false);
    expect(registry.currentInteractionId(AGENT_REF)).toBeUndefined();
  });

  it("Resolved 无 id → 清该 agent 当前记录", () => {
    const registry = createPendingInteractionRegistry();
    registry.onHookEvent(requested("ix-1"), AGENT_REF);
    registry.onHookEvent(resolved(), AGENT_REF);
    expect(registry.currentInteractionId(AGENT_REF)).toBeUndefined();
  });

  it("Resolved id 不符（乱序/陈旧）→ 保留当前未决项", () => {
    const registry = createPendingInteractionRegistry();
    registry.onHookEvent(requested("ix-1"), AGENT_REF);
    registry.onHookEvent(resolved("ix-stale"), AGENT_REF);
    expect(registry.assertCurrent(AGENT_REF, "ix-1")).toBe(true);
  });

  it("非交互事件不影响登记", () => {
    const registry = createPendingInteractionRegistry();
    registry.onHookEvent(requested("ix-1"), AGENT_REF);
    registry.onHookEvent(toolStart(), AGENT_REF);
    expect(registry.assertCurrent(AGENT_REF, "ix-1")).toBe(true);
  });

  it("未知 agentRef → assertCurrent false", () => {
    const registry = createPendingInteractionRegistry();
    expect(registry.assertCurrent(makeAgentRef("w9", "p9"), "ix-1")).toBe(
      false
    );
  });
});

describe("AgentAttentionService 挂注册表", () => {
  function serviceWith(pendingInteractions?: PendingInteractionRegistry) {
    return createAgentAttentionService({
      ingestNotification: vi.fn(),
      ...(pendingInteractions ? { pendingInteractions } : {}),
    });
  }

  it("缺省自建注册表并暴露", () => {
    const service = serviceWith();
    expect(service.pendingInteractions).toBeDefined();
    service.pendingInteractions.onHookEvent(requested("ix-1"), AGENT_REF);
    expect(service.pendingInteractions.assertCurrent(AGENT_REF, "ix-1")).toBe(
      true
    );
  });

  it("注入的注册表被沿用（命令面 / 快照共用同一实例）", () => {
    const shared = createPendingInteractionRegistry();
    const service = serviceWith(shared);
    expect(service.pendingInteractions).toBe(shared);
  });
});

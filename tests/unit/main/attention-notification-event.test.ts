import {
  classifyAgentNotificationEvent,
  shouldSuppressAgentNotification,
} from "@main/services/agent-attention/notification-event.ts";
import {
  type AgentAttentionSettings,
  DEFAULT_AGENT_ATTENTION_SETTINGS,
} from "@shared/contracts/agent-attention.ts";
import type { ActivityStatus } from "@shared/contracts/foreground-activity.ts";
import { describe, expect, it } from "vitest";

function settings(
  overrides: Partial<AgentAttentionSettings> = {}
): Pick<
  AgentAttentionSettings,
  "enabled" | "enableErrorAttention" | "turnNotifyMode" | "suppressWhenFocused"
> {
  return { ...DEFAULT_AGENT_ATTENTION_SETTINGS, ...overrides };
}

describe("classifyAgentNotificationEvent", () => {
  const cases: Array<{
    name: string;
    previous: ActivityStatus | undefined;
    next: ActivityStatus | undefined;
    overrides?: Partial<AgentAttentionSettings>;
    expected: "waiting" | "ready" | "error" | null;
  }> = [
    {
      name: "processing→waiting | enabled true → waiting",
      previous: "processing",
      next: "waiting",
      overrides: { enabled: true },
      expected: "waiting",
    },
    {
      name: "processing→waiting | enabled false → null",
      previous: "processing",
      next: "waiting",
      overrides: { enabled: false },
      expected: null,
    },
    {
      name: "processing→ready | unfocused → ready",
      previous: "processing",
      next: "ready",
      overrides: { turnNotifyMode: "unfocused" },
      expected: "ready",
    },
    {
      name: "processing→ready | always → ready",
      previous: "processing",
      next: "ready",
      overrides: { turnNotifyMode: "always" },
      expected: "ready",
    },
    {
      name: "processing→ready | off → null",
      previous: "processing",
      next: "ready",
      overrides: { turnNotifyMode: "off" },
      expected: null,
    },
    {
      name: "ready→ready | * → null",
      previous: "ready",
      next: "ready",
      overrides: { turnNotifyMode: "always" },
      expected: null,
    },
    {
      // 面板首次投影（SessionStart 揭示 / 启动重连）即 ready：没跑过回合，
      // 不得误报「回合已完成」。
      name: "∅→ready | 首次投影不算回合完成 → null",
      previous: undefined,
      next: "ready",
      overrides: { turnNotifyMode: "always" },
      expected: null,
    },
    {
      name: "processing→error | enableErrorAttention true → error",
      previous: "processing",
      next: "error",
      overrides: { enableErrorAttention: true },
      expected: "error",
    },
    {
      name: "processing→error | enableErrorAttention false → null",
      previous: "processing",
      next: "error",
      overrides: { enableErrorAttention: false },
      expected: null,
    },
    {
      name: "waiting→error | enableErrorAttention true → null",
      previous: "waiting",
      next: "error",
      overrides: { enableErrorAttention: true },
      expected: null,
    },
    {
      name: "error→waiting | enabled true → null",
      previous: "error",
      next: "waiting",
      overrides: { enabled: true, enableErrorAttention: true },
      expected: null,
    },
    {
      name: "waiting→ready | turn ≠ off → ready",
      previous: "waiting",
      next: "ready",
      overrides: { turnNotifyMode: "unfocused" },
      expected: "ready",
    },
    {
      name: "error→ready | turn ≠ off → ready",
      previous: "error",
      next: "ready",
      overrides: { turnNotifyMode: "always" },
      expected: "ready",
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect(
        classifyAgentNotificationEvent({
          previous: c.previous,
          next: c.next,
          settings: settings(c.overrides),
        })
      ).toBe(c.expected);
    });
  }

  it("classifies error even when enabled is false", () => {
    expect(
      classifyAgentNotificationEvent({
        previous: "processing",
        next: "error",
        settings: settings({ enabled: false, enableErrorAttention: true }),
      })
    ).toBe("error");
  });
});

describe("shouldSuppressAgentNotification", () => {
  it("ready + unfocused suppresses when owner window focused", () => {
    expect(
      shouldSuppressAgentNotification({
        kind: "ready",
        settings: settings({ turnNotifyMode: "unfocused" }),
        isTargetPanelFocused: false,
        isOwnerWindowFocused: true,
      })
    ).toBe(true);
  });

  it("ready + unfocused does not suppress when owner window unfocused", () => {
    expect(
      shouldSuppressAgentNotification({
        kind: "ready",
        settings: settings({ turnNotifyMode: "unfocused" }),
        isTargetPanelFocused: true,
        isOwnerWindowFocused: false,
      })
    ).toBe(false);
  });

  it("ready + always never suppresses for focus", () => {
    expect(
      shouldSuppressAgentNotification({
        kind: "ready",
        settings: settings({ turnNotifyMode: "always" }),
        isTargetPanelFocused: true,
        isOwnerWindowFocused: true,
      })
    ).toBe(false);
  });

  it("waiting suppresses when suppressWhenFocused and panel focused", () => {
    expect(
      shouldSuppressAgentNotification({
        kind: "waiting",
        settings: settings({ suppressWhenFocused: true }),
        isTargetPanelFocused: true,
        isOwnerWindowFocused: false,
      })
    ).toBe(true);
  });

  it("waiting does not suppress when only owner window focused", () => {
    expect(
      shouldSuppressAgentNotification({
        kind: "waiting",
        settings: settings({ suppressWhenFocused: true }),
        isTargetPanelFocused: false,
        isOwnerWindowFocused: true,
      })
    ).toBe(false);
  });

  it("error follows waiting panel-focus suppress rules", () => {
    expect(
      shouldSuppressAgentNotification({
        kind: "error",
        settings: settings({ suppressWhenFocused: true }),
        isTargetPanelFocused: true,
        isOwnerWindowFocused: false,
      })
    ).toBe(true);
  });
});

import { createDeliverToast } from "@main/services/notification-center/deliver-toast.ts";
import { DEFAULT_AGENT_ATTENTION_SETTINGS } from "@shared/contracts/agent/attention.ts";
import type { AppNotification } from "@shared/contracts/notification-center.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const maybePlayInterruptSoundMock = vi.fn();
const decideNotificationAudioMock = vi.fn();

vi.mock("@main/services/agent-attention/notification-audio.ts", () => ({
  decideNotificationAudio: (...args: unknown[]) =>
    decideNotificationAudioMock(...args),
  maybePlayInterruptSound: (...args: unknown[]) =>
    maybePlayInterruptSoundMock(...args),
}));

function notification(
  overrides: Partial<AppNotification> = {}
): AppNotification {
  return {
    id: "n1",
    kind: "agent.attention",
    read: false,
    severity: "warning",
    source: "agent-attention",
    title: "Need you",
    trigger: "system-event",
    ts: 1,
    agentRef: "11\0p1",
    dedupeKey: "agent.attention:waiting:11\0p1",
    ...overrides,
  };
}

describe("createDeliverToast", () => {
  const sendToast = vi.fn();
  const sendSoundToWindow = vi.fn(() => true);
  const decision = {
    appSoundId: "abstract-sound1" as const,
    silent: true,
    usesOsDefaultTone: false,
  };

  beforeEach(() => {
    sendToast.mockReset();
    sendSoundToWindow.mockReset();
    sendSoundToWindow.mockReturnValue(true);
    maybePlayInterruptSoundMock.mockReset();
    decideNotificationAudioMock.mockReset();
    decideNotificationAudioMock.mockReturnValue(decision);
  });

  it("eligible kind + send true → interrupt sound on toast channel", () => {
    sendToast.mockReturnValue(true);
    const deliver = createDeliverToast({
      getAttentionSettings: () => DEFAULT_AGENT_ATTENTION_SETTINGS,
      sendToast,
      sendSoundToWindow,
    });
    const n = notification();
    const target = { mode: "key-window" as const };
    expect(deliver(n, target)).toBe(true);
    expect(sendToast).toHaveBeenCalledWith(n, target);
    expect(decideNotificationAudioMock).toHaveBeenCalledWith(
      DEFAULT_AGENT_ATTENTION_SETTINGS
    );
    expect(maybePlayInterruptSoundMock).toHaveBeenCalledTimes(1);
    expect(maybePlayInterruptSoundMock).toHaveBeenCalledWith({
      channel: "toast",
      decision,
      force: false,
      sendToWindow: sendSoundToWindow,
    });
  });

  it("send false → no sound", () => {
    sendToast.mockReturnValue(false);
    const deliver = createDeliverToast({
      getAttentionSettings: () => DEFAULT_AGENT_ATTENTION_SETTINGS,
      sendToast,
      sendSoundToWindow,
    });
    expect(deliver(notification(), { mode: "key-window" })).toBe(false);
    expect(maybePlayInterruptSoundMock).not.toHaveBeenCalled();
    expect(decideNotificationAudioMock).not.toHaveBeenCalled();
  });

  it("non-OS-eligible kind → no sound even when toast sends", () => {
    sendToast.mockReturnValue(true);
    const deliver = createDeliverToast({
      getAttentionSettings: () => DEFAULT_AGENT_ATTENTION_SETTINGS,
      sendToast,
      sendSoundToWindow,
    });
    expect(
      deliver(notification({ kind: "task-run.finished", id: "n2" }), {
        mode: "key-window",
      })
    ).toBe(true);
    expect(sendToast).toHaveBeenCalled();
    expect(maybePlayInterruptSoundMock).not.toHaveBeenCalled();
  });

  it("agent.turn-finished is eligible for toast sound", () => {
    sendToast.mockReturnValue(true);
    const deliver = createDeliverToast({
      getAttentionSettings: () => DEFAULT_AGENT_ATTENTION_SETTINGS,
      sendToast,
      sendSoundToWindow,
    });
    expect(
      deliver(notification({ kind: "agent.turn-finished", id: "n3" }), {
        mode: "key-window",
      })
    ).toBe(true);
    expect(maybePlayInterruptSoundMock).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "toast" })
    );
  });
});

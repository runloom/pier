import {
  decideNotificationAudio,
  maybePlayAfterShown,
  resetAttentionSoundPlaybackStateForTests,
} from "@main/services/agent-attention/notification-audio.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("decideNotificationAudio", () => {
  it("system + enabled on darwin uses OS default sound", () => {
    expect(
      decideNotificationAudio(
        { soundEnabled: true, soundId: "system" },
        "darwin"
      )
    ).toEqual({ silent: false, sound: "default", appSoundId: null });
  });

  it("system + enabled on win32 omits sound name", () => {
    expect(
      decideNotificationAudio(
        { soundEnabled: true, soundId: "system" },
        "win32"
      )
    ).toEqual({ silent: false, appSoundId: null });
  });

  it("builtin enables app sound and silences OS", () => {
    expect(
      decideNotificationAudio(
        { soundEnabled: true, soundId: "abstract-sound2" },
        "darwin"
      )
    ).toEqual({ silent: true, appSoundId: "abstract-sound2" });
  });

  it("soundEnabled false silences OS and app", () => {
    expect(
      decideNotificationAudio(
        { soundEnabled: false, soundId: "rooster" },
        "darwin"
      )
    ).toEqual({ silent: true, appSoundId: null });
  });
});

describe("maybePlayAfterShown", () => {
  beforeEach(() => {
    resetAttentionSoundPlaybackStateForTests();
  });

  it("spacing drops second business play within 1000ms", () => {
    const send = vi.fn(() => true);
    let t = 0;
    const decision = {
      silent: true,
      appSoundId: "abstract-sound1" as const,
    };
    expect(
      maybePlayAfterShown({ decision, now: () => t, sendToWindow: send })
    ).toBe("played");
    t = 500;
    expect(
      maybePlayAfterShown({ decision, now: () => t, sendToWindow: send })
    ).toBe("skipped-spacing");
    t = 1500;
    expect(
      maybePlayAfterShown({ decision, now: () => t, sendToWindow: send })
    ).toBe("played");
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledWith({ soundId: "abstract-sound1" });
  });

  it("force bypasses spacing", () => {
    const send = vi.fn(() => true);
    let t = 0;
    const decision = {
      silent: true,
      appSoundId: "rooster" as const,
    };
    expect(
      maybePlayAfterShown({ decision, now: () => t, sendToWindow: send })
    ).toBe("played");
    t = 100;
    expect(
      maybePlayAfterShown({
        decision,
        force: true,
        now: () => t,
        sendToWindow: send,
      })
    ).toBe("played");
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("skips when no app sound", () => {
    const send = vi.fn(() => true);
    expect(
      maybePlayAfterShown({
        decision: { silent: false, sound: "default", appSoundId: null },
        sendToWindow: send,
      })
    ).toBe("skipped-no-app-sound");
    expect(send).not.toHaveBeenCalled();
  });

  it("does not advance spacing when send returns false", () => {
    const send = vi.fn(() => false);
    let t = 0;
    const decision = { silent: true, appSoundId: "abstract-sound2" as const };
    // 第一次 send 失败：不应记 spacing
    expect(
      maybePlayAfterShown({ decision, now: () => t, sendToWindow: send })
    ).toBe("skipped-no-window");
    // 立刻第二次 send 成功：不应被 spacing 拦
    send.mockReturnValue(true);
    t = 50;
    expect(
      maybePlayAfterShown({ decision, now: () => t, sendToWindow: send })
    ).toBe("played");
    expect(send).toHaveBeenCalledTimes(2);
  });
});

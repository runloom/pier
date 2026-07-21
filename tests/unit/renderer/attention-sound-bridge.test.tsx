import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AttentionSoundBridge } from "@/components/common/attention-sound-bridge.tsx";

const playMocks = vi.hoisted(() => ({
  playAttentionSound: vi.fn(async () => undefined),
}));

vi.mock("@/lib/attention/play-attention-sound.ts", () => ({
  playAttentionSound: playMocks.playAttentionSound,
}));

type SoundPlayCallback = (payload: { soundId: string }) => void;

function stubPierNotifications(api: Record<string, unknown> | undefined) {
  Object.defineProperty(window, "pier", {
    configurable: true,
    value: api === undefined ? undefined : { notifications: api },
    writable: true,
  });
}

describe("AttentionSoundBridge", () => {
  let captured: SoundPlayCallback | null = null;
  const unsubscribe = vi.fn();

  beforeEach(() => {
    captured = null;
    unsubscribe.mockClear();
    playMocks.playAttentionSound.mockClear();
    playMocks.playAttentionSound.mockResolvedValue(undefined);
    stubPierNotifications({
      onAttentionSoundPlay: (cb: SoundPlayCallback) => {
        captured = cb;
        return unsubscribe;
      },
    });
  });

  afterEach(() => {
    cleanup();
    stubPierNotifications(undefined);
  });

  it("plays catalog builtin ids from the main broadcast", () => {
    render(<AttentionSoundBridge />);
    expect(captured).not.toBeNull();

    captured?.({ soundId: "rooster" });
    expect(playMocks.playAttentionSound).toHaveBeenCalledTimes(1);
    expect(playMocks.playAttentionSound).toHaveBeenCalledWith("rooster");
  });

  it("rejects soundIds outside the builtin catalog", () => {
    render(<AttentionSoundBridge />);

    captured?.({ soundId: "system" });
    captured?.({ soundId: "../fonts/x.ttf" });
    captured?.({ soundId: "soft" });
    expect(playMocks.playAttentionSound).not.toHaveBeenCalled();
  });

  it("swallows play rejections without unhandled errors", async () => {
    playMocks.playAttentionSound.mockRejectedValue(new Error("blocked"));
    render(<AttentionSoundBridge />);

    captured?.({ soundId: "fahhhhh" });
    await Promise.resolve();
    expect(playMocks.playAttentionSound).toHaveBeenCalledTimes(1);
  });

  it("unsubscribes on unmount", () => {
    const view = render(<AttentionSoundBridge />);
    view.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("renders without the notifications api", () => {
    stubPierNotifications(undefined);
    expect(() => {
      render(<AttentionSoundBridge />);
    }).not.toThrow();
    expect(playMocks.playAttentionSound).not.toHaveBeenCalled();
  });
});

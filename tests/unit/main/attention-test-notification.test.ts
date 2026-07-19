import { runAttentionTestNotification } from "@main/services/agent-attention/attention-test-notification.ts";
import { DEFAULT_AGENT_ATTENTION_SETTINGS } from "@shared/contracts/agent-attention.ts";
import { describe, expect, it, vi } from "vitest";

describe("runAttentionTestNotification", () => {
  it("applies audio decision and force-plays after shown", async () => {
    const show = vi.fn(async () => ({ shown: true }));
    const play = vi.fn();
    await runAttentionTestNotification({
      settings: {
        ...DEFAULT_AGENT_ATTENTION_SETTINGS,
        soundId: "rooster",
        soundEnabled: true,
      },
      showTest: show,
      play,
    });
    expect(show).toHaveBeenCalledWith(
      expect.objectContaining({ silent: true })
    );
    expect(play).toHaveBeenCalledWith(
      expect.objectContaining({
        force: true,
        decision: expect.objectContaining({
          silent: true,
          appSoundId: "rooster",
        }),
      })
    );
  });

  it("does not play when notification is not shown", async () => {
    const show = vi.fn(async () => ({ shown: false }));
    const play = vi.fn();
    await runAttentionTestNotification({
      settings: {
        ...DEFAULT_AGENT_ATTENTION_SETTINGS,
        soundId: "rooster",
        soundEnabled: true,
      },
      showTest: show,
      play,
    });
    expect(show).toHaveBeenCalledOnce();
    expect(play).not.toHaveBeenCalled();
  });

  it("passes darwin system sound without force play payload need", async () => {
    const show = vi.fn(async () => ({ shown: true }));
    const play = vi.fn();
    await runAttentionTestNotification({
      settings: {
        ...DEFAULT_AGENT_ATTENTION_SETTINGS,
        soundId: "system",
        soundEnabled: true,
      },
      showTest: show,
      play,
    });
    // decide matrix is platform-dependent; only assert silent is not forced true
    // for system+enabled, and play still receives force:true with null appSoundId.
    expect(show).toHaveBeenCalledWith(
      expect.objectContaining({ silent: false })
    );
    expect(play).toHaveBeenCalledWith(
      expect.objectContaining({
        force: true,
        decision: expect.objectContaining({ appSoundId: null }),
      })
    );
  });
});

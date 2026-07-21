import { DEFAULT_AGENT_ATTENTION_SETTINGS } from "@shared/contracts/agent-attention.ts";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import { NotificationSoundBlock } from "@/pages/settings/components/notification-sound-block.tsx";
import { useAgentAttentionPreferencesStore } from "@/stores/agent-attention-preferences.store.ts";

const playMocks = vi.hoisted(() => ({
  playAttentionSound: vi.fn(async () => undefined),
}));

vi.mock("@/lib/attention/play-attention-sound.ts", () => ({
  playAttentionSound: playMocks.playAttentionSound,
}));

describe("NotificationSoundBlock", () => {
  beforeEach(async () => {
    await initI18n();
    playMocks.playAttentionSound.mockClear();
    playMocks.playAttentionSound.mockResolvedValue(undefined);
    useAgentAttentionPreferencesStore.setState({
      agentAttention: { ...DEFAULT_AGENT_ATTENTION_SETTINGS },
    });
  });

  afterEach(() => {
    cleanup();
    useAgentAttentionPreferencesStore.setState({
      agentAttention: { ...DEFAULT_AGENT_ATTENTION_SETTINGS },
    });
    vi.restoreAllMocks();
  });

  it("disables preview when soundId is system and shows static hint", () => {
    useAgentAttentionPreferencesStore.setState({
      agentAttention: {
        ...DEFAULT_AGENT_ATTENTION_SETTINGS,
        soundId: "system",
      },
    });

    render(<NotificationSoundBlock />);

    const preview = screen.getByRole("button", {
      name: "Preview selected app tone",
    });
    expect(preview).toBeDisabled();
    expect(
      screen.getByText(
        "System default sound cannot be previewed in-app. Use “Send test notification” below."
      )
    ).toBeInTheDocument();
    fireEvent.click(preview);
    expect(playMocks.playAttentionSound).not.toHaveBeenCalled();
  });

  it("enables preview for builtin sound and plays with force", async () => {
    useAgentAttentionPreferencesStore.setState({
      agentAttention: {
        ...DEFAULT_AGENT_ATTENTION_SETTINGS,
        soundEnabled: false,
        soundId: "abstract-sound1",
      },
    });

    render(<NotificationSoundBlock />);

    const preview = screen.getByRole("button", {
      name: "Preview selected app tone",
    });
    expect(preview).toBeEnabled();
    expect(
      screen.queryByText(
        "System default sound cannot be previewed in-app. Use “Send test notification” below."
      )
    ).not.toBeInTheDocument();

    fireEvent.click(preview);

    await waitFor(() => {
      expect(playMocks.playAttentionSound).toHaveBeenCalledTimes(1);
    });
    expect(playMocks.playAttentionSound).toHaveBeenCalledWith(
      "abstract-sound1",
      {
        force: true,
      }
    );
  });
});

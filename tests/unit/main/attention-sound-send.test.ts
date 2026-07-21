import { sendAttentionSoundPlayToOneWindow } from "@main/app-core/window-broadcasts.ts";
import { PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeWebContents {
  isDestroyed: () => boolean;
  send: (channel: string, payload: unknown) => void;
}

interface FakeWindow {
  isDestroyed: () => boolean;
  isFocused: () => boolean;
  webContents: FakeWebContents;
}

interface FakeWindowManager {
  __setWindows: (wins: FakeWindow[]) => void;
  getAll: () => FakeWindow[];
  getFocused: () => FakeWindow | null;
}

function makeWindow(
  send: (channel: string, payload: unknown) => void,
  opts: {
    destroyed?: boolean;
    webContentsDestroyed?: boolean;
    focused?: boolean;
  } = {}
): FakeWindow {
  return {
    isFocused: () => opts.focused ?? false,
    isDestroyed: () => opts.destroyed ?? false,
    webContents: {
      isDestroyed: () => opts.webContentsDestroyed ?? false,
      send,
    },
  };
}

const state: { windows: FakeWindow[] } = { windows: [] };

vi.mock("@main/windows/window-manager.ts", () => ({
  windowManager: {
    getAll: () => state.windows,
    getFocused: () => state.windows.find((w) => w.isFocused()) ?? null,
    __setWindows: (wins: FakeWindow[]) => {
      state.windows = wins;
    },
  } satisfies FakeWindowManager,
}));

const windowManager = (await import("@main/windows/window-manager.ts"))
  .windowManager as unknown as FakeWindowManager;

describe("sendAttentionSoundPlayToOneWindow", () => {
  beforeEach(() => {
    windowManager.__setWindows([]);
  });

  it("sends to focused window only, never to all windows", () => {
    const focusedSend = vi.fn();
    const otherSend = vi.fn();
    const focused = makeWindow(focusedSend, { focused: true });
    const other = makeWindow(otherSend);
    windowManager.__setWindows([other, focused]);

    const sent = sendAttentionSoundPlayToOneWindow({
      soundId: "abstract-sound1",
    });

    expect(sent).toBe(true);
    expect(focusedSend).toHaveBeenCalledWith(
      PIER_BROADCAST.ATTENTION_SOUND_PLAY,
      { soundId: "abstract-sound1" }
    );
    expect(otherSend).not.toHaveBeenCalled();
  });

  it("falls back to first live window when none focused", () => {
    const firstSend = vi.fn();
    const secondSend = vi.fn();
    windowManager.__setWindows([makeWindow(firstSend), makeWindow(secondSend)]);

    const sent = sendAttentionSoundPlayToOneWindow({ soundId: "rooster" });

    expect(sent).toBe(true);
    expect(firstSend).toHaveBeenCalledTimes(1);
    expect(secondSend).not.toHaveBeenCalled();
  });

  it("returns false when no windows exist", () => {
    expect(
      sendAttentionSoundPlayToOneWindow({ soundId: "abstract-sound1" })
    ).toBe(false);
  });

  it("returns false when the only window is destroyed", () => {
    const send = vi.fn();
    windowManager.__setWindows([makeWindow(send, { destroyed: true })]);
    expect(
      sendAttentionSoundPlayToOneWindow({ soundId: "abstract-sound1" })
    ).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("returns false when target webContents is destroyed", () => {
    const send = vi.fn();
    windowManager.__setWindows([
      makeWindow(send, { focused: true, webContentsDestroyed: true }),
    ]);
    expect(
      sendAttentionSoundPlayToOneWindow({ soundId: "abstract-sound1" })
    ).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});

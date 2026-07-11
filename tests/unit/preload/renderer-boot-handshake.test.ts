import { installRendererBootHandshake } from "@preload/renderer-boot-handshake.ts";
import { describe, expect, it, vi } from "vitest";

function fixture() {
  let challengeListener: ((event: unknown, challenge: unknown) => void) | null =
    null;
  const ipcRenderer = {
    on: vi.fn((_channel: string, listener: typeof challengeListener) => {
      challengeListener = listener;
      return ipcRenderer;
    }),
    send: vi.fn(),
  };
  const mounted = installRendererBootHandshake(ipcRenderer as never);
  return {
    challenge: (value: unknown) => challengeListener?.({}, value),
    ipcRenderer,
    mounted,
  };
}

describe("renderer boot handshake", () => {
  it("acknowledges a challenge that arrives after the shell mounts", () => {
    const { challenge, ipcRenderer, mounted } = fixture();
    mounted();
    challenge("navigation-2");

    expect(ipcRenderer.send).toHaveBeenCalledWith(
      "pier://window:renderer-ready",
      "navigation-2"
    );
  });

  it("waits for the shell when the challenge arrives first", () => {
    const { challenge, ipcRenderer, mounted } = fixture();
    challenge("navigation-2");
    expect(ipcRenderer.send).not.toHaveBeenCalled();

    mounted();

    expect(ipcRenderer.send).toHaveBeenCalledWith(
      "pier://window:renderer-ready",
      "navigation-2"
    );
  });

  it("ignores malformed and already acknowledged challenges", () => {
    const { challenge, ipcRenderer, mounted } = fixture();
    mounted();
    challenge(1);
    challenge("");
    challenge("navigation-2");
    mounted();

    expect(ipcRenderer.send).toHaveBeenCalledTimes(1);
  });
});

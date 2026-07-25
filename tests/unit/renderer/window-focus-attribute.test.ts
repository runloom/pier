import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installWindowFocusAttribute,
  isWindowKeyFocused,
  resetWindowFocusAttributeForTests,
  WINDOW_FOCUSED_ATTR,
} from "@/lib/window-focus-attribute.ts";

describe("installWindowFocusAttribute", () => {
  let dispose: (() => void) | undefined;
  let focusListeners: Array<(payload: { focused: boolean }) => void>;
  let getContext: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetWindowFocusAttributeForTests();
    dispose = undefined;
    focusListeners = [];
    getContext = vi.fn(async () => ({ focused: true }));

    const pierWindow = {
      getContext,
      onFocusChanged: (cb: (payload: { focused: boolean }) => void) => {
        focusListeners.push(cb);
        return () => {
          focusListeners = focusListeners.filter((listener) => listener !== cb);
        };
      },
    };

    // Attach to existing jsdom window — do not replace the Window object.
    (
      globalThis.window as unknown as {
        pier?: { window?: typeof pierWindow };
      }
    ).pier = { window: pierWindow };
  });

  afterEach(() => {
    dispose?.();
    resetWindowFocusAttributeForTests();
    const win = globalThis.window as unknown as { pier?: unknown };
    win.pier = undefined;
    vi.restoreAllMocks();
  });

  it("defaults to focused until main seed arrives", () => {
    getContext.mockReturnValue(new Promise(() => undefined));
    dispose = installWindowFocusAttribute();
    expect(document.documentElement.getAttribute(WINDOW_FOCUSED_ATTR)).toBe(
      "true"
    );
  });

  it("seeds from window.getContext().focused", async () => {
    getContext.mockResolvedValue({ focused: false });
    dispose = installWindowFocusAttribute();
    await vi.waitFor(() => {
      expect(document.documentElement.getAttribute(WINDOW_FOCUSED_ATTR)).toBe(
        "false"
      );
    });
  });

  it("ignores a late getContext seed after a live focus event", async () => {
    let resolveSeed!: (value: { focused: boolean }) => void;
    getContext.mockReturnValue(
      new Promise<{ focused: boolean }>((resolve) => {
        resolveSeed = resolve;
      })
    );

    dispose = installWindowFocusAttribute();
    expect(focusListeners).toHaveLength(1);

    // Window becomes key before the seed IPC returns (showInactive → focus).
    for (const listener of focusListeners) {
      listener({ focused: true });
    }
    expect(document.documentElement.getAttribute(WINDOW_FOCUSED_ATTR)).toBe(
      "true"
    );

    // Stale seed that sampled isFocused() === false must not demote S3.
    resolveSeed({ focused: false });
    await Promise.resolve();
    await Promise.resolve();

    expect(document.documentElement.getAttribute(WINDOW_FOCUSED_ATTR)).toBe(
      "true"
    );
  });

  it("follows main onFocusChanged (OS key-window), not DOM blur", async () => {
    dispose = installWindowFocusAttribute();
    await Promise.resolve();

    for (const listener of focusListeners) {
      listener({ focused: false });
    }
    expect(document.documentElement.getAttribute(WINDOW_FOCUSED_ATTR)).toBe(
      "false"
    );

    for (const listener of focusListeners) {
      listener({ focused: true });
    }
    expect(document.documentElement.getAttribute(WINDOW_FOCUSED_ATTR)).toBe(
      "true"
    );

    // DOM blur must not demote — native terminal FR would fire this while key.
    window.dispatchEvent(new Event("blur"));
    await Promise.resolve();
    expect(document.documentElement.getAttribute(WINDOW_FOCUSED_ATTR)).toBe(
      "true"
    );
  });

  it("is idempotent for a second install in the same document", () => {
    dispose = installWindowFocusAttribute();
    const second = installWindowFocusAttribute();
    second();
    expect(document.documentElement.getAttribute(WINDOW_FOCUSED_ATTR)).toBe(
      "true"
    );
    expect(focusListeners).toHaveLength(1);
  });

  it("isWindowKeyFocused tracks OS key-window state for chrome/CSS", async () => {
    dispose = installWindowFocusAttribute();
    expect(isWindowKeyFocused()).toBe(true);
    for (const listener of focusListeners) {
      listener({ focused: false });
    }
    expect(isWindowKeyFocused()).toBe(false);
    for (const listener of focusListeners) {
      listener({ focused: true });
    }
    expect(isWindowKeyFocused()).toBe(true);
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  isTabRevealSuppressed,
  withSuppressedTabReveal,
} from "@/lib/workspace/tab-reveal-suppress.ts";
import { activateTerminalPanelFromFocusRequest } from "@/lib/workspace/terminal-focus-request.ts";

describe("tab reveal suppress", () => {
  it("nests suppress depth and restores after the callback", () => {
    expect(isTabRevealSuppressed()).toBe(false);
    withSuppressedTabReveal(() => {
      expect(isTabRevealSuppressed()).toBe(true);
      withSuppressedTabReveal(() => {
        expect(isTabRevealSuppressed()).toBe(true);
      });
      expect(isTabRevealSuppressed()).toBe(true);
    });
    expect(isTabRevealSuppressed()).toBe(false);
  });

  it("suppresses during terminal focus request activation", () => {
    const setActive = vi.fn(() => {
      expect(isTabRevealSuppressed()).toBe(true);
    });
    activateTerminalPanelFromFocusRequest(
      {
        panels: [
          {
            api: { setActive },
            id: "terminal-1",
            view: { contentComponent: "terminal" },
          },
        ],
      },
      "terminal-1"
    );
    expect(setActive).toHaveBeenCalledOnce();
    expect(isTabRevealSuppressed()).toBe(false);
  });
});

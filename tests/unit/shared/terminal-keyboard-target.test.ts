import {
  computeEffectiveKeyboardTarget,
  isResidualStickyWebFocus,
  TRANSIENT_WEB_CLICK_FOCUS_ID,
} from "@shared/terminal-keyboard-target.ts";
import { describe, expect, it } from "vitest";

describe("isResidualStickyWebFocus", () => {
  const terminalBase = {
    kind: "terminal" as const,
    panelId: "terminal-1",
  };

  it("is true only when base is terminal and ids are solely pier.click", () => {
    expect(
      isResidualStickyWebFocus({
        basePanel: terminalBase,
        webRequestCount: 1,
        webRequestIds: [TRANSIENT_WEB_CLICK_FOCUS_ID],
      })
    ).toBe(true);
  });

  it("is false for intentional durable overlays", () => {
    expect(
      isResidualStickyWebFocus({
        basePanel: terminalBase,
        webRequestCount: 1,
        webRequestIds: ["settings-dialog"],
      })
    ).toBe(false);
    expect(
      isResidualStickyWebFocus({
        basePanel: terminalBase,
        webRequestCount: 2,
        webRequestIds: ["settings-dialog", TRANSIENT_WEB_CLICK_FOCUS_ID],
      })
    ).toBe(false);
  });

  it("is false without webRequestIds (avoid false positive)", () => {
    expect(
      isResidualStickyWebFocus({
        basePanel: terminalBase,
        webRequestCount: 1,
      })
    ).toBe(false);
  });

  it("is false when base is web", () => {
    expect(
      isResidualStickyWebFocus({
        basePanel: { kind: "web" },
        webRequestCount: 1,
        webRequestIds: [TRANSIENT_WEB_CLICK_FOCUS_ID],
      })
    ).toBe(false);
  });

  it("effective still follows webRequestCount", () => {
    expect(computeEffectiveKeyboardTarget(terminalBase, 1).kind).toBe("web");
    expect(computeEffectiveKeyboardTarget(terminalBase, 0)).toEqual(
      terminalBase
    );
  });
});

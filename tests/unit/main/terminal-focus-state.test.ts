import { describe, expect, it } from "vitest";
import { computeEffectiveKeyboardTarget } from "@main/ipc/terminal-presentation.ts";

describe("computeEffectiveKeyboardTarget", () => {
  it("is web when webRequestCount > 0 even if basePanel is terminal", () => {
    const effective = computeEffectiveKeyboardTarget(
      { kind: "terminal", panelId: "terminal-1" },
      1
    );
    expect(effective).toEqual({ kind: "web" });
  });

  it("follows basePanel when there are no web requests", () => {
    const effective = computeEffectiveKeyboardTarget(
      { kind: "terminal", panelId: "terminal-1" },
      0
    );
    expect(effective).toEqual({ kind: "terminal", panelId: "terminal-1" });
  });

  it("stays web when basePanel is web regardless of request count", () => {
    expect(computeEffectiveKeyboardTarget({ kind: "web" }, 0)).toEqual({
      kind: "web",
    });
    expect(computeEffectiveKeyboardTarget({ kind: "web" }, 3)).toEqual({
      kind: "web",
    });
  });
});

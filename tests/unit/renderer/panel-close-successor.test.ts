import { describe, expect, it, vi } from "vitest";
import {
  activatePanelCloseSuccessor,
  pickPanelCloseSuccessor,
} from "@/lib/workspace/panel-close-successor.ts";

function panel(id: string) {
  return {
    api: { setActive: vi.fn() },
    id,
  };
}

describe("pickPanelCloseSuccessor", () => {
  it("prefers the right neighbor in tab order", () => {
    const a = panel("a");
    const b = panel("b");
    const c = panel("c");
    expect(pickPanelCloseSuccessor([a, b, c], "b")).toBe(c);
  });

  it("falls back to the left neighbor when closing the rightmost tab", () => {
    const a = panel("a");
    const b = panel("b");
    const c = panel("c");
    expect(pickPanelCloseSuccessor([a, b, c], "c")).toBe(b);
  });

  it("returns null when the group has no other panels", () => {
    const only = panel("only");
    expect(pickPanelCloseSuccessor([only], "only")).toBeNull();
  });

  it("returns null when the closing panel is not in the group list", () => {
    const a = panel("a");
    expect(pickPanelCloseSuccessor([a], "missing")).toBeNull();
  });
});

describe("activatePanelCloseSuccessor", () => {
  it("activates the right neighbor when closing the active panel", () => {
    const a = panel("a");
    const b = panel("b");
    const c = panel("c");

    const result = activatePanelCloseSuccessor({
      activePanelId: "b",
      closingPanelId: "b",
      groupPanels: [a, b, c],
    });

    expect(result).toBe(c);
    expect(c.api.setActive).toHaveBeenCalledOnce();
    expect(a.api.setActive).not.toHaveBeenCalled();
    expect(b.api.setActive).not.toHaveBeenCalled();
  });

  it("does not change active when closing an inactive panel", () => {
    const a = panel("a");
    const b = panel("b");
    const c = panel("c");

    const result = activatePanelCloseSuccessor({
      activePanelId: "a",
      closingPanelId: "c",
      groupPanels: [a, b, c],
    });

    expect(result).toBeNull();
    expect(a.api.setActive).not.toHaveBeenCalled();
    expect(b.api.setActive).not.toHaveBeenCalled();
    expect(c.api.setActive).not.toHaveBeenCalled();
  });

  it("activates the left neighbor when the active panel is rightmost", () => {
    const a = panel("a");
    const b = panel("b");

    const result = activatePanelCloseSuccessor({
      activePanelId: "b",
      closingPanelId: "b",
      groupPanels: [a, b],
    });

    expect(result).toBe(a);
    expect(a.api.setActive).toHaveBeenCalledOnce();
  });

  it("does not pre-activate when policy is recent (dockview MRU)", () => {
    const a = panel("a");
    const b = panel("b");
    const c = panel("c");

    const result = activatePanelCloseSuccessor({
      activePanelId: "b",
      closingPanelId: "b",
      groupPanels: [a, b, c],
      policy: "recent",
    });

    expect(result).toBeNull();
    expect(a.api.setActive).not.toHaveBeenCalled();
    expect(c.api.setActive).not.toHaveBeenCalled();
  });
});

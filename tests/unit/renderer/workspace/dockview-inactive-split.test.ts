import { describe, expect, it, vi } from "vitest";
import { showInactiveSplitPanel } from "@/components/workspace/dockview-inactive-split.ts";

describe("showInactiveSplitPanel", () => {
  it("opens the panel in a new split group without activating the group", () => {
    const openPanel = vi.fn();
    const panel = {
      group: {
        activePanel: undefined,
        model: { openPanel },
      },
      id: "terminal-new",
    };
    const getPanel = vi.fn(() => panel);

    showInactiveSplitPanel({ getPanel } as never, "terminal-new");

    expect(openPanel).toHaveBeenCalledWith(panel, { skipSetGroupActive: true });
  });

  it("does not steal an existing group's active tab", () => {
    const openPanel = vi.fn();
    const leader = { id: "leader" };
    const panel = {
      group: {
        activePanel: leader,
        model: { openPanel },
      },
      id: "terminal-hidden",
    };

    showInactiveSplitPanel(
      { getPanel: vi.fn(() => panel) } as never,
      "terminal-hidden"
    );

    expect(openPanel).not.toHaveBeenCalled();
  });

  it("no-ops when the panel is missing", () => {
    expect(() =>
      showInactiveSplitPanel(
        { getPanel: vi.fn(() => undefined) } as never,
        "missing"
      )
    ).not.toThrow();
  });
});

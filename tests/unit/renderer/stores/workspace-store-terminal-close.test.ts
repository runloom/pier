import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

function terminalPanel(id: string) {
  return {
    id,
    title: "Terminal",
    view: { contentComponent: "terminal" },
  };
}

describe("workspace terminal close lifecycle", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        terminal: { close: vi.fn() },
      },
    });
    useWorkspaceStore.getState().setApi(null);
  });

  it("closes the native terminal when a terminal panel is explicitly closed", () => {
    const panel = terminalPanel("terminal-1");
    const api = {
      activePanel: panel,
      panels: [panel, { ...terminalPanel("terminal-2"), id: "welcome-1" }],
      removePanel: vi.fn(),
      totalPanels: 2,
    };

    useWorkspaceStore.getState().setApi(api as never);

    useWorkspaceStore.getState().closePanel("terminal-1");

    expect(window.pier.terminal.close).toHaveBeenCalledWith("terminal-1");
    expect(api.removePanel).toHaveBeenCalledWith(panel);
  });
});

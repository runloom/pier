import { describe, expect, it, vi } from "vitest";
import { activateTerminalPanelFromFocusRequest } from "@/lib/workspace/terminal-focus-request.ts";

describe("activateTerminalPanelFromFocusRequest", () => {
  it("activates only the requested terminal panel", () => {
    const terminalSetActive = vi.fn();
    const webSetActive = vi.fn();
    const api = {
      panels: [
        {
          api: { setActive: webSetActive },
          id: "web-1",
          view: { contentComponent: "web" },
        },
        {
          api: { setActive: terminalSetActive },
          id: "terminal-2",
          view: { contentComponent: "terminal" },
        },
      ],
    };

    const didActivate = activateTerminalPanelFromFocusRequest(
      api,
      "terminal-2"
    );

    expect(didActivate).toBe(true);
    expect(terminalSetActive).toHaveBeenCalledOnce();
    expect(webSetActive).not.toHaveBeenCalled();
  });

  it("ignores unknown panels and non-terminal panels", () => {
    const setActive = vi.fn();
    const api = {
      panels: [
        {
          api: { setActive },
          id: "web-1",
          view: { contentComponent: "web" },
        },
      ],
    };

    expect(activateTerminalPanelFromFocusRequest(api, "missing")).toBe(false);
    expect(activateTerminalPanelFromFocusRequest(api, "web-1")).toBe(false);
    expect(setActive).not.toHaveBeenCalled();
  });
});

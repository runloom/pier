import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InputRoutingTraceSummary } from "@/components/common/terminal-debug/input-routing-trace-summary.tsx";

describe("InputRoutingTraceSummary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows drag completion and keybinding dispatch details and copies the sanitized trace", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(
      async () => undefined
    );
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(
      <InputRoutingTraceSummary
        trace={{
          events: [
            {
              action: "fallback-timeout",
              at: 10,
              elapsedMs: 5000,
              panelId: "terminal-1",
              reason: "fallback-timeout",
              seq: 1,
              sessionId: "dockview-tab-drag:1",
              source: "workspace-tab-drag",
              webOwnerCount: 0,
            },
            {
              action: "dispatched",
              at: 11,
              commandId: "pier.commandPalette.open",
              overlayCount: 0,
              route: "native-forward",
              seq: 2,
              source: "keybinding",
            },
          ],
        }}
      />
    );

    expect(screen.getByText("Input Routing Trace")).toBeVisible();
    expect(screen.getByText(/dockview-tab-drag:1/)).toBeVisible();
    expect(screen.getByText(/fallback-timeout/)).toBeVisible();
    expect(screen.getByText(/pier.commandPalette.open/)).toBeVisible();
    expect(screen.getByText(/native-forward/)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Copy input trace" }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining("dockview-tab-drag:1")
      )
    );
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining("pier.commandPalette.open")
    );
    expect(writeText.mock.calls[0]?.[0]).not.toContain("chars=");
    expect(writeText.mock.calls[0]?.[0]).not.toContain("key=");
  });
});

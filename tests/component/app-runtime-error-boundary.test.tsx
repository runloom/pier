import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const routingMocks = vi.hoisted(() => ({
  dispose: vi.fn(),
  popBlockingScope: vi.fn(),
  pushBlockingScope: vi.fn(),
  registerFullscreenOverlay: vi.fn(),
  releaseFocus: vi.fn(),
  requestWebFocus: vi.fn(),
}));

vi.mock("@/stores/keybinding-scope.store.ts", () => ({
  useKeybindingScope: {
    getState: () => ({
      popBlockingScope: routingMocks.popBlockingScope,
      pushBlockingScope: routingMocks.pushBlockingScope,
    }),
  },
}));

vi.mock("@/stores/terminal-input-routing-slice.ts", () => ({
  registerTerminalFullscreenWebOverlay: routingMocks.registerFullscreenOverlay,
  requestTerminalWebFocus: routingMocks.requestWebFocus,
}));

import { AppRuntimeErrorBoundary } from "@/components/common/app-runtime-error-boundary.tsx";

function BrokenWorkspace(): never {
  throw new Error("panel descriptor render failed");
}

describe("AppRuntimeErrorBoundary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    Reflect.deleteProperty(window, "pier");
  });

  it("replaces a failed app tree with an interactive full-window recovery screen", () => {
    document.documentElement.lang = "en";
    const retry = vi.fn();
    const reportRuntimeFailure = vi.fn();
    routingMocks.registerFullscreenOverlay.mockReturnValue({
      dispose: routingMocks.dispose,
      flush: vi.fn(),
    });
    routingMocks.requestWebFocus.mockReturnValue(routingMocks.releaseFocus);
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: { window: { reportRuntimeFailure } },
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    const view = render(
      <AppRuntimeErrorBoundary onRetry={retry}>
        <BrokenWorkspace />
      </AppRuntimeErrorBoundary>
    );

    expect(
      screen.getByRole("heading", {
        name: "Interface error",
      })
    ).toBeVisible();
    expect(
      screen.getByText("Terminal sessions are preserved. Reload to continue.")
    ).toBeVisible();
    expect(view.container.querySelector('[data-slot="empty"]')).not.toBeNull();
    expect(screen.getByText(/panel descriptor render failed/)).toBeVisible();
    // useLayoutEffect: input ownership is claimed before paint/yield.
    expect(routingMocks.registerFullscreenOverlay).toHaveBeenCalledWith(
      "app-runtime-error"
    );
    expect(routingMocks.requestWebFocus).toHaveBeenCalledWith(
      "app-runtime-error"
    );
    expect(routingMocks.pushBlockingScope).toHaveBeenCalledWith(
      "overlay:app-runtime-error"
    );
    expect(reportRuntimeFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "panel descriptor render failed",
        name: "Error",
        stack: expect.stringContaining("panel descriptor render failed"),
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(retry).toHaveBeenCalledOnce();

    view.unmount();
    expect(routingMocks.popBlockingScope).toHaveBeenCalledWith(
      "overlay:app-runtime-error"
    );
    expect(routingMocks.releaseFocus).toHaveBeenCalledOnce();
    expect(routingMocks.dispose).toHaveBeenCalledOnce();
  });
});

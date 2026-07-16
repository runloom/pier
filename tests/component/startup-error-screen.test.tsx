import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  StartupErrorScreen,
  StartupScreen,
} from "@/components/common/startup-error-screen.tsx";

describe("startup screens", () => {
  it("shows a visible startup state before core initialization finishes", () => {
    document.documentElement.lang = "en";
    render(<StartupScreen />);

    expect(screen.getByText("Starting Pier…")).toBeVisible();
  });

  it("shows fatal details and retries exactly once", () => {
    document.documentElement.lang = "en";
    const retry = vi.fn();
    const { container } = render(
      <StartupErrorScreen
        error={new Error("preload unavailable")}
        onRetry={retry}
      />
    );

    expect(
      screen.getByRole("heading", { name: "Pier failed to start" })
    ).toBeVisible();
    expect(screen.getByText(/preload unavailable/)).toBeVisible();
    expect(container.querySelector('[data-slot="alert"]')).toBeNull();
    expect(container.querySelector('[data-scrollbar="stable"]')).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("prefers pier.app.relaunch over location.reload for the default retry", () => {
    document.documentElement.lang = "en";
    const relaunch = vi.fn(async () => undefined);
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: { app: { relaunch } },
    });

    render(<StartupErrorScreen error={new Error("boot failed")} />);
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));

    expect(relaunch).toHaveBeenCalledOnce();
    Reflect.deleteProperty(window, "pier");
  });

  it("includes nested AggregateError details", () => {
    document.documentElement.lang = "en";
    render(
      <StartupErrorScreen
        error={
          new AggregateError(
            [new Error("builtin files activation failed")],
            "renderer plugin refresh failed"
          )
        }
        onRetry={vi.fn()}
      />
    );

    expect(screen.getByText(/builtin files activation failed/)).toBeVisible();
  });
});

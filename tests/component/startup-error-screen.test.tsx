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
    render(
      <StartupErrorScreen
        error={new Error("preload unavailable")}
        onRetry={retry}
      />
    );

    expect(
      screen.getByRole("heading", { name: "Pier failed to start" })
    ).toBeVisible();
    expect(screen.getByText(/preload unavailable/)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(retry).toHaveBeenCalledOnce();
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

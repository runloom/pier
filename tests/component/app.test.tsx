import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/common/app-shell.tsx", () => ({
  AppShell: () => <div data-testid="app-shell" />,
}));

vi.mock("@/components/primitives/tooltip.tsx", () => ({
  TooltipProvider: ({
    children,
    delayDuration,
    disableHoverableContent,
  }: {
    children: ReactNode;
    delayDuration?: number;
    disableHoverableContent?: boolean;
  }) => (
    <div
      data-delay-duration={delayDuration}
      data-disable-hoverable-content={String(disableHoverableContent)}
      data-testid="tooltip-provider"
    >
      {children}
    </div>
  ),
}));

import { App } from "@/App.tsx";

describe("App", () => {
  it("owns the global tooltip provider defaults", () => {
    render(<App />);

    expect(screen.getByTestId("tooltip-provider")).toHaveAttribute(
      "data-delay-duration",
      "0"
    );
    expect(screen.getByTestId("tooltip-provider")).toHaveAttribute(
      "data-disable-hoverable-content",
      "true"
    );
    expect(screen.getByTestId("app-shell")).toBeInTheDocument();
  });
});

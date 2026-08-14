// @vitest-environment jsdom

import { TooltipProvider } from "@pier/ui/tooltip.tsx";
import {
  markCanvasActive,
  requestCanvasReload,
  unmarkCanvasActive,
} from "@plugins/builtin/files/renderer/preview/canvas-chrome-store.ts";
import { CanvasReloadButton } from "@plugins/builtin/files/renderer/preview/canvas-toolbar.tsx";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

const MODULE = "toolbar.canvas.tsx";
const t = (key: string, fallback?: string) => fallback ?? key;

describe("CanvasReloadButton", () => {
  afterEach(() => {
    act(() => {
      unmarkCanvasActive(MODULE);
    });
  });

  it("spins and disables while a user reload is in flight", () => {
    act(() => {
      markCanvasActive(MODULE);
      requestCanvasReload(MODULE);
    });
    render(
      <TooltipProvider>
        <CanvasReloadButton moduleId={MODULE} t={t} />
      </TooltipProvider>
    );
    const button = screen.getByRole("button", { name: "Reload" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(
      button.querySelector("svg")?.classList.contains("animate-spin")
    ).toBe(true);
  });
});

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@pier/ui/tooltip.tsx";
import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("Tooltip primitive", () => {
  beforeEach(() => {
    class ResizeObserverMock {
      disconnect(): void {
        // Test polyfill no-op.
      }
      observe(): void {
        // Test polyfill no-op.
      }
      unobserve(): void {
        // Test polyfill no-op.
      }
    }
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses compact sizing while keeping the existing visual language", async () => {
    render(
      <TooltipProvider>
        <Tooltip defaultOpen>
          <TooltipTrigger asChild>
            <button type="button">Trigger</button>
          </TooltipTrigger>
          <TooltipContent>Compact help</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );

    const tooltip = await waitFor(() => {
      const content = document.querySelector('[data-slot="tooltip-content"]');
      expect(content).not.toBeNull();
      return content as HTMLElement;
    });
    expect(tooltip).toHaveTextContent("Compact help");
    expect(tooltip).toHaveAttribute("data-slot", "tooltip-content");
    expect(tooltip).toHaveClass(
      "max-w-64",
      "gap-1",
      "px-2",
      "py-1",
      "text-[11px]",
      "leading-snug"
    );
    expect(tooltip).toHaveClass(
      "bg-foreground",
      "text-background",
      "rounded-xl"
    );
    expect(tooltip.querySelector("svg")).toBeNull();
    expect(tooltip).toHaveClass(
      "before:content-['']",
      "before:pointer-events-none",
      "before:absolute",
      "before:size-2.5",
      "before:rotate-45",
      "before:bg-foreground",
      "before:left-1/2",
      "before:-translate-x-1/2",
      "data-[side=bottom]:before:top-0",
      "data-[side=top]:before:bottom-0"
    );
  });

  it("keeps a content-owned arrow aligned to the trigger for start alignment", async () => {
    render(
      <TooltipProvider>
        <Tooltip defaultOpen>
          <TooltipTrigger asChild>
            <button type="button">Trigger</button>
          </TooltipTrigger>
          <TooltipContent align="start" side="bottom">
            Compact help
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );

    const tooltip = await waitFor(() => {
      const content = document.querySelector('[data-slot="tooltip-content"]');
      expect(content).not.toBeNull();
      return content as HTMLElement;
    });
    expect(tooltip.querySelector("svg")).toBeNull();
    expect(tooltip).toHaveClass(
      "before:left-[calc(var(--radix-tooltip-trigger-width)/2)]",
      "before:-translate-x-1/2"
    );
  });
});

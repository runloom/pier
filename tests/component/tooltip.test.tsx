import {
  dismissAllTooltips,
  releaseTooltipSuppression,
  resetTooltipDismissStateForTests,
  suppressTooltips,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@pier/ui/tooltip.tsx";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function findTooltipContent(): Promise<HTMLElement> {
  return waitFor(() => {
    const content = document.querySelector('[data-slot="tooltip-content"]');
    expect(content).not.toBeNull();
    return content as HTMLElement;
  });
}

async function expectTooltipClosed(): Promise<void> {
  await waitFor(() => {
    expect(document.querySelector('[data-slot="tooltip-content"]')).toBeNull();
  });
}

function expectNoManualHorizontalArrowClasses(tooltip: HTMLElement): void {
  expect(
    Array.from(tooltip.classList).filter(
      (className) =>
        className.startsWith("before:left-") ||
        className.startsWith("before:right-")
    )
  ).toEqual([]);
}

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
    resetTooltipDismissStateForTests();
  });

  afterEach(() => {
    resetTooltipDismissStateForTests();
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

    const tooltip = await findTooltipContent();
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
    expectNoManualHorizontalArrowClasses(tooltip);
  });

  it.each([
    ["top center", "top", "center"],
    ["bottom center", "bottom", "center"],
    ["bottom start", "bottom", "start"],
    ["bottom end", "bottom", "end"],
  ] as const)("delegates %s arrow placement to Radix instead of manual pseudo-element offsets", async (_name, side, align) => {
    render(
      <TooltipProvider>
        <Tooltip defaultOpen>
          <TooltipTrigger asChild>
            <button type="button">Trigger with a wider label</button>
          </TooltipTrigger>
          <TooltipContent align={align} side={side}>
            ?
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );

    const tooltip = await findTooltipContent();
    expect(tooltip).toHaveTextContent("?");
    expect(tooltip.querySelector('[data-slot="tooltip-arrow"]')).not.toBeNull();
    expectNoManualHorizontalArrowClasses(tooltip);
  });

  it('does not render an arrow for side="right" without manual horizontal pseudo-arrow classes', async () => {
    render(
      <TooltipProvider>
        <Tooltip defaultOpen>
          <TooltipTrigger asChild>
            <button type="button">Trigger on the left</button>
          </TooltipTrigger>
          <TooltipContent side="right">Right-side help</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );

    const tooltip = await findTooltipContent();
    expect(tooltip).toHaveTextContent("Right-side help");
    expect(tooltip.querySelector('[data-slot="tooltip-arrow"]')).toBeNull();
    expectNoManualHorizontalArrowClasses(tooltip);
  });

  it("dismissAllTooltips closes an open tooltip", async () => {
    render(
      <TooltipProvider>
        <Tooltip defaultOpen>
          <TooltipTrigger asChild>
            <button type="button">Trigger</button>
          </TooltipTrigger>
          <TooltipContent>Help</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );

    await findTooltipContent();
    act(() => {
      dismissAllTooltips();
    });
    await expectTooltipClosed();
  });

  it("suppresses open attempts until release and a fresh hover", async () => {
    const { getByRole } = render(
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button">Trigger</button>
          </TooltipTrigger>
          <TooltipContent>Help</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );

    const trigger = getByRole("button");
    act(() => {
      suppressTooltips();
    });

    fireEvent.pointerMove(trigger);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(document.querySelector('[data-slot="tooltip-content"]')).toBeNull();

    act(() => {
      releaseTooltipSuppression();
    });
    // Soft-suppress holds until a pointermove that is not itself a reopen.
    fireEvent.pointerMove(document.body);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(document.querySelector('[data-slot="tooltip-content"]')).toBeNull();

    // Radix only re-enters after leave clears hasPointerMoveOpenedRef.
    fireEvent.pointerLeave(trigger);
    fireEvent.pointerMove(trigger);
    await findTooltipContent();
  });

  it("closes on document pointerdown / keydown / window blur", async () => {
    render(
      <TooltipProvider>
        <Tooltip defaultOpen>
          <TooltipTrigger asChild>
            <button type="button">Trigger</button>
          </TooltipTrigger>
          <TooltipContent>Help</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );

    await findTooltipContent();
    fireEvent.pointerDown(document.body);
    await expectTooltipClosed();

    // Re-open via controlled path for the next signal.
    const view = render(
      <TooltipProvider>
        <Tooltip defaultOpen>
          <TooltipTrigger asChild>
            <button type="button">Trigger 2</button>
          </TooltipTrigger>
          <TooltipContent>Help 2</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
    await findTooltipContent();
    fireEvent.keyDown(document.body, { key: "Escape" });
    await expectTooltipClosed();
    view.unmount();

    render(
      <TooltipProvider>
        <Tooltip defaultOpen>
          <TooltipTrigger asChild>
            <button type="button">Trigger 3</button>
          </TooltipTrigger>
          <TooltipContent>Help 3</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
    await findTooltipContent();
    fireEvent.blur(window);
    await expectTooltipClosed();
  });
});

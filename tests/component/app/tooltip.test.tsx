import {
  dismissAllTooltips,
  releaseTooltipSuppression,
  resetTooltipDismissStateForTests,
  suppressTooltips,
  TOOLTIP_ARROW_CLASS,
  TOOLTIP_ARROW_LAYOUT_HEIGHT_PX,
  TOOLTIP_ARROW_PADDING_PX,
  TOOLTIP_ARROW_SIZE_PX,
  TOOLTIP_COLLISION_PADDING,
  TOOLTIP_COLLISION_PADDING_PX,
  TOOLTIP_COLLISION_PADDING_X_PX,
  TOOLTIP_SIDE_OFFSET_PX,
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
function waitForDelay(milliseconds: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, milliseconds);
  return promise;
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
      "leading-snug",
      "pointer-events-none"
    );
    expect(tooltip).toHaveClass(
      "bg-foreground",
      "text-background",
      "rounded-xl"
    );
    // Gold standard: fade only — zoom fights Floating UI placement transform.
    expect(tooltip.className).not.toMatch(/zoom-in-95|zoom-out-95/);
    expect(tooltip.className).not.toMatch(/slide-in-from-/);
    expectNoManualHorizontalArrowClasses(tooltip);
  });

  it("locks product gold-standard placement defaults", () => {
    expect(TOOLTIP_SIDE_OFFSET_PX).toBe(6);
    expect(TOOLTIP_COLLISION_PADDING_PX).toBe(8);
    expect(TOOLTIP_COLLISION_PADDING_X_PX).toBe(6);
    expect(TOOLTIP_COLLISION_PADDING).toEqual({
      top: 8,
      right: 6,
      bottom: 8,
      left: 6,
    });
    expect(TOOLTIP_ARROW_PADDING_PX).toBe(12);
    expect(TOOLTIP_ARROW_SIZE_PX).toBe(10);
    expect(TOOLTIP_ARROW_LAYOUT_HEIGHT_PX).toBe(5);
    expect(TOOLTIP_ARROW_CLASS).toContain("rotate-45");
    expect(TOOLTIP_ARROW_CLASS).toContain("bg-foreground");
    expect(TOOLTIP_ARROW_CLASS).toContain("-translate-y-1/2");
  });

  it.each([
    ["top center", "top", "center"],
    ["top start", "top", "start"],
    ["top end", "top", "end"],
    ["bottom center", "bottom", "center"],
    ["bottom start", "bottom", "start"],
    ["bottom end", "bottom", "end"],
  ] as const)("keeps a vertical arrow for %s including edge aligns", async (_name, side, align) => {
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
    const arrow = tooltip.querySelector('[data-slot="tooltip-arrow"]');
    expect(arrow).not.toBeNull();
    expect(arrow).toHaveClass("rotate-45", "bg-foreground");
    expectNoManualHorizontalArrowClasses(tooltip);
  });

  it.each([
    "left",
    "right",
  ] as const)("hides the caret for horizontal side=%s without manual pseudo-arrows", async (side) => {
    render(
      <TooltipProvider>
        <Tooltip defaultOpen>
          <TooltipTrigger asChild>
            <button type="button">Trigger on the {side}</button>
          </TooltipTrigger>
          <TooltipContent side={side}>Side help</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );

    const tooltip = await findTooltipContent();
    expect(tooltip).toHaveTextContent("Side help");
    expect(tooltip).toHaveAttribute("data-side", side);
    expect(tooltip.querySelector('[data-slot="tooltip-arrow"]')).not.toBeNull();
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
    await waitForDelay(20);
    expect(document.querySelector('[data-slot="tooltip-content"]')).toBeNull();

    act(() => {
      releaseTooltipSuppression();
    });
    // Soft-suppress holds until a pointermove that is not itself a reopen.
    fireEvent.pointerMove(document.body);
    await waitForDelay(20);
    expect(document.querySelector('[data-slot="tooltip-content"]')).toBeNull();

    // Radix only re-enters after leave clears hasPointerMoveOpenedRef.
    fireEvent.pointerLeave(trigger);
    fireEvent.pointerMove(trigger);
    await findTooltipContent();
  });

  it("hard suppress blocks hover for the full suppress lifetime", async () => {
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
    fireEvent.pointerMove(document.body);
    fireEvent.pointerLeave(trigger);
    fireEvent.pointerMove(trigger);
    await waitForDelay(20);
    expect(document.querySelector('[data-slot="tooltip-content"]')).toBeNull();

    act(() => {
      releaseTooltipSuppression();
    });
    fireEvent.pointerMove(document.body);
    fireEvent.pointerLeave(trigger);
    fireEvent.pointerMove(trigger);
    expect(await findTooltipContent()).toHaveTextContent("Help");
  });

  it("suppresses pointer-driven focus reopen while preserving later hover", async () => {
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

    fireEvent.pointerDown(trigger);
    fireEvent.pointerMove(document.body);
    fireEvent.focus(trigger);
    expect(document.querySelector('[data-slot="tooltip-content"]')).toBeNull();

    fireEvent.pointerLeave(trigger);
    fireEvent.pointerMove(trigger);
    expect(await findTooltipContent()).toHaveTextContent("Help");
  });

  it("keeps a clicked tooltip closed until pointer leave and reentry", async () => {
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

    fireEvent.pointerMove(trigger);
    expect(await findTooltipContent()).toHaveTextContent("Help");
    fireEvent.pointerDown(trigger);
    await expectTooltipClosed();

    fireEvent.pointerMove(trigger);
    expect(document.querySelector('[data-slot="tooltip-content"]')).toBeNull();

    fireEvent.pointerLeave(trigger);
    fireEvent.pointerMove(trigger);
    expect(await findTooltipContent()).toHaveTextContent("Help");
  });

  it("does not open from keyboard focus by default", async () => {
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

    fireEvent.keyDown(document.body, { key: "Tab" });
    fireEvent.focus(trigger);
    await waitForDelay(20);

    expect(document.querySelector('[data-slot="tooltip-content"]')).toBeNull();
  });

  it("opens from keyboard focus when explicitly enabled", async () => {
    const { getByRole } = render(
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild openOnFocus={true}>
            <button type="button">Trigger</button>
          </TooltipTrigger>
          <TooltipContent>Help</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
    const trigger = getByRole("button");

    fireEvent.keyDown(document.body, { key: "Tab" });
    fireEvent.focus(trigger);

    expect(await findTooltipContent()).toHaveTextContent("Help");
  });

  it("does not open from focus when openOnFocus is false", async () => {
    const { getByRole } = render(
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild openOnFocus={false}>
            <button type="button">Trigger</button>
          </TooltipTrigger>
          <TooltipContent>Help</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
    const trigger = getByRole("button");

    fireEvent.keyDown(document.body, { key: "Tab" });
    fireEvent.focus(trigger);
    await waitForDelay(20);
    expect(document.querySelector('[data-slot="tooltip-content"]')).toBeNull();

    fireEvent.pointerMove(trigger);
    expect(await findTooltipContent()).toHaveTextContent("Help");
  });

  it("does not reopen a delayed hover after keyboard dismissal", async () => {
    const { getByRole } = render(
      <TooltipProvider delayDuration={20}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button">Trigger</button>
          </TooltipTrigger>
          <TooltipContent>Help</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
    const trigger = getByRole("button");

    fireEvent.pointerMove(trigger);
    fireEvent.keyDown(document.body, { key: "x" });
    await waitForDelay(30);

    expect(document.querySelector('[data-slot="tooltip-content"]')).toBeNull();
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

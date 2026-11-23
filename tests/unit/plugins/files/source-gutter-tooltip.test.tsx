import { TooltipProvider } from "@pier/ui/tooltip.tsx";
import { GUTTER_TOOLTIP_DELAY_MS } from "@plugins/builtin/files/renderer/git-changes/hover-tooltip.tsx";
import { SourceGutterTooltip } from "@plugins/builtin/files/renderer/git-changes/source-tooltip.tsx";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { RefObject } from "react";
import { describe, expect, it, vi } from "vitest";

function rect(top: number, left: number, height: number) {
  return {
    top,
    bottom: top + height,
    left,
    right: left + 16,
    width: 16,
    height,
    x: left,
    y: top,
    toJSON: () => ({}),
  };
}

describe("SourceGutterTooltip", () => {
  it("anchors the delayed hint on the hovered source row", () => {
    const root = document.createElement("div");
    root.innerHTML = '<div class="cm-gitRow-added"></div>';
    root.getBoundingClientRect = () => rect(100, 0, 400);
    const row = root.querySelector(".cm-gitRow-added");
    if (!(row instanceof HTMLElement)) {
      throw new Error("row fixture missing");
    }
    row.getBoundingClientRect = () => rect(120, 4, 18);
    document.body.append(root);
    const rootRef = { current: root } as RefObject<HTMLDivElement | null>;
    const ui = render(
      <TooltipProvider>
        <SourceGutterTooltip enabled label="View changes" rootRef={rootRef} />
      </TooltipProvider>
    );
    vi.useFakeTimers();
    try {
      fireEvent.pointerOver(row, { clientY: 130 });
      act(() => {
        vi.advanceTimersByTime(GUTTER_TOOLTIP_DELAY_MS);
      });
      const anchor = document.querySelector<HTMLElement>(
        '[data-slot="gutter-hover-tooltip-anchor"]'
      );
      expect(anchor).not.toBeNull();
      expect(anchor).toHaveStyle({
        height: "18px",
        left: "4px",
        top: "20px",
        width: "16px",
      });
      expect(screen.getByRole("tooltip")).toHaveTextContent("View changes");
      fireEvent.scroll(root);
      expect(
        document.querySelector('[data-slot="gutter-hover-tooltip-anchor"]')
      ).toBeNull();
    } finally {
      vi.useRealTimers();
      ui.unmount();
      root.remove();
    }
  });
});

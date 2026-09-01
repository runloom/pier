import { CommentNavigator } from "@pier/ui/comments/navigator.tsx";
import { ImagePreviewControls } from "@pier/ui/image-preview/controls.tsx";
import { TooltipProvider } from "@pier/ui/tooltip.tsx";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const navigatorProps = {
  activeIndex: 0,
  clearLabel: "Clear all",
  nextLabel: "Next comment",
  positionLabel: "Comment 1 of 1",
  previousLabel: "Previous comment",
  toolbarLabel: "Comments",
  total: 1,
} as const;

const zoomLabels = {
  actualSize: "Actual size",
  controlsLabel: "Board controls",
  fit: "Fit",
  loadFailedDescription: "failed",
  loadFailedTitle: "Failed",
  loading: "Loading",
  viewerLabel: "Board",
  zoomIn: "Zoom in",
  zoomLevel: "Zoom level",
  zoomOut: "Zoom out",
};

describe("CommentNavigator", () => {
  it("keeps next, previous, and the position control enabled for a single comment", () => {
    const onClear = vi.fn();
    const onNext = vi.fn();
    const onPrevious = vi.fn();
    const onRevealCurrent = vi.fn();
    render(
      <TooltipProvider>
        <CommentNavigator
          {...navigatorProps}
          onClear={onClear}
          onNext={onNext}
          onPrevious={onPrevious}
          onRevealCurrent={onRevealCurrent}
        />
      </TooltipProvider>
    );
    fireEvent.click(screen.getByLabelText("Next comment"));
    fireEvent.click(screen.getByLabelText("Previous comment"));
    fireEvent.click(screen.getByLabelText("Comment 1 of 1"));
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onPrevious).toHaveBeenCalledTimes(1);
    expect(onRevealCurrent).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText("Clear all"));
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(
      screen
        .getByRole("toolbar", { name: "Comments" })
        .querySelector("svg.lucide-message-circle")
    ).not.toBeNull();
    expect(
      screen
        .getByRole("toolbar", { name: "Comments" })
        .querySelector("svg.lucide-trash-2")
    ).not.toBeNull();
    expect(
      screen.getByRole("toolbar", { name: "Comments" }).textContent
    ).not.toContain("Clear all");
  });

  it("keeps comment and zoom chrome as two toolbars", () => {
    const onClear = vi.fn();
    render(
      <TooltipProvider>
        <div className="relative">
          <CommentNavigator
            {...navigatorProps}
            onClear={onClear}
            onNext={vi.fn()}
            onPrevious={vi.fn()}
            onRevealCurrent={vi.fn()}
          />
          <ImagePreviewControls
            effectiveZoom={1.25}
            labels={zoomLabels}
            onZoomChange={vi.fn()}
            onZoomIn={vi.fn()}
            onZoomOut={vi.fn()}
            zoom={1.25}
          />
        </div>
      </TooltipProvider>
    );
    expect(screen.getAllByRole("toolbar")).toHaveLength(2);
    expect(screen.getByRole("toolbar", { name: "Comments" })).toBeTruthy();
    expect(
      screen.getByRole("toolbar", { name: "Board controls" })
    ).toBeTruthy();
    expect(screen.getByTestId("comment-navigator").className).toMatch(
      /left-1\/2/u
    );
    expect(
      screen.getByRole("toolbar", { name: "Board controls" }).parentElement
        ?.className
    ).toContain("justify-end");
    fireEvent.click(screen.getByLabelText("Clear all"));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});

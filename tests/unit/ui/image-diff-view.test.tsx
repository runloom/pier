import {
  CODE_VIEW_CUSTOM_CSS,
  PIER_DIFF_LIGHT_DOM_CSS,
} from "@pier/ui/diff-view/appearance.ts";
import type {
  PierImageDiffMode,
  PierImageDiffSide,
} from "@pier/ui/diff-view/image-diff/types.ts";
import { ImageDiffView } from "@pier/ui/diff-view/image-diff/view.tsx";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

const labels = {
  added: "Added",
  compare: "Compare",
  deleted: "Deleted",
  dimensions: "{{width}}×{{height}}",
  loadFailed: "Couldn't load this image. Open the file to inspect.",
  onionSkin: "Onion skin",
  swipe: "Swipe",
  twoUp: "2-up",
};

function side(kind: "before" | "after"): PierImageDiffSide {
  return {
    byteSize: 68,
    height: 1,
    locator: {
      absolutePath: `/tmp/${kind}.png`,
      kind: "absolute",
      mime: "image/png",
      revision: kind,
    },
    width: 1,
  };
}

describe("ImageDiffView", () => {
  it("renders 2-up as two bordered images without a swipe handle", () => {
    function Harness() {
      const [mode, setMode] = useState<PierImageDiffMode>("two-up");
      return (
        <ImageDiffView
          after={side("after")}
          afterUrl="pier-file-preview://file/after"
          before={side("before")}
          beforeUrl="pier-file-preview://file/before"
          labels={labels}
          locale="en"
          mode={mode}
          onModeChange={setMode}
        />
      );
    }
    const { container } = render(<Harness />);
    expect(screen.getByText("Added")).toBeTruthy();
    expect(screen.getByText("Deleted")).toBeTruthy();
    expect(screen.queryByRole("slider")).toBeNull();
    expect(
      container.querySelector("[data-slot='pier-image-diff']")?.className
    ).toContain("justify-center");
    expect(
      container.querySelector("[data-slot='pier-image-diff'] > div")?.className
    ).toContain("items-center");
    expect(
      container.querySelectorAll("[data-slot='pier-image-diff-image']")
    ).toHaveLength(2);
    expect(
      container.querySelectorAll("[data-slot='pier-image-diff-stage']")
    ).toHaveLength(0);
    const modeSwitch = screen.getByRole("radiogroup", { name: "Compare" });
    expect(modeSwitch).toHaveAttribute("data-slot", "toggle-group");
    expect(modeSwitch).toHaveAttribute("data-variant", "outline");
    expect(
      modeSwitch.querySelector("[data-slot='toggle-group-item']")?.className
    ).not.toContain("hover:underline");
    fireEvent.click(screen.getByText("Swipe"));
    expect(screen.getByText("Added")).toBeTruthy();
    expect(screen.getByText("Deleted")).toBeTruthy();
    for (const caption of container.querySelectorAll(
      "[data-slot='pier-image-diff-swipe-caption']"
    )) {
      expect(caption.className).not.toMatch(/backdrop-blur|backdrop-filter/u);
      expect(caption.className).toContain("bg-background");
      expect(caption.className).not.toMatch(/bg-background\/\d+/u);
    }
    const swipeBar = screen.getByRole("slider", { name: "Swipe" });
    expect(swipeBar.className).toContain("cursor-col-resize");
    expect(swipeBar).toHaveAttribute("aria-valuetext", "50%");
    const swipeBlade = swipeBar.querySelector(
      "[data-slot='pier-image-diff-swipe-blade']"
    );
    expect(swipeBlade?.className).toContain("w-px");
    expect(swipeBlade?.className).toContain("bg-foreground");
    expect(swipeBlade?.className).toContain("group-hover/bar:w-0.5");
    expect(swipeBlade?.className).toContain("group-hover/bar:bg-action-accent");
    expect(swipeBlade?.className).toContain(
      "group-data-[dragging]/swipe:w-0.5"
    );
    expect(swipeBlade?.className).toContain(
      "group-data-[dragging]/swipe:bg-action-accent"
    );
    const swipeGrip = swipeBar.querySelector(
      "[data-slot='pier-image-diff-swipe-grip']"
    );
    expect(swipeGrip?.className).toContain("size-6");
    expect(swipeGrip?.className).toContain(
      "group-hover/bar:ring-action-accent"
    );
    expect(swipeGrip?.className).toContain(
      "group-focus-visible/swipe:ring-ring/30"
    );
    expect(swipeGrip?.className).not.toContain(
      "group-focus-visible/swipe:ring-action-accent"
    );
    expect(swipeBlade?.className).not.toContain(
      "group-focus-visible/swipe:bg-action-accent"
    );
    expect(swipeGrip?.querySelector("[data-icon='grip']")).not.toBeNull();
    expect(swipeBar.querySelectorAll("svg")).toHaveLength(1);
    expect(swipeBar.className).not.toContain("overflow-hidden");
    expect(
      container.querySelector("[data-slot='pier-image-diff-stage']")?.className
    ).toContain("overflow-hidden");
    expect(
      container.querySelector("[data-slot='pier-image-diff-stage']")?.className
    ).toContain("rounded-md");
    expect(
      screen.getByText("Deleted").closest("[aria-hidden='true']")
    ).toBeNull();
    expect(
      screen.getByText("Added").closest("[aria-hidden='true']")
    ).toBeNull();
    expect(
      container.querySelectorAll("[data-slot='pier-image-diff-stage']")
    ).toHaveLength(1);
    expect(
      container.querySelectorAll("[data-slot='pier-image-diff-checker']")
    ).toHaveLength(2);
    expect(
      container.querySelectorAll("[data-slot='pier-image-diff-image']")
    ).toHaveLength(0);
    fireEvent.click(screen.getByText("Onion skin"));
    expect(screen.getByText("Added")).toBeTruthy();
    expect(screen.getByText("Deleted")).toBeTruthy();
  });

  it("shows load-failed copy when a previewed image errors", () => {
    const { container } = render(
      <ImageDiffView
        after={side("after")}
        afterUrl="pier-file-preview://file/after"
        before={null}
        beforeUrl={null}
        labels={labels}
        locale="en"
        mode="two-up"
        onModeChange={() => undefined}
      />
    );
    const image = container.querySelector("img");
    expect(image).not.toBeNull();
    if (image !== null) {
      fireEvent.error(image);
    }
    expect(
      screen.getByText("Couldn't load this image. Open the file to inspect.")
    ).toBeTruthy();
  });

  it("hides comparison modes when only the added side exists", () => {
    render(
      <ImageDiffView
        after={side("after")}
        afterUrl="pier-file-preview://file/after"
        before={null}
        beforeUrl={null}
        labels={labels}
        locale="en"
        mode="two-up"
        onModeChange={() => undefined}
      />
    );
    expect(screen.getByText("Added")).toBeTruthy();
    expect(screen.queryByText("2-up")).toBeNull();
    expect(screen.queryByText("Deleted")).toBeNull();
  });

  it("collapses split files to one column so the compare group can center", () => {
    expect(CODE_VIEW_CUSTOM_CSS).toContain(
      ':host([data-pier-image-diff]) [data-diff-type="split"]'
    );
    expect(CODE_VIEW_CUSTOM_CSS).toContain(
      "grid-template-columns: minmax(0, 1fr)"
    );
    expect(CODE_VIEW_CUSTOM_CSS).toContain(
      ":host([data-pier-image-diff]) [data-annotation-content]"
    );
  });

  it("gives each swipe pane an opaque checker so PNG alpha cannot composite the other side", () => {
    expect(PIER_DIFF_LIGHT_DOM_CSS).toContain(
      '[data-slot="pier-image-diff-checker"]'
    );
    expect(PIER_DIFF_LIGHT_DOM_CSS).toContain("user-select: none");
  });
});

function renderSwipe(): ReturnType<typeof render> {
  return render(
    <ImageDiffView
      after={side("after")}
      afterUrl="pier-file-preview://file/after"
      before={side("before")}
      beforeUrl="pier-file-preview://file/before"
      labels={labels}
      locale="en"
      mode="swipe"
      onModeChange={() => undefined}
    />
  );
}

function mockSwipePointer(slider: HTMLElement): void {
  slider.getBoundingClientRect = () =>
    ({
      bottom: 100,
      height: 100,
      left: 0,
      right: 200,
      toJSON: () => ({}),
      top: 0,
      width: 200,
      x: 0,
      y: 0,
    }) as DOMRect;
  slider.setPointerCapture = () => undefined;
  slider.hasPointerCapture = () => true;
  slider.releasePointerCapture = () => undefined;
}

describe("ImageDiffView swipe interactions", () => {
  it("moves with arrows and snaps Home / End / Page keys", () => {
    renderSwipe();
    const slider = screen.getByRole("slider", { name: "Swipe" });
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(slider).toHaveAttribute("aria-valuenow", "55");
    fireEvent.keyDown(slider, { key: "PageUp" });
    expect(slider).toHaveAttribute("aria-valuenow", "65");
    fireEvent.keyDown(slider, { key: "Home" });
    expect(slider).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByText("Deleted").className).toContain("opacity-0");
    fireEvent.keyDown(slider, { key: "End" });
    expect(slider).toHaveAttribute("aria-valuenow", "100");
    expect(screen.getByText("Added").className).toContain("opacity-0");
  });

  it("positions from primary pointer and ignores other buttons", () => {
    renderSwipe();
    const slider = screen.getByRole("slider", { name: "Swipe" });
    mockSwipePointer(slider);
    fireEvent.pointerDown(slider, {
      button: 2,
      clientX: 160,
      clientY: 10,
      pointerId: 1,
    });
    expect(slider).not.toHaveAttribute("data-dragging");
    expect(slider).toHaveAttribute("aria-valuenow", "50");
    fireEvent.pointerDown(slider, {
      button: 0,
      clientX: 160,
      clientY: 10,
      pointerId: 1,
    });
    expect(slider).toHaveAttribute("data-dragging", "true");
    expect(slider).toHaveAttribute("aria-valuenow", "80");
  });

  it("snaps to center on a second tap after canceled pointerdown", () => {
    renderSwipe();
    const slider = screen.getByRole("slider", { name: "Swipe" });
    mockSwipePointer(slider);
    fireEvent.pointerDown(slider, {
      button: 0,
      clientX: 160,
      clientY: 10,
      pointerId: 1,
      timeStamp: 1000,
    });
    fireEvent.pointerUp(slider, {
      button: 0,
      clientX: 160,
      clientY: 10,
      pointerId: 1,
      timeStamp: 1080,
    });
    expect(slider).toHaveAttribute("aria-valuenow", "80");
    fireEvent.pointerDown(slider, {
      button: 0,
      clientX: 160,
      clientY: 10,
      pointerId: 1,
      timeStamp: 1200,
    });
    fireEvent.pointerUp(slider, {
      button: 0,
      clientX: 160,
      clientY: 10,
      pointerId: 1,
      timeStamp: 1280,
    });
    expect(slider).toHaveAttribute("aria-valuenow", "50");
  });

  it("clears the drag cursor chrome when the window blurs", () => {
    renderSwipe();
    const slider = screen.getByRole("slider", { name: "Swipe" });
    mockSwipePointer(slider);
    fireEvent.pointerDown(slider, {
      button: 0,
      clientX: 100,
      clientY: 10,
      pointerId: 1,
    });
    expect(slider).toHaveAttribute("data-dragging", "true");
    expect(document.documentElement.style.cursor).toBe("col-resize");
    fireEvent(window, new Event("blur"));
    expect(slider).not.toHaveAttribute("data-dragging");
    expect(document.documentElement.style.cursor).toBe("");
  });
});

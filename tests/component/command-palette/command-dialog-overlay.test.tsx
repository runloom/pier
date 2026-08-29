import { CommandDialog } from "@pier/ui/command.tsx";
import { Dialog, DialogContent } from "@pier/ui/dialog.tsx";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const BACKDROP_FILTER_CLASS = /backdrop-blur|backdrop-filter/;

function titlebarCatcher(overlay: Element | null) {
  return overlay?.querySelector(
    '[data-slot="overlay-scrim-catcher"][data-titlebar]'
  );
}

function expectFullWindowOverlay(
  overlay: Element | null,
  titlebar: "dismiss" | "drag"
) {
  expect(overlay).toBeInstanceOf(HTMLElement);
  expect(overlay?.className).toContain("inset-0");
  expect(overlay?.className).toContain("pointer-events-none");
  expect(overlay?.className).not.toContain("top-[var(--app-titlebar-height)]");
  expect(overlay?.className).toContain("app-no-drag");
  expect(overlay?.className).not.toContain("bg-black/30");
  expect(overlay?.className).not.toMatch(BACKDROP_FILTER_CLASS);

  const catcher = titlebarCatcher(overlay);
  expect(catcher).toBeInstanceOf(HTMLElement);
  expect(catcher?.className).toContain("pointer-events-auto");
  expect(catcher?.className).toContain("h-[var(--app-titlebar-height)]");
  const classes = catcher?.className.split(/\s+/) ?? [];
  if (titlebar === "dismiss") {
    expect(classes).toContain("app-no-drag");
    expect(classes).not.toContain("app-drag");
  } else {
    expect(classes).toContain("app-drag");
  }
}

describe("CommandDialog overlay", () => {
  it("covers the window including the titlebar without blur effects", () => {
    render(
      <CommandDialog open>
        <div>Palette content</div>
      </CommandDialog>
    );

    expectFullWindowOverlay(
      document.querySelector('[data-slot="dialog-overlay"]'),
      "dismiss"
    );
    expect(screen.getByText("Palette content")).toBeDefined();
  });

  it("closes when clicking the command palette overlay", () => {
    const onOpenChange = vi.fn();
    render(
      <CommandDialog onOpenChange={onOpenChange} open>
        <div>Palette content</div>
      </CommandDialog>
    );

    const overlay = document.querySelector('[data-slot="dialog-overlay"]');
    const bodyCatcher = overlay?.querySelector(
      '[data-slot="overlay-scrim-catcher"]:not([data-titlebar])'
    );

    expect(bodyCatcher).toBeInstanceOf(HTMLElement);
    fireEvent.click(bodyCatcher as HTMLElement);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closes when clicking the titlebar overlay catcher", () => {
    const onOpenChange = vi.fn();
    render(
      <CommandDialog onOpenChange={onOpenChange} open>
        <div>Palette content</div>
      </CommandDialog>
    );

    const catcher = titlebarCatcher(
      document.querySelector('[data-slot="dialog-overlay"]')
    );

    expect(catcher).toBeInstanceOf(HTMLElement);
    fireEvent.click(catcher as HTMLElement);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("does not change the default dialog backdrop", () => {
    render(
      <Dialog open>
        <DialogContent>
          <div>Dialog content</div>
        </DialogContent>
      </Dialog>
    );

    const overlay = document.querySelector('[data-slot="dialog-overlay"]');
    expectFullWindowOverlay(overlay, "drag");
    expect(overlay?.className).toContain("bg-overlay-scrim");
    expect(screen.getByText("Dialog content")).toBeDefined();
  });
});

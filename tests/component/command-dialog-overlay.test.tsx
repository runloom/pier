import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CommandDialog } from "@/components/primitives/command.tsx";
import { Dialog, DialogContent } from "@/components/primitives/dialog.tsx";

const BACKDROP_FILTER_CLASS = /backdrop-blur|backdrop-filter/;

describe("CommandDialog overlay", () => {
  it("keeps the command palette backdrop below the titlebar without blur effects", () => {
    render(
      <CommandDialog open>
        <div>Palette content</div>
      </CommandDialog>
    );

    const overlay = document.querySelector('[data-slot="dialog-overlay"]');

    expect(overlay).toBeInstanceOf(HTMLElement);
    expect(overlay?.className).toContain("top-[var(--app-titlebar-height)]");
    expect(overlay?.className).not.toContain("inset-0");
    expect(overlay?.className).not.toContain("bg-black/30");
    expect(overlay?.className).not.toMatch(BACKDROP_FILTER_CLASS);
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

    expect(overlay).toBeInstanceOf(HTMLElement);
    fireEvent.click(overlay as HTMLElement);

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

    expect(overlay).toBeInstanceOf(HTMLElement);
    expect(overlay?.className).toContain("bg-overlay-scrim");
    expect(overlay?.className).toContain("top-[var(--app-titlebar-height)]");
    expect(overlay?.className).not.toContain("inset-0");
    expect(overlay?.className).not.toContain("bg-black/30");
    expect(overlay?.className).not.toMatch(BACKDROP_FILTER_CLASS);
    expect(screen.getByText("Dialog content")).toBeDefined();
  });
});

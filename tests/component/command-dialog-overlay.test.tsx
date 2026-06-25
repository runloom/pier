import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CommandDialog } from "@/components/primitives/command.tsx";
import { Dialog, DialogContent } from "@/components/primitives/dialog.tsx";

describe("CommandDialog overlay", () => {
  it("keeps the command palette backdrop transparent so the native terminal stays visible", () => {
    render(
      <CommandDialog open>
        <div>Palette content</div>
      </CommandDialog>
    );

    const overlay = document.querySelector('[data-slot="dialog-overlay"]');

    expect(overlay).toBeInstanceOf(HTMLElement);
    expect(overlay?.className).toContain("bg-transparent");
    expect(overlay?.className).toContain("backdrop-blur-none");
    expect(overlay?.className).not.toContain("bg-black/30");
    expect(overlay?.className).not.toContain("backdrop-blur-sm");
    expect(screen.getByText("Palette content")).toBeDefined();
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
    expect(overlay?.className).toContain("bg-black/30");
    expect(overlay?.className).toContain("backdrop-blur-sm");
    expect(screen.getByText("Dialog content")).toBeDefined();
  });
});

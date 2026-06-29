import { Command, CommandDialog, CommandInput } from "@pier/ui/command.tsx";
import { Dialog, DialogContent } from "@pier/ui/dialog.tsx";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("Dialog initial focus", () => {
  it("focuses dialog content by default instead of the first button", () => {
    render(
      <Dialog open>
        <DialogContent>
          <button type="button">Primary action</button>
        </DialogContent>
      </Dialog>
    );

    const content = document.querySelector('[data-slot="dialog-content"]');
    const button = screen.getByRole("button", { name: "Primary action" });

    expect(content).toBeInstanceOf(HTMLElement);
    expect(content).toHaveAttribute("tabindex", "-1");
    expect(document.activeElement).toBe(content);
    expect(document.activeElement).not.toBe(button);
  });

  it("lets command dialogs focus the command input on open", () => {
    render(
      <CommandDialog open>
        <Command>
          <CommandInput aria-label="Command search" />
        </Command>
      </CommandDialog>
    );

    expect(screen.getByLabelText("Command search")).toHaveFocus();
  });
});

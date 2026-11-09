import { Command, CommandDialog, CommandInput } from "@pier/ui/command.tsx";
import { Dialog, DialogContent } from "@pier/ui/dialog.tsx";
import { TerminalOverlayContext } from "@pier/ui/use-terminal-overlay.tsx";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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

  it("registers the dialog overlay for terminal hit testing", () => {
    const dispose = vi.fn();
    const registerElement = vi.fn(() => ({ dispose, flush: vi.fn() }));
    const { unmount } = render(
      <TerminalOverlayContext.Provider value={{ registerElement }}>
        <Dialog open>
          <DialogContent>
            <button type="button">Primary action</button>
          </DialogContent>
        </Dialog>
      </TerminalOverlayContext.Provider>
    );

    const overlay = document.querySelector('[data-slot="dialog-overlay"]');
    const content = document.querySelector('[data-slot="dialog-content"]');

    expect(overlay).toBeInstanceOf(HTMLElement);
    expect(content).toBeInstanceOf(HTMLElement);
    // scrim 只做输入捕获，不回填终端洞；卡片是绘制面，必须单独登记回填。
    expect(registerElement).toHaveBeenCalledWith(
      expect.stringMatching(/^terminal-overlay:/),
      overlay,
      { paints: false }
    );
    expect(registerElement).toHaveBeenCalledWith(
      expect.stringMatching(/^terminal-overlay:/),
      content
    );

    unmount();

    expect(dispose).toHaveBeenCalled();
  });
});

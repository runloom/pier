import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCommandPaletteController } from "@/lib/command-palette/controller.ts";
import { installCommandPaletteMenuRequest } from "@/lib/command-palette/menu-request.ts";

describe("installCommandPaletteMenuRequest", () => {
  beforeEach(() => {
    useCommandPaletteController.setState({
      mode: "commands",
      open: false,
      quickPick: null,
      requestId: 0,
      stack: [],
    });
  });

  it("opens the command palette when main sends the native menu request", () => {
    const bridge: { listener?: () => void } = {};
    const dispose = vi.fn();
    window.pier = {
      commandPalette: {
        onToggleRequest: vi.fn((cb: () => void) => {
          bridge.listener = cb;
          return dispose;
        }),
      },
    } as never;

    const uninstall = installCommandPaletteMenuRequest();
    bridge.listener?.();

    expect(window.pier.commandPalette.onToggleRequest).toHaveBeenCalledOnce();
    expect(useCommandPaletteController.getState().open).toBe(true);

    uninstall();
    expect(dispose).toHaveBeenCalledOnce();
  });
});

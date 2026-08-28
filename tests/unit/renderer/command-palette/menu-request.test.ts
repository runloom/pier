import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { actionRegistry } from "@/lib/actions/registry.ts";
import type { Action } from "@/lib/actions/types.ts";
import { useCommandPaletteController } from "@/lib/command-palette/controller.ts";
import {
  installCommandPaletteMenuRequest,
  installMenuCommandRequest,
} from "@/lib/command-palette/menu-request.ts";
import { dispatchKeybindingAction } from "@/lib/keybindings/use-registry.ts";

vi.mock("@/lib/keybindings/use-registry.ts", () => ({
  dispatchKeybindingAction: vi.fn(),
}));

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
        onMenuCommand: vi.fn(),
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

describe("installMenuCommandRequest", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dispatches the named action from the application menu", () => {
    const bridge: { listener?: (commandId: string) => void } = {};
    const dispose = vi.fn();
    const action = { id: "pier.find" } as Action;
    vi.spyOn(actionRegistry, "get").mockReturnValue(action);
    window.pier = {
      commandPalette: {
        onMenuCommand: vi.fn((cb: (commandId: string) => void) => {
          bridge.listener = cb;
          return dispose;
        }),
        onToggleRequest: vi.fn(),
      },
    } as never;

    const uninstall = installMenuCommandRequest();
    bridge.listener?.("pier.find");

    expect(dispatchKeybindingAction).toHaveBeenCalledWith(action, "menu");
    uninstall();
    expect(dispose).toHaveBeenCalledOnce();
  });
});

import { actionRegistry } from "@/lib/actions/registry.ts";
import { dispatchKeybindingAction } from "@/lib/keybindings/use-registry.ts";
import { useCommandPaletteController } from "./controller.ts";

export function installCommandPaletteMenuRequest(): () => void {
  return (
    window.pier?.commandPalette?.onToggleRequest?.(() => {
      useCommandPaletteController.getState().toggle();
    }) ?? (() => undefined)
  );
}

export function installMenuCommandRequest(): () => void {
  return (
    window.pier?.commandPalette?.onMenuCommand?.((commandId) => {
      const action = actionRegistry.get(commandId);
      if (!action) {
        return;
      }
      dispatchKeybindingAction(action, "menu");
    }) ?? (() => undefined)
  );
}

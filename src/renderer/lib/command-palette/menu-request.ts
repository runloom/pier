import { useCommandPaletteController } from "./controller.ts";

export function installCommandPaletteMenuRequest(): () => void {
  return (
    window.pier?.commandPalette?.onToggleRequest?.(() => {
      useCommandPaletteController.getState().toggle();
    }) ?? (() => undefined)
  );
}

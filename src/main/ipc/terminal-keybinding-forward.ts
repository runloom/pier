import {
  isToggleDevToolsNativeChord,
  toggleDetachedDevTools,
} from "../devtools.ts";
import { findAppWindowByElectronId } from "../windows/window-identity.ts";
import { recordNativeTerminalRoute } from "./terminal-debug.ts";
import { forwardToWindow } from "./terminal-forwarding.ts";
import type { NativeAddon } from "./terminal-native-addon.ts";

export function registerTerminalKeybindingForward(
  addon: NativeAddon | null
): void {
  addon?.setKeyboardForwardCallback((id, modifierFlags, chars) => {
    recordNativeTerminalRoute(id, "key-forward", null, {
      chars,
      modifierFlags,
    });
    const targetWindow = findAppWindowByElectronId(id);
    if (
      targetWindow &&
      !targetWindow.isDestroyed() &&
      isToggleDevToolsNativeChord(modifierFlags, chars)
    ) {
      toggleDetachedDevTools(targetWindow);
      return;
    }

    forwardToWindow(
      id,
      "pier:keybinding:forward",
      { modifierFlags, chars },
      "pier-key-forward"
    );
  });

  addon?.setModifierForwardCallback((id, modifierFlags) => {
    recordNativeTerminalRoute(id, "modifier-state", null, { modifierFlags });
    forwardToWindow(
      id,
      "pier:keybinding:modifier-state",
      { modifierFlags },
      "pier-modifier-state"
    );
  });
}

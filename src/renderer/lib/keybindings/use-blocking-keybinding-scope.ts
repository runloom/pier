/**
 * While a modal dialog/shell is open, push an overlay keybinding scope so
 * global chords (e.g. ⌘W → close panel) do not fall through.
 *
 * Pair with `requestTerminalWebFocus` when the shell also needs keyboard
 * focus away from native terminal surfaces.
 *
 * `scopeId` should be a full tag (`overlay:settings-dialog`) for consistency
 * with command palette / app-dialog hosts.
 */
import { useEffect } from "react";
import { useKeybindingScope } from "@/stores/keybinding-scope.store.ts";

export function useBlockingKeybindingScope(
  active: boolean,
  scopeId: `overlay:${string}`
): void {
  useEffect(() => {
    if (!active) {
      return;
    }
    useKeybindingScope.getState().pushBlockingScope(scopeId);
    return () => {
      useKeybindingScope.getState().popBlockingScope(scopeId);
    };
  }, [active, scopeId]);
}

import { useEffect } from "react";
import { useKeybindingScope } from "@/stores/keybinding-scope.store.ts";
import {
  closePluginOverlay,
  usePluginOverlayStore,
} from "@/stores/plugin-overlay.store.ts";
import {
  registerTerminalFullscreenWebOverlay,
  requestTerminalWebFocus,
} from "@/stores/terminal-input-routing-slice.ts";

export function PluginOverlayHost() {
  const current = usePluginOverlayStore((state) => state.current);
  const overlayKey = current ? `${current.pluginId}:${current.id}` : null;

  useEffect(() => {
    if (!overlayKey) {
      return;
    }
    const hostId = `plugin:${overlayKey}`;
    const route = registerTerminalFullscreenWebOverlay(hostId);
    const releaseWebFocus = requestTerminalWebFocus(hostId);
    const scopeId = `overlay:${hostId}`;
    useKeybindingScope.getState().pushBlockingScope(scopeId);
    return () => {
      useKeybindingScope.getState().popBlockingScope(scopeId);
      releaseWebFocus();
      route.dispose();
    };
  }, [overlayKey]);

  if (!current) {
    return null;
  }
  return current.render({
    close: () => closePluginOverlay(current.pluginId, current.id),
  });
}

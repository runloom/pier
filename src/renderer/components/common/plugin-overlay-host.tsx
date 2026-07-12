import { Fragment, useEffect, useLayoutEffect, useState } from "react";
import { useKeybindingScope } from "@/stores/keybinding-scope.store.ts";
import type { ActivePluginOverlay } from "@/stores/plugin-overlay.store.ts";
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
  const [retained, setRetained] = useState<ActivePluginOverlay | null>(current);
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

  useLayoutEffect(() => {
    if (current) {
      setRetained(current);
    }
  }, [current]);

  const presented = current ?? retained;
  if (!presented) {
    return null;
  }
  return (
    <Fragment key={presented.instanceId}>
      {presented.render({
        close: () => closePluginOverlay(presented.pluginId, presented.id),
        open: current === presented,
      })}
    </Fragment>
  );
}

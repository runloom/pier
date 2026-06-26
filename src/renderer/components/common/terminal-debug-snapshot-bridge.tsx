import { useEffect } from "react";
import { buildRendererDebugSnapshot } from "@/stores/terminal-debug.store.ts";

export function TerminalDebugSnapshotBridge() {
  useEffect(
    () =>
      window.pier.terminal.onDebugRendererSnapshotRequest(() =>
        buildRendererDebugSnapshot()
      ),
    []
  );

  return null;
}

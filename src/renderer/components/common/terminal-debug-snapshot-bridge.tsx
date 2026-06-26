import { useEffect } from "react";
import { buildRendererDebugSnapshot } from "@/lib/terminal-debug/renderer-snapshot.ts";

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

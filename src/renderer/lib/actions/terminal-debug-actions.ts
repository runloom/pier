import { Bug } from "lucide-react";
import { actionRegistry } from "@/lib/actions/registry.ts";

export function registerTerminalDebugActions(): () => void {
  return actionRegistry.register({
    category: "Terminal",
    handler: () => {
      window.pier.terminal.openDebugWindow().catch((err: unknown) => {
        console.error("[terminal-debug] open window failed:", err);
      });
    },
    id: "pier.terminal.toggleDebugOverlay",
    metadata: {
      group: "8_debug",
      iconComponent: Bug,
      keywords: ["terminal", "debug", "native", "route"],
    },
    surfaces: [],
    title: () => "Toggle Terminal Debug Overlay",
  });
}

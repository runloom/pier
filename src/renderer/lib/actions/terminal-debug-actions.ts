import i18next from "i18next";
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
    id: "pier.terminal.openDebugWindow",
    metadata: {
      group: "8_debug",
      iconComponent: Bug,
      keywords: ["terminal", "debug", "native", "route"],
    },
    surfaces: [],
    title: () => i18next.t("commandPalette.action.openTerminalDebugWindow"),
  });
}

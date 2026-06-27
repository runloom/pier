import { Bug } from "lucide-react";
import { registerActionContributions } from "@/lib/actions/contribution-runtime.ts";
import type { ActionContribution } from "@/lib/actions/contribution-types.ts";
import { rendererActionContributionRuntime } from "@/lib/actions/renderer-action-runtime.ts";

export const TERMINAL_DEBUG_ACTION_CONTRIBUTIONS: readonly ActionContribution[] =
  [
    {
      aliasesKey: "commandPalette.aliases.openTerminalDebugWindow",
      categoryKey: "terminal",
      group: "8_debug",
      handler: () => {
        window.pier.terminal.openDebugWindow().catch((err: unknown) => {
          console.error("[terminal-debug] open window failed:", err);
        });
      },
      iconComponent: Bug,
      id: "pier.terminal.openDebugWindow",
      surfaces: [],
      titleKey: "commandPalette.action.openTerminalDebugWindow",
    },
  ];

export function registerTerminalDebugActions(): () => void {
  const disposers = registerActionContributions(
    TERMINAL_DEBUG_ACTION_CONTRIBUTIONS,
    rendererActionContributionRuntime
  );

  return () => {
    for (const dispose of disposers) {
      dispose();
    }
  };
}

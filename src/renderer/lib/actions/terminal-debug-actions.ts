import i18next from "i18next";
import { Bug } from "lucide-react";
import { registerActionContributions } from "@/lib/actions/contribution-runtime.ts";
import type { ActionContribution } from "@/lib/actions/contribution-types.ts";
import { rendererActionContributionRuntime } from "@/lib/actions/renderer-action-runtime.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";

export const TERMINAL_DEBUG_ACTION_CONTRIBUTIONS: readonly ActionContribution[] =
  [
    {
      categoryKey: "terminal",
      group: "8_debug",
      handler: async () => {
        try {
          const result = await window.pier.terminal.openDebugWindow();
          if (!result.ok) {
            throw new Error(
              result.error ?? "terminal debug window unavailable"
            );
          }
        } catch (err) {
          console.error("[terminal-debug] open window failed:", err);
          await showAppAlert({
            body: err instanceof Error ? err.message : String(err),
            title: i18next.t(
              "commandPalette.action.openTerminalDebugWindowFailed"
            ),
          });
        }
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

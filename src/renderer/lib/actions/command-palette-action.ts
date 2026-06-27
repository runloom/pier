import { registerActionContributions } from "@/lib/actions/contribution-runtime.ts";
import type { ActionContribution } from "@/lib/actions/contribution-types.ts";
import { rendererActionContributionRuntime } from "@/lib/actions/renderer-action-runtime.ts";
import { useCommandPaletteController } from "@/lib/command-palette/controller.ts";

export const COMMAND_PALETTE_ACTION_CONTRIBUTIONS: readonly ActionContribution[] =
  [
    {
      categoryKey: "view",
      group: "9_other",
      handler: () => {
        useCommandPaletteController.getState().toggle();
      },
      id: "pier.commandPalette.toggle",
      surfaces: [],
      titleKey: "commandPalette.action.toggleCommandPalette",
    },
  ];

export function registerCommandPaletteAction(): () => void {
  const disposers = registerActionContributions(
    COMMAND_PALETTE_ACTION_CONTRIBUTIONS,
    rendererActionContributionRuntime
  );

  return () => {
    for (const dispose of disposers) {
      dispose();
    }
  };
}

import { Eraser } from "lucide-react";
import { registerActionContributions } from "@/lib/actions/contribution-runtime.ts";
import type { ActionContribution } from "@/lib/actions/contribution-types.ts";
import { rendererActionContributionRuntime } from "@/lib/actions/renderer-action-runtime.ts";
import { useCommandPaletteMru } from "@/stores/command-palette-mru.store.ts";

export const COMMAND_PALETTE_MRU_ACTION_CONTRIBUTIONS: readonly ActionContribution[] =
  [
    {
      aliasesKey: "commandPalette.aliases.clearRecent",
      categoryKey: "settings",
      excludeFromMru: true,
      handler: () => {
        useCommandPaletteMru
          .getState()
          .clear()
          .catch((err: unknown) => {
            console.error("[command-palette-mru] clear 失败:", err);
          });
      },
      iconComponent: Eraser,
      id: "pier.commandPalette.clearRecent",
      sortOrder: 30,
      surfaces: ["command-palette"],
      titleKey: "commandPalette.action.clearRecent",
    },
  ];

export function registerCommandPaletteMruAction(): () => void {
  const disposers = registerActionContributions(
    COMMAND_PALETTE_MRU_ACTION_CONTRIBUTIONS,
    rendererActionContributionRuntime
  );

  return () => {
    for (const dispose of disposers) {
      dispose();
    }
  };
}

import { SlidersHorizontal } from "lucide-react";
import { registerActionContributions } from "@/lib/actions/contribution-runtime.ts";
import type { ActionContribution } from "@/lib/actions/contribution-types.ts";
import { rendererActionContributionRuntime } from "@/lib/actions/renderer-action-runtime.ts";
import { useSettingsDialogStore } from "@/stores/settings-dialog.store.ts";

export const SETTINGS_ACTION_CONTRIBUTIONS: readonly ActionContribution[] = [
  {
    aliasesKey: "commandPalette.aliases.openSettings",
    categoryKey: "settings",
    group: "5_appearance",
    handler: () => {
      useSettingsDialogStore.getState().open();
    },
    iconComponent: SlidersHorizontal,
    id: "pier.settings.open",
    sortOrder: 5,
    surfaces: ["command-palette"],
    titleKey: "commandPalette.action.openSettings",
  },
];

export function registerSettingsActions(): () => void {
  const disposers = registerActionContributions(
    SETTINGS_ACTION_CONTRIBUTIONS,
    rendererActionContributionRuntime
  );

  return () => {
    for (const dispose of disposers) {
      dispose();
    }
  };
}

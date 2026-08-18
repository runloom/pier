import { SlidersHorizontal, Terminal } from "lucide-react";
import { registerActionContributions } from "@/lib/actions/contribution-runtime.ts";
import type { ActionContribution } from "@/lib/actions/contribution-types.ts";
import { rendererActionContributionRuntime } from "@/lib/actions/renderer-action-runtime.ts";
import {
  runInstallPierCommand,
  runUninstallPierCommand,
} from "@/lib/app-cli-actions.ts";
import { useSettingsDialogStore } from "@/stores/settings-dialog.store.ts";

export const SETTINGS_ACTION_CONTRIBUTIONS: readonly ActionContribution[] = [
  {
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
  {
    categoryKey: "settings",
    group: "5_appearance",
    handler: () => {
      useSettingsDialogStore.getState().openSection("environment");
    },
    iconComponent: SlidersHorizontal,
    id: "pier.environment.open",
    sortOrder: 6,
    surfaces: ["command-palette"],
    titleKey: "commandPalette.action.openEnvironment",
  },
  {
    categoryKey: "settings",
    group: "5_appearance",
    handler: () => {
      runInstallPierCommand({ notify: true }).catch(() => undefined);
    },
    iconComponent: Terminal,
    id: "pier.settings.installCli",
    sortOrder: 7,
    surfaces: ["command-palette"],
    titleKey: "commandPalette.action.installPierCommand",
  },
  {
    categoryKey: "settings",
    group: "5_appearance",
    handler: () => {
      runUninstallPierCommand({ notify: true }).catch(() => undefined);
    },
    iconComponent: Terminal,
    id: "pier.settings.removeCli",
    sortOrder: 8,
    surfaces: ["command-palette"],
    titleKey: "commandPalette.action.removePierCommand",
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

import commandPaletteAliases from "./command-palette.aliases.json" with {
  type: "json",
};
import { commandPalette } from "./command-palette.ts";
import { contextMenu } from "./context-menu.ts";
import { dialog } from "./dialog.ts";
import { missionControl } from "./mission-control.ts";
import { settings } from "./settings.ts";
import { terminal } from "./terminal.ts";
import { workspace } from "./workspace.ts";

export const en = {
  commandPalette: {
    ...commandPalette,
    aliases: commandPaletteAliases,
  },
  contextMenu,
  dialog,
  missionControl,
  settings,
  terminal,
  workspace,
} as const;

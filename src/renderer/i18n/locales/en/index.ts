import commandPaletteAliases from "./command-palette.aliases.json" with {
  type: "json",
};
import { commandPalette } from "./command-palette.ts";
import { contextMenu } from "./context-menu.ts";
import { dashboard } from "./dashboard.ts";
import { dialog } from "./dialog.ts";
import { settings } from "./settings.ts";
import { terminal } from "./terminal.ts";
import { workspace } from "./workspace.ts";

export const en = {
  commandPalette: {
    ...commandPalette,
    aliases: commandPaletteAliases,
  },
  contextMenu,
  dashboard,
  dialog,
  settings,
  terminal,
  workspace,
} as const;

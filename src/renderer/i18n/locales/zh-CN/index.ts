import { agents } from "./agents.ts";
import commandPaletteAliases from "./command-palette.aliases.json" with {
  type: "json",
};
import { commandPalette } from "./command-palette.ts";
import { contextMenu } from "./context-menu.ts";
import { dialog } from "./dialog.ts";
import { settings } from "./settings.ts";
import { terminal } from "./terminal.ts";
import { workbench } from "./workbench.ts";
import { workspace } from "./workspace.ts";

export const zhCN = {
  agents,
  commandPalette: {
    ...commandPalette,
    aliases: commandPaletteAliases,
  },
  contextMenu,
  dialog,
  workbench,
  settings,
  terminal,
  workspace,
} as const;

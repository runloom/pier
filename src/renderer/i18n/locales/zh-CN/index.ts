import { agents } from "./agents.ts";
import { canvas } from "./canvas.ts";
import commandPaletteAliases from "./command-palette.aliases.json" with {
  type: "json",
};
import { commandPalette } from "./command-palette.ts";
import { contextMenu } from "./context-menu.ts";
import { dialog } from "./dialog.ts";
import { notificationsCenter } from "./notifications-center.ts";
import { settings } from "./settings.ts";
import { terminal } from "./terminal.ts";
import { workspace } from "./workspace.ts";

export const zhCN = {
  agents,
  canvas,
  commandPalette: {
    ...commandPalette,
    aliases: commandPaletteAliases,
  },
  contextMenu,
  dialog,
  notificationsCenter,
  settings,
  terminal,
  workspace,
} as const;

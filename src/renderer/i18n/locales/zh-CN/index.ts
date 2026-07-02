import { commandPalette } from "./command-palette.ts";
import { contextMenu } from "./context-menu.ts";
import { dialog } from "./dialog.ts";
import { settings } from "./settings.ts";
import { terminal } from "./terminal.ts";

export const zhCN = {
  commandPalette,
  contextMenu,
  dialog,
  settings,
  terminal,
} as const;

import { commandPalette } from "./command-palette.ts";
import { contextMenu } from "./context-menu.ts";
import { settings } from "./settings.ts";
import { terminal } from "./terminal.ts";
import { workspace } from "./workspace.ts";

export const zhCN = {
  commandPalette,
  contextMenu,
  settings,
  terminal,
  workspace,
} as const;

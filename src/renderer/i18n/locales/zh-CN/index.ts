import { commandPalette } from "./command-palette.ts";
import { contextMenu } from "./context-menu.ts";
import { dialog } from "./dialog.ts";
import { settings } from "./settings.ts";
import { terminal } from "./terminal.ts";
import { workspace } from "./workspace.ts";
import { worktree } from "./worktree.ts";

export const zhCN = {
  commandPalette,
  contextMenu,
  dialog,
  settings,
  terminal,
  workspace,
  worktree,
} as const;

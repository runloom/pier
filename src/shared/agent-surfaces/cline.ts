/**
 * Cline CLI TUI composer surface.
 * Evidence: cline/cline apps/cli/src/tui/commands/slash-command-registry.ts
 * TUI_LOCAL_COMMANDS.
 */
import { defineComposerSurface } from "./types.ts";

export const clineComposerSurface = defineComposerSurface({
  builtinCommands: [
    {
      id: "compact",
      description: "Compact the current context",
    },
    {
      id: "undo",
      description: "Restore the workspace to a previous checkpoint",
    },
    {
      id: "clear",
      description: "Start a new session",
    },
  ],
});

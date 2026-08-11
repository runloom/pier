/**
 * OpenCode composer surface.
 * Evidence: https://opencode.ai/docs/tui built-in commands; session.* ids
 * in the installed binary.
 */
import { defineComposerSurface } from "./types.ts";

export const opencodeComposerSurface = defineComposerSurface({
  builtinCommands: [
    {
      id: "init",
      description: "Create or update the AGENTS.md project context file",
    },
    {
      id: "compact",
      description: "Compact the current session context",
    },
    {
      id: "new",
      description: "Start a new session",
    },
    {
      id: "undo",
      description: "Undo the last message and revert its file changes",
    },
    {
      id: "redo",
      description: "Redo a previously undone message",
    },
    {
      id: "share",
      description: "Share the current session via a public link",
    },
  ],
});

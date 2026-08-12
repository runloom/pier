/**
 * Cursor CLI (`cursor-agent`) composer surface.
 * Evidence: https://cursor.com/docs/cli/reference/slash-commands.md
 */
import { defineComposerSurface } from "./types.ts";

export const cursorComposerSurface = defineComposerSurface({
  builtinCommands: [
    {
      id: "plan",
      description: "Switch to plan mode, optionally submitting a prompt",
    },
    {
      id: "ask",
      description: "Toggle ask mode for read-only questions",
    },
    {
      id: "summarize",
      description: "Summarize the conversation to reduce context",
    },
    {
      id: "clear",
      description: "Start a new chat session",
    },
  ],
});

/**
 * Goose interactive session composer surface.
 * Evidence: block/goose documentation/docs/guides/goose-cli-commands.md
 * "Slash Commands" section.
 */
import { defineComposerSurface } from "./types.ts";

export const gooseComposerSurface = defineComposerSurface({
  builtinCommands: [
    {
      id: "plan",
      description: "Enter plan mode, optionally starting from a message",
    },
    {
      id: "endplan",
      description: "Exit plan mode back to normal mode",
    },
    {
      id: "compact",
      description: "Summarize the conversation to reduce context length",
    },
    {
      id: "clear",
      description: "Clear the current chat history",
    },
  ],
});

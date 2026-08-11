/**
 * Continue CLI (`cn`) composer surface.
 * Evidence: continuedev/continue extensions/cli/src/commands/commands.ts
 * SYSTEM_SLASH_COMMANDS.
 */
import { defineComposerSurface } from "./types.ts";

export const continueComposerSurface = defineComposerSurface({
  builtinCommands: [
    {
      id: "init",
      description: "Create an AGENTS.md file for this project",
    },
    {
      id: "compact",
      description: "Summarize the chat history into a compact form",
    },
    {
      id: "clear",
      description: "Clear the chat history",
    },
  ],
});

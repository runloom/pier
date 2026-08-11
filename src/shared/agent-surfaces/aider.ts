/**
 * Aider composer surface (slash-first CLI).
 * Evidence: Aider-AI/aider aider/commands.py `cmd_*` methods.
 */
import { defineComposerSurface } from "./types.ts";

export const aiderComposerSurface = defineComposerSurface({
  builtinCommands: [
    {
      id: "add",
      description: "Add files to the chat so aider can edit them",
    },
    {
      id: "drop",
      description: "Remove files from the chat (all files if no args)",
    },
    {
      id: "ask",
      description: "Ask about the code base without editing any files",
    },
    {
      id: "architect",
      description: "Ask with the architect/editor model pair",
    },
    {
      id: "code",
      description: "Ask for changes to your code",
    },
    {
      id: "diff",
      description: "Show diffs of changes since the last message",
    },
    {
      id: "undo",
      description: "Undo the last git commit made by aider",
    },
    {
      id: "clear",
      description: "Clear the chat history",
    },
  ],
});

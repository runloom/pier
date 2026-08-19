/**
 * Command Code composer surface.
 * Evidence: https://commandcode.ai/docs/reference/slash-commands
 * Text-composable, prompt-adjacent only (no `/model` / `/resume` pickers).
 * `/new` is an alias of `/clear` — insert the canonical `/clear`.
 * Skills still insert as `/id`; `/skill:` is only the collision namespace.
 */
import { defineComposerSurface } from "./types.ts";

export const commandCodeComposerSurface = defineComposerSurface({
  builtinCommands: [
    {
      id: "plan",
      description: "Enter plan mode, optionally with a task to plan",
    },
    {
      id: "compact",
      description: "Compact the conversation history",
    },
    {
      id: "clear",
      description: "Start a new session with empty context",
    },
    {
      id: "init",
      description: "Initialize AGENTS.md for this project",
    },
    {
      id: "review",
      description: "Review a pull request",
    },
    {
      id: "fork",
      description: "Fork the conversation into a new session",
    },
    {
      id: "clone",
      description: "Clone the current branch into a new session",
    },
  ],
});

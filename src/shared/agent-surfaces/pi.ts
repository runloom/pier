/**
 * Pi composer surface.
 * Evidence: https://pi.dev/docs/latest/usage — Slash Commands.
 * Text-composable, prompt-adjacent only (no `/model` / `/settings` pickers).
 * Skills force-invoke separately as `/skill:<name>` (see skill-invoke.ts).
 */
import { defineComposerSurface } from "./types.ts";

export const piComposerSurface = defineComposerSurface({
  builtinCommands: [
    {
      id: "new",
      description: "Start a new session",
    },
    {
      id: "compact",
      description: "Summarize older context, optionally with a focus",
    },
    {
      id: "fork",
      description: "Create a new session from a previous user message",
    },
    {
      id: "clone",
      description: "Duplicate the current branch into a new session",
    },
    {
      id: "reload",
      description: "Reload keybindings, extensions, skills, and context files",
    },
  ],
});

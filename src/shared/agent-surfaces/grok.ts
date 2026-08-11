/**
 * Grok CLI composer surface.
 * Evidence: command reference embedded in the official binary
 * (grok 1.0.0 `### /…` help sections; no public repo).
 */
import { defineComposerSurface } from "./types.ts";

export const grokComposerSurface = defineComposerSurface({
  builtinCommands: [
    {
      id: "plan",
      description: "Switch to plan mode",
    },
    {
      id: "btw",
      description: "Ask a quick side question",
    },
    {
      id: "compact",
      description:
        "Compress conversation history, optionally noting what to keep",
    },
    {
      id: "new",
      description: "Start a new session",
    },
  ],
});

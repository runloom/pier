/**
 * Factory Droid CLI composer surface.
 * Evidence: https://docs.factory.ai/droid-cli/cli-reference.md
 */
import { defineComposerSurface } from "./types.ts";

export const droidComposerSurface = defineComposerSurface({
  builtinCommands: [
    {
      id: "btw",
      description: "Ask a side question without polluting the main transcript",
    },
    {
      id: "review",
      description: "Start an AI-powered code review workflow",
    },
    {
      id: "clear",
      description: "Clear conversation context, keeping model and autonomy",
    },
    {
      id: "new",
      description: "Start a fresh session with default model and autonomy",
    },
  ],
});

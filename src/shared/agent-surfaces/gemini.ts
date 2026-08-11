/**
 * Gemini CLI composer surface.
 * Evidence: google-gemini/gemini-cli docs/reference/commands.md
 * (verified against installed 0.53.1 bundle). Compression is `/compress`.
 */
import { defineComposerSurface } from "./types.ts";

export const geminiComposerSurface = defineComposerSurface({
  builtinCommands: [
    {
      id: "plan",
      description: "Switch to plan mode and view the current plan",
    },
    {
      id: "compress",
      description: "Replace the conversation context with a summary",
    },
    {
      id: "init",
      description: "Analyze the project and create a tailored GEMINI.md",
    },
    {
      id: "clear",
      description: "Clear the screen and start a new session",
    },
  ],
});

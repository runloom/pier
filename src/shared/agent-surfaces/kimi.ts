/**
 * Kimi CLI composer surface.
 * Evidence: MoonshotAI/kimi-cli soul/slash.py + ui/shell/slash.py
 * (verified against installed 1.49.0).
 */
import { defineComposerSurface } from "./types.ts";

export const kimiComposerSurface = defineComposerSurface({
  builtinCommands: [
    {
      id: "plan",
      description: "Toggle plan mode (on/off/view/clear)",
    },
    {
      id: "btw",
      description: "Ask a side question without interrupting the main chat",
    },
    {
      id: "compact",
      description: "Compact the context, optionally with a custom focus",
    },
    {
      id: "init",
      description: "Analyze the codebase and generate an AGENTS.md file",
    },
    {
      id: "clear",
      description: "Clear the context",
    },
  ],
});

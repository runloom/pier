/**
 * Qwen Code composer surface (gemini-cli fork, command superset).
 * Evidence: QwenLM/qwen-code docs/users/features/commands.md.
 */
import { defineComposerSurface } from "./types.ts";

export const qwenCodeComposerSurface = defineComposerSurface({
  builtinCommands: [
    {
      id: "plan",
      description: "Enter plan mode, optionally with a task to plan",
    },
    {
      id: "btw",
      description: "Ask a quick side question without touching the main flow",
    },
    {
      id: "compress",
      description: "Replace the conversation history with a summary",
    },
    {
      id: "init",
      description: "Analyze the project and create a QWEN.md context file",
    },
    {
      id: "review",
      description: "Run a multi-agent code review of current changes",
    },
    {
      id: "clear",
      description: "Clear the conversation history and free up context",
    },
  ],
});

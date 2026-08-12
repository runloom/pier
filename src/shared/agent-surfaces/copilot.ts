/**
 * GitHub Copilot CLI composer surface.
 * Evidence: `copilot` interactive `/help` output.
 */
import { defineComposerSurface } from "./types.ts";

export const copilotComposerSurface = defineComposerSurface({
  builtinCommands: [
    {
      id: "plan",
      description: "Create an implementation plan before coding",
    },
    {
      id: "ask",
      description: "Ask a quick side question outside the conversation history",
    },
    {
      id: "compact",
      description: "Summarize conversation history to reduce context usage",
    },
    {
      id: "init",
      description: "Initialize Copilot instructions for this repository",
    },
    {
      id: "review",
      description: "Run the code review agent on current changes",
    },
    {
      id: "security-review",
      description: "Analyze staged and unstaged changes for vulnerabilities",
    },
  ],
});

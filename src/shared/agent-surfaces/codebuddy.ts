/**
 * CodeBuddy CLI composer surface.
 * Evidence: command registry in @tencent-ai/codebuddy-code 2.132.0 dist.
 */
import { defineComposerSurface } from "./types.ts";

export const codebuddyComposerSurface = defineComposerSurface({
  builtinCommands: [
    {
      id: "plan",
      description: "Preview the current plan file content",
    },
    {
      id: "btw",
      description: "Ask a quick side question without interrupting the work",
    },
    {
      id: "compact",
      description: "Summarize the conversation to reduce context usage",
    },
    {
      id: "init",
      description: "Initialize project instructions for this repository",
    },
    {
      id: "review",
      description: "Review a pull request",
    },
    {
      id: "clear",
      description: "Start a fresh conversation",
    },
  ],
});

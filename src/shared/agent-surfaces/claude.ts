/**
 * Claude Code composer surface.
 * Evidence: https://code.claude.com/docs/en/commands
 * Bundled skills: https://code.claude.com/docs/en/skills
 */
import { defineComposerSurface } from "./types.ts";

export const claudeComposerSurface = defineComposerSurface({
  builtinCommands: [
    {
      id: "plan",
      description: "Enter plan mode, optionally starting from a description",
    },
    {
      id: "btw",
      description:
        "Ask a quick side question without touching the conversation",
    },
    {
      id: "compact",
      description: "Summarize the conversation to free up context",
    },
    {
      id: "init",
      description: "Initialize the project with a CLAUDE.md guide",
    },
    {
      id: "clear",
      description: "Start a new conversation with empty context",
    },
  ],
  bundledSkills: [
    {
      id: "code-review",
      description: "Review code changes for quality, risks, and follow-ups",
      explicitOnly: true,
    },
    {
      id: "doctor",
      description: "Diagnose Claude Code setup and environment health",
    },
    {
      id: "debug",
      description: "Debug failures with structured investigation steps",
    },
    {
      id: "verify",
      description: "Build and run the app to confirm a change works",
      explicitOnly: true,
    },
    {
      id: "batch",
      description: "Run a multi-step batch workflow across files",
    },
    {
      id: "loop",
      description: "Repeat a task until a stop condition is met",
    },
  ],
});

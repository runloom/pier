/**
 * Codex CLI composer surface.
 * Commands: https://developers.openai.com/codex/cli (built-in slash table;
 * `/btw` for ephemeral side chat). Skills use `$id`; commands stay literal `/id`.
 * Bundled: well-known system skills under ~/.codex/skills/.system.
 */
import { defineComposerSurface } from "./types.ts";

export const codexComposerSurface = defineComposerSurface({
  builtinCommands: [
    {
      id: "plan",
      description: "Switch to plan mode and optionally send a prompt",
    },
    {
      id: "btw",
      description: "Start an ephemeral side chat for a focused follow-up",
    },
    {
      id: "compact",
      description: "Summarize the visible chat to free tokens",
    },
    {
      id: "init",
      description: "Generate an AGENTS.md scaffold in the current directory",
    },
    {
      id: "review",
      description: "Ask Codex to review your working tree",
    },
  ],
  bundledSkills: [
    {
      id: "skill-creator",
      description: "Create or refine a Codex skill package",
    },
  ],
});

/**
 * OMP composer surface.
 * Evidence: https://omp.sh/docs/slash — text-composable, prompt-adjacent
 * commands only (no TUI pickers like /model or /settings).
 */
import { defineComposerSurface } from "./types.ts";

export const ompComposerSurface = defineComposerSurface({
  builtinCommands: [
    {
      id: "plan",
      description: "Toggle plan mode; the agent drafts before it executes",
    },
    {
      id: "btw",
      description:
        "Ask an ephemeral side question without polluting the transcript",
    },
    {
      id: "compact",
      description: "Summarize older conversation, optionally with a focus",
    },
    {
      id: "new",
      description: "Start a new session",
    },
    {
      id: "retry",
      description: "Resubmit the same input after a failed turn",
    },
    {
      id: "loop",
      description: "Iterate until the task is done or the budget runs out",
    },
    {
      id: "handoff",
      description: "Write a structured wrap-up and end the turn",
    },
  ],
});

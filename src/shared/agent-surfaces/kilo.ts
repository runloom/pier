/**
 * Kilo CLI composer surface (OpenCode fork + first-party review).
 * Evidence: same session.* command ids as OpenCode in the installed binary;
 * `/review` from packages/opencode/src/kilocode/cli sources.
 */
import { opencodeComposerSurface } from "./opencode.ts";
import { defineComposerSurface } from "./types.ts";

export const kiloComposerSurface = defineComposerSurface({
  builtinCommands: [
    ...opencodeComposerSurface.builtinCommands,
    {
      id: "review",
      description: "Review code changes (uncommitted, staged, branch…)",
    },
  ],
});

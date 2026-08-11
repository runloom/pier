/**
 * Per-agent **composer surface** for Enhanced Input L1.
 *
 * L1 invocable catalog = disk discovery ∪ bundledSkills ∪ builtinCommands.
 * Host-owned static knowledge (not main hook integrations, not user settings).
 *
 * Inclusion for builtinCommands:
 * 1. Documented in official docs / `/help` / installed command registry.
 * 2. Text-composable: pasting `/cmd [args]` + Enter works (no picker-only).
 * 3. Prompt-adjacent (plan / side question / compact / review / init), not
 *    pure TUI chrome. Insert text is always the literal `/id` (Codex `$`
 *    applies only to skills via skillInvokeText).
 *
 * Agents with no surface entry (or empty tables) still allow free-typed
 * `/xxx` via Enter passthrough to the PTY.
 */

export interface AgentBuiltinCommand {
  /**
   * English fallback description. UI prefers
   * `terminal.composer.commandDesc.<agentKind>.<id>` when present.
   */
  description: string;
  /** Command id without slash, e.g. plan → `/plan`. */
  id: string;
}

export interface AgentBundledSkill {
  /**
   * English fallback description. UI prefers
   * `terminal.composer.skillDesc.<agentKind>.<id>` when present.
   */
  description: string;
  /**
   * Claude documents some bundled skills as user-invoked only (not auto).
   * Reserved for future ranking / copy; listing still includes them.
   */
  explicitOnly?: boolean;
  /** Force-invoke id, e.g. code-review → `/code-review`. */
  id: string;
  /** Display label; defaults to id when omitted. */
  label?: string;
}

/** Host-maintained invocable surface for one agent kind. */
export interface AgentComposerSurface {
  /**
   * Documented built-in slash commands (TUI fixed logic, not skills).
   * Default empty when omitted.
   */
  readonly builtinCommands?: readonly AgentBuiltinCommand[];
  /**
   * Runtime-bundled skills not present on disk discovery.
   * Default empty when omitted. Host/Grok roots never belong here.
   */
  readonly bundledSkills?: readonly AgentBundledSkill[];
}

export interface ResolvedAgentComposerSurface {
  readonly builtinCommands: readonly AgentBuiltinCommand[];
  readonly bundledSkills: readonly AgentBundledSkill[];
}

export const EMPTY_COMPOSER_SURFACE: ResolvedAgentComposerSurface = {
  builtinCommands: [],
  bundledSkills: [],
};

/** Normalize optional fields to a resolved surface object. */
export function defineComposerSurface(
  surface: AgentComposerSurface
): ResolvedAgentComposerSurface {
  return {
    builtinCommands: surface.builtinCommands ?? [],
    bundledSkills: surface.bundledSkills ?? [],
  };
}

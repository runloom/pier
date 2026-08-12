/**
 * Agent-native skill force-invoke text for Rich Input insertion.
 *
 * | Agent family | Insert form | Notes |
 * |--------------|-------------|--------|
 * | Codex        | `$skill-id` | CLI custom skills; `/` is for commands |
 * | Claude / most skill TUIs | `/skill-id` | Official slash invoke |
 *
 * Only agents with **verified** skill force-invoke support get a prefix.
 * Others return null so L1 never inserts a fake `/skill` for agents that
 * cannot force-invoke (e.g. aider — skills only via manual context).
 *
 * Commands always use literal `/id` in the suggest builder (not this helper).
 * Host never loads SKILL.md body into the message — agents resolve id under
 * their discovery roots after Pier projection.
 */

export type SkillInvokePrefix = "/" | "$";

/**
 * Agents that force-invoke skills with `$name`.
 * Keep tight: only verified dollar invokers.
 */
const DOLLAR_INVOKE_AGENTS = new Set<string>(["codex"]);

/**
 * Agents with verified slash-style skill force-invoke (`/id`).
 * Mirrors project-skills skill discovery adapters (runtime + audit with
 * non-empty roots). Palette-driven CLIs (amp/crush) still discover skills
 * but do not expose a text slash catalog — exclude from force-invoke insert.
 *
 * Intentionally absent (no native force-invoke catalog):
 * aider, goose, continue, hermes, and any unknown kind.
 */
const SLASH_INVOKE_AGENTS = new Set<string>([
  "ante",
  "antigravity",
  "aug",
  "autohand",
  "claude",
  "cline",
  "codebuddy",
  "codebuff",
  "command-code",
  "copilot",
  "cursor",
  "devin",
  "droid",
  "gemini",
  "grok",
  "kilo",
  "kimi",
  "kiro",
  "mimo-code",
  "mistral-vibe",
  "omp",
  "openclaude",
  "openclaw",
  "opencode",
  "pi",
  "qodercli",
  "qwen-code",
  "rovo",
]);

/**
 * Prefix for the running agent. Unknown / unsupported / missing → null
 * (caller skips skill rows; commands use a separate path).
 */
export function skillInvokePrefix(
  agentKind: string | null | undefined
): SkillInvokePrefix | null {
  if (typeof agentKind !== "string" || agentKind.length === 0) {
    return null;
  }
  if (DOLLAR_INVOKE_AGENTS.has(agentKind)) {
    return "$";
  }
  if (SLASH_INVOKE_AGENTS.has(agentKind)) {
    return "/";
  }
  return null;
}

/** True when this agent can force-invoke skills by id in Enhanced Input. */
export function agentSupportsSkillForceInvoke(
  agentKind: string | null | undefined
): boolean {
  return skillInvokePrefix(agentKind) != null;
}

/** Full invoke text, e.g. `/code-review` or `$prd`. */
export function skillInvokeText(
  agentKind: string | null | undefined,
  skillId: string
): string | null {
  const prefix = skillInvokePrefix(agentKind);
  if (prefix == null || skillId.length === 0) {
    return null;
  }
  return `${prefix}${skillId}`;
}

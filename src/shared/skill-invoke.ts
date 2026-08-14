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
 * aider, continue, hermes, amp/crush (palette), and any unknown kind.
 * goose: not bare `/id` — uses `/skills <name>` (handled in skillInvokeText).
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
 *
 * goose is force-invocable via `/skills <id>` but has no single-char prefix;
 * {@link skillInvokeText} handles it; this helper returns null for goose.
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
  if (agentKind === "goose") {
    return true;
  }
  return skillInvokePrefix(agentKind) != null;
}

/** Full invoke text, e.g. `/code-review`, `$prd`, or goose `/skills id`. */
export function skillInvokeText(
  agentKind: string | null | undefined,
  skillId: string
): string | null {
  if (typeof agentKind !== "string" || skillId.length === 0) {
    return null;
  }
  // Goose CLI: `/skills <name>` loads skill(s) by name (official using-skills).
  if (agentKind === "goose") {
    return `/skills ${skillId}`;
  }
  const prefix = skillInvokePrefix(agentKind);
  if (prefix == null) {
    return null;
  }
  return `${prefix}${skillId}`;
}

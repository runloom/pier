/**
 * Agent-native skill invocation text for Rich Input insertion.
 *
 * UI always opens the picker with `$` (Codex App habit). What we **insert**
 * is not always `/name` — it depends on the foreground agent TUI:
 *
 * | Agent family | Insert form   | Notes |
 * |--------------|---------------|--------|
 * | Codex        | `$skill-id`   | CLI custom skills; `/` often ignored |
 * | Claude Code  | `/skill-id`   | Official slash invoke |
 * | Cursor / most slash TUIs | `/skill-id` | Slash menus |
 *
 * Skills themselves are just ids + SKILL.md; the prefix is the **agent’s**
 * force-invoke syntax, not part of the skill file. Auto-invocation needs no
 * prefix (user free-text); this path is for explicit pick → send.
 *
 * Host never loads SKILL.md body into the message.
 */

export type SkillInvokePrefix = "/" | "$";

/**
 * Agents whose TUI force-invokes skills with `$name` (not `/name`).
 * Keep tight: only verified dollar invokers.
 */
const DOLLAR_INVOKE_AGENTS = new Set<string>(["codex"]);

/**
 * Prefix for the running agent. Unknown/missing agent → null (caller skips).
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
  // Claude, Cursor, OpenCode, Gemini, …: slash-style invoke is the default.
  return "/";
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

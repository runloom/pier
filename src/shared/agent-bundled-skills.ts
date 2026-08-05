/**
 * Agent **runtime-bundled** skills (not on disk).
 *
 * Enhanced Input L1 invocable catalog = disk discovery ∪ this table.
 * Host/Grok skills (~/.grok/skills) are never listed here.
 *
 * Evidence: official docs only; keep the whitelist small (MVP).
 * Claude: https://code.claude.com/docs/en/skills (bundled skills section).
 */

export interface AgentBundledSkill {
  /** Short product description (English; UI may i18n later). */
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

/**
 * Claude Code (and openclaude-compatible) bundled skills.
 * Prefer documented Skill entries over every built-in slash command.
 */
const CLAUDE_BUNDLED_SKILLS: readonly AgentBundledSkill[] = [
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
];

/**
 * Codex ships a few system skills under ~/.codex/skills/.system (docs/blog).
 * Only list well-known force-invocable names; empty is safer than guessing.
 */
const CODEX_BUNDLED_SKILLS: readonly AgentBundledSkill[] = [
  {
    id: "skill-creator",
    description: "Create or refine a Codex skill package",
  },
  {
    id: "plan",
    description: "Plan a multi-step change before editing",
  },
];

const BY_AGENT: Readonly<Record<string, readonly AgentBundledSkill[]>> = {
  claude: CLAUDE_BUNDLED_SKILLS,
  openclaude: CLAUDE_BUNDLED_SKILLS,
  codex: CODEX_BUNDLED_SKILLS,
};

/** Bundled skills for one foreground agent kind; empty if unknown. */
export function listBundledSkills(
  agentKind: string | null | undefined
): readonly AgentBundledSkill[] {
  if (typeof agentKind !== "string" || agentKind.length === 0) {
    return [];
  }
  return BY_AGENT[agentKind] ?? [];
}

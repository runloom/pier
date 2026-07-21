import { AUDIT_ONLY_SKILL_DISCOVERY_ADAPTERS } from "./adapter-facts-audit.ts";
import type { SkillDiscoveryAdapter } from "./adapters.ts";

/**
 * Skill discovery adapter fact table (design v8 §2.2), split from adapters.ts
 * (file-size cap). One entry per AgentKind with verified official Agent
 * Skills support; every entry carries officialDocsUrl + verifiedOn evidence.
 *
 * `consumesProjectSkills` semantics:
 * - true  — the agent scans at least one Pier projection target
 *   (`.agents/skills` / `.claude/skills`), so Pier-managed skills can reach
 *   it; it participates in the effective matrix and ManagedAgentLaunchGate.
 * - false — verified skills support, but only product-private roots that
 *   Pier never writes (e.g. `.kiro/skills`); the entry is audit evidence
 *   only and has no runtime effect (not gated, no matrix cells).
 *
 * AgentKinds audited on 2026-07-20 and intentionally NOT registered:
 * - aider — no native skills discovery; SKILL.md only loads via manual
 *   `--read` context files (aider.chat docs; community shims exist).
 * - goose — upstream skills platform extension exists but the official docs
 *   page is unavailable and the discovery-root set is version-unstable
 *   (recently re-standardized on `~/.agents/skills` upstream); no adapter
 *   until stable official docs + probe evidence.
 * - continue — CLI skills support merged upstream
 *   (continuedev/continue#9696: `.continue/skills`, `.claude/skills`,
 *   `$CONTINUE_HOME/skills`) but no official docs page yet (#11758).
 */
export const SKILL_DISCOVERY_ADAPTERS: readonly SkillDiscoveryAdapter[] = [
  {
    agentKind: "codex",
    discoveryRoots: [".agents/skills", ".codex/skills"],
    userDiscoveryRoots: ["~/.agents/skills", "~/.codex/skills"],
    walkUpToRepoRoot: true,
    consumesProjectSkills: true,
    duplicateSemantics: "coexist",
    duplicatePolicy: "report",
    sessionRefresh: "new-session-recommended",
    probeCaveats: [],
    officialDocsUrl: "https://developers.openai.com/codex/skills",
    verifiedOn: "2026-07-19",
  },
  {
    agentKind: "claude",
    discoveryRoots: [".claude/skills"],
    userDiscoveryRoots: ["~/.claude/skills"],
    walkUpToRepoRoot: false,
    consumesProjectSkills: true,
    duplicateSemantics: "user-shadows-project",
    duplicatePolicy: "report",
    sessionRefresh: "live-watch-docs-only",
    probeCaveats: [],
    officialDocsUrl: "https://code.claude.com/docs/en/skills",
    verifiedOn: "2026-07-19",
  },
  {
    agentKind: "opencode",
    // Ordered by OpenCode precedence: project .opencode > .agents > .claude.
    discoveryRoots: [".opencode/skills", ".agents/skills", ".claude/skills"],
    userDiscoveryRoots: [
      "~/.config/opencode/skills",
      "~/.agents/skills",
      "~/.claude/skills",
    ],
    walkUpToRepoRoot: true,
    consumesProjectSkills: true,
    duplicateSemantics: "priority-override",
    duplicatePolicy: "report",
    sessionRefresh: "new-session-recommended",
    probeCaveats: [],
    officialDocsUrl: "https://opencode.ai/docs/skills/",
    verifiedOn: "2026-07-19",
  },
  {
    agentKind: "cursor",
    discoveryRoots: [
      ".agents/skills",
      ".cursor/skills",
      ".claude/skills",
      ".codex/skills",
    ],
    userDiscoveryRoots: [
      "~/.cursor/skills",
      "~/.agents/skills",
      "~/.claude/skills",
      "~/.codex/skills",
    ],
    walkUpToRepoRoot: false,
    consumesProjectSkills: true,
    duplicateSemantics: "multi-root-scan",
    duplicatePolicy: "report",
    sessionRefresh: "new-session-recommended",
    probeCaveats: [
      "~/.agents/skills: agent auto-invocation loads it, CLI / menu may not (confirmed bug); probe per version",
    ],
    officialDocsUrl: "https://cursor.com/docs/skills",
    verifiedOn: "2026-07-19",
  },
  {
    agentKind: "gemini",
    // Within a tier the .agents alias wins over .gemini; workspace beats user.
    discoveryRoots: [".agents/skills", ".gemini/skills"],
    userDiscoveryRoots: ["~/.agents/skills", "~/.gemini/skills"],
    walkUpToRepoRoot: false,
    consumesProjectSkills: true,
    duplicateSemantics: "priority-override",
    duplicatePolicy: "report",
    sessionRefresh: "new-session-recommended",
    probeCaveats: [],
    officialDocsUrl: "https://geminicli.com/docs/cli/skills.md",
    verifiedOn: "2026-07-20",
  },
  {
    agentKind: "antigravity",
    discoveryRoots: [".agents/skills"],
    userDiscoveryRoots: ["~/.gemini/antigravity-cli/skills"],
    walkUpToRepoRoot: false,
    consumesProjectSkills: true,
    duplicateSemantics: "multi-root-scan",
    duplicatePolicy: "report",
    sessionRefresh: "new-session-recommended",
    probeCaveats: [
      "user-level root differs per surface: Antigravity IDE reads ~/.agents/skills, the CLI (agy) reads ~/.gemini/antigravity-cli/skills; probe per version",
    ],
    officialDocsUrl:
      "https://codelabs.developers.google.com/antigravity/how-to-create-agent-skills-for-antigravity-cli",
    verifiedOn: "2026-07-20",
  },
  {
    agentKind: "amp",
    discoveryRoots: [".agents/skills", ".claude/skills"],
    // Amp precedence is first-wins with user roots ahead of project roots.
    userDiscoveryRoots: [
      "~/.config/agents/skills",
      "~/.agents/skills",
      "~/.config/amp/skills",
      "~/.claude/skills",
    ],
    walkUpToRepoRoot: false,
    consumesProjectSkills: true,
    duplicateSemantics: "user-shadows-project",
    duplicatePolicy: "report",
    sessionRefresh: "new-session-recommended",
    probeCaveats: [
      "~/.claude/skills is Amp's lowest-precedence root (below project roots); user-shadows applies to the agents/amp user roots only",
    ],
    officialDocsUrl: "https://ampcode.com/manual/agent-skills.md",
    verifiedOn: "2026-07-20",
  },
  {
    agentKind: "copilot",
    discoveryRoots: [".github/skills", ".claude/skills", ".agents/skills"],
    userDiscoveryRoots: ["~/.copilot/skills", "~/.agents/skills"],
    walkUpToRepoRoot: false,
    consumesProjectSkills: true,
    duplicateSemantics: "multi-root-scan",
    duplicatePolicy: "report",
    sessionRefresh: "new-session-recommended",
    probeCaveats: [],
    officialDocsUrl:
      "https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills",
    verifiedOn: "2026-07-20",
  },
  {
    agentKind: "kimi",
    // Priority tiers: project > user > extra > built-in.
    discoveryRoots: [".kimi-code/skills", ".agents/skills"],
    userDiscoveryRoots: ["~/.kimi-code/skills", "~/.agents/skills"],
    walkUpToRepoRoot: true,
    consumesProjectSkills: true,
    duplicateSemantics: "priority-override",
    duplicatePolicy: "report",
    sessionRefresh: "new-session-recommended",
    probeCaveats: [
      "~/.kimi-code/skills moves with KIMI_CODE_HOME; isolated data roots relocate the kimi-specific user root",
    ],
    officialDocsUrl:
      "https://www.kimi.com/code/docs/en/kimi-code-cli/customization/skills.html",
    verifiedOn: "2026-07-20",
  },
  {
    agentKind: "cline",
    discoveryRoots: [".cline/skills", ".clinerules/skills", ".claude/skills"],
    userDiscoveryRoots: ["~/.cline/skills"],
    walkUpToRepoRoot: false,
    consumesProjectSkills: true,
    // Documented: a same-named global skill takes precedence over project.
    duplicateSemantics: "user-shadows-project",
    duplicatePolicy: "report",
    sessionRefresh: "new-session-recommended",
    probeCaveats: [],
    officialDocsUrl: "https://docs.cline.bot/customization/skills",
    verifiedOn: "2026-07-20",
  },
  {
    agentKind: "crush",
    discoveryRoots: [
      ".agents/skills",
      ".crush/skills",
      ".claude/skills",
      ".cursor/skills",
    ],
    userDiscoveryRoots: [
      "~/.config/agents/skills",
      "~/.config/crush/skills",
      "~/.agents/skills",
      "~/.claude/skills",
    ],
    walkUpToRepoRoot: false,
    consumesProjectSkills: true,
    duplicateSemantics: "multi-root-scan",
    duplicatePolicy: "report",
    sessionRefresh: "new-session-recommended",
    probeCaveats: [
      "CRUSH_SKILLS_DIR and options.skills_paths add configurable roots outside this fixed set",
    ],
    officialDocsUrl: "https://github.com/charmbracelet/crush#agent-skills",
    verifiedOn: "2026-07-20",
  },
  {
    agentKind: "aug",
    discoveryRoots: [".augment/skills", ".claude/skills", ".agents/skills"],
    // Documented precedence: user home locations beat workspace locations.
    userDiscoveryRoots: [
      "~/.augment/skills",
      "~/.claude/skills",
      "~/.agents/skills",
    ],
    walkUpToRepoRoot: false,
    consumesProjectSkills: true,
    duplicateSemantics: "user-shadows-project",
    duplicatePolicy: "report",
    sessionRefresh: "new-session-recommended",
    probeCaveats: [],
    officialDocsUrl: "https://docs.augmentcode.com/cli/skills",
    verifiedOn: "2026-07-20",
  },
  {
    agentKind: "command-code",
    discoveryRoots: [".commandcode/skills", ".agents/skills"],
    userDiscoveryRoots: ["~/.commandcode/skills", "~/.agents/skills"],
    walkUpToRepoRoot: false,
    consumesProjectSkills: true,
    duplicateSemantics: "multi-root-scan",
    duplicatePolicy: "report",
    sessionRefresh: "new-session-recommended",
    probeCaveats: [],
    officialDocsUrl: "https://commandcode.ai/docs/skills",
    verifiedOn: "2026-07-20",
  },
  {
    agentKind: "rovo",
    discoveryRoots: [".rovodev/skills", ".agents/skills"],
    userDiscoveryRoots: ["~/.rovodev/skills"],
    walkUpToRepoRoot: false,
    consumesProjectSkills: true,
    duplicateSemantics: "multi-root-scan",
    duplicatePolicy: "report",
    sessionRefresh: "new-session-recommended",
    probeCaveats: [],
    officialDocsUrl:
      "https://support.atlassian.com/rovo/docs/extend-rovo-dev-cli-with-agent-skills/",
    verifiedOn: "2026-07-20",
  },
  {
    agentKind: "pi",
    discoveryRoots: [".pi/skills", ".agents/skills"],
    userDiscoveryRoots: ["~/.pi/agent/skills", "~/.agents/skills"],
    walkUpToRepoRoot: true,
    consumesProjectSkills: true,
    duplicateSemantics: "multi-root-scan",
    duplicatePolicy: "report",
    sessionRefresh: "new-session-recommended",
    probeCaveats: [],
    officialDocsUrl: "https://pi.dev/docs/latest/skills",
    verifiedOn: "2026-07-20",
  },
  {
    agentKind: "devin",
    discoveryRoots: [".agents/skills", ".devin/skills", ".windsurf/skills"],
    userDiscoveryRoots: ["~/.agents/skills", "~/.config/devin/skills"],
    walkUpToRepoRoot: false,
    consumesProjectSkills: true,
    duplicateSemantics: "multi-root-scan",
    duplicatePolicy: "report",
    sessionRefresh: "new-session-recommended",
    probeCaveats: [
      "channel-dependent global root ~/.codeium/<channel>/skills is not modeled; probe per install channel",
    ],
    officialDocsUrl: "https://docs.devin.ai/cli/extensibility/skills/overview",
    verifiedOn: "2026-07-20",
  },
  {
    agentKind: "kilo",
    // Documented: project-level skills take precedence over global.
    discoveryRoots: [".kilo/skills", ".agents/skills", ".claude/skills"],
    userDiscoveryRoots: ["~/.kilo/skills"],
    walkUpToRepoRoot: false,
    consumesProjectSkills: true,
    duplicateSemantics: "priority-override",
    duplicatePolicy: "report",
    sessionRefresh: "new-session-recommended",
    probeCaveats: [],
    officialDocsUrl: "https://kilo.ai/docs/customize/skills",
    verifiedOn: "2026-07-20",
  },
  {
    agentKind: "codebuff",
    // Documented order: later wins — project .agents highest.
    discoveryRoots: [".agents/skills", ".claude/skills"],
    userDiscoveryRoots: ["~/.agents/skills", "~/.claude/skills"],
    walkUpToRepoRoot: false,
    consumesProjectSkills: true,
    duplicateSemantics: "priority-override",
    duplicatePolicy: "report",
    sessionRefresh: "new-session-recommended",
    probeCaveats: [],
    officialDocsUrl: "https://www.codebuff.com/docs/tips/skills",
    verifiedOn: "2026-07-20",
  },
  {
    agentKind: "mistral-vibe",
    // First match wins: .vibe > .agents > user global.
    discoveryRoots: [".vibe/skills", ".agents/skills"],
    userDiscoveryRoots: ["~/.vibe/skills"],
    walkUpToRepoRoot: false,
    consumesProjectSkills: true,
    duplicateSemantics: "priority-override",
    duplicatePolicy: "report",
    sessionRefresh: "new-session-recommended",
    probeCaveats: [
      "project roots load only when the working directory is a trusted folder",
    ],
    officialDocsUrl: "https://docs.mistral.ai/vibe/code/cli/skills",
    verifiedOn: "2026-07-20",
  },
  {
    agentKind: "autohand",
    discoveryRoots: [".autohand/skills", ".claude/skills", ".agents/skills"],
    userDiscoveryRoots: [
      "~/.autohand/skills",
      "~/.claude/skills",
      "~/.codex/skills",
      "~/.agents/skills",
    ],
    walkUpToRepoRoot: false,
    consumesProjectSkills: true,
    duplicateSemantics: "multi-root-scan",
    duplicatePolicy: "report",
    sessionRefresh: "new-session-recommended",
    probeCaveats: [
      "discovered Codex/Claude skills are auto-copied into .autohand locations; the same content may surface under two roots",
    ],
    officialDocsUrl:
      "https://docs.autohand.ai/working-with-autohand-code/agent-skills",
    verifiedOn: "2026-07-20",
  },
  {
    agentKind: "openclaw",
    // Priority order: workspace skills/ > .agents > ~/.agents > ~/.openclaw.
    discoveryRoots: ["skills", ".agents/skills"],
    userDiscoveryRoots: ["~/.agents/skills", "~/.openclaw/skills"],
    walkUpToRepoRoot: false,
    consumesProjectSkills: true,
    duplicateSemantics: "priority-override",
    duplicatePolicy: "report",
    sessionRefresh: "new-session-recommended",
    probeCaveats: [
      "workspace-level `skills/` root is excluded from Pier's unmanaged enumeration (non-dot root, too generic a directory name)",
    ],
    officialDocsUrl: "https://docs.openclaw.ai/tools/skills",
    verifiedOn: "2026-07-20",
  },
  {
    agentKind: "mimo-code",
    discoveryRoots: [
      ".mimocode/skills",
      ".claude/skills",
      ".agents/skills",
      ".codex/skills",
      ".opencode/skills",
    ],
    userDiscoveryRoots: [
      "~/.config/mimocode/skills",
      "~/.claude/skills",
      "~/.agents/skills",
      "~/.codex/skills",
      "~/.opencode/skills",
    ],
    walkUpToRepoRoot: true,
    consumesProjectSkills: true,
    // Duplicate names are silently overridden (last loaded wins).
    duplicateSemantics: "priority-override",
    duplicatePolicy: "report",
    sessionRefresh: "new-session-recommended",
    probeCaveats: [
      "SKILL.md discovery is recursive under each root; Claude-compat roots can be disabled via MIMOCODE_DISABLE_CLAUDE_CODE_SKILLS",
    ],
    officialDocsUrl: "https://mimo.xiaomi.com/mimocode/skills",
    verifiedOn: "2026-07-20",
  },
  {
    agentKind: "omp",
    // Provider priorities: native .omp > claude > codex > github.
    discoveryRoots: [
      ".omp/skills",
      ".claude/skills",
      ".codex/skills",
      ".github/skills",
    ],
    userDiscoveryRoots: [
      "~/.omp/agent/skills",
      "~/.claude/skills",
      "~/.codex/skills",
    ],
    walkUpToRepoRoot: false,
    consumesProjectSkills: true,
    duplicateSemantics: "priority-override",
    duplicatePolicy: "report",
    sessionRefresh: "new-session-recommended",
    probeCaveats: [],
    officialDocsUrl: "https://omp.sh/docs/skills",
    verifiedOn: "2026-07-20",
  },
  {
    agentKind: "openclaude",
    discoveryRoots: [".claude/skills"],
    userDiscoveryRoots: ["~/.claude/skills"],
    walkUpToRepoRoot: false,
    consumesProjectSkills: true,
    duplicateSemantics: "multi-root-scan",
    duplicatePolicy: "report",
    sessionRefresh: "new-session-recommended",
    probeCaveats: [
      "Claude Code fork; same-name user/project precedence is not separately documented — probe before promising shadowing semantics",
    ],
    officialDocsUrl: "https://openclaude.gitlawb.com/docs/skills/",
    verifiedOn: "2026-07-20",
  },
  ...AUDIT_ONLY_SKILL_DISCOVERY_ADAPTERS,
] as const;

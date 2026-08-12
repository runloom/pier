import type { SkillDiscoveryAdapter } from "./adapters.ts";

/**
 * Extended consuming adapter entries (design v8 §2.2), split from
 * adapter-facts.ts (file-size cap). Newer verified Agent Skills consumers
 * that scan Pier projection targets (`.agents/skills` / `.claude/skills`).
 */
export const EXTENDED_SKILL_DISCOVERY_ADAPTERS: readonly SkillDiscoveryAdapter[] =
  [
    {
      agentKind: "openclaude",
      discoveryRoots: [".claude/skills"],
      userDiscoveryRoots: ["~/.claude/skills"],
      // Same project discovery model as Claude Code (parent walk to repo root).
      walkUpToRepoRoot: true,
      consumesProjectSkills: true,
      duplicateSemantics: "multi-root-scan",
      duplicatePolicy: "report",
      sessionRefresh: "new-session-recommended",
      probeCaveats: [
        "Claude Code fork; same-name user/project precedence is not separately documented — probe before promising shadowing semantics",
      ],
      officialDocsUrl: "https://openclaude.gitlawb.com/docs/skills/",
      verifiedOn: "2026-08-12",
    },
    {
      // Grok TUI + Enhanced Input: native `.grok` plus `.agents` (Pier system
      // skills land here), Claude/Cursor compat roots. Higher-priority location
      // wins by name (not multi-root duplicate). Walks cwd → repo root.
      // Evidence: ~/.grok/docs/user-guide/08-skills.md + docs.x.ai skills page.
      agentKind: "grok",
      discoveryRoots: [
        ".grok/skills",
        ".agents/skills",
        ".claude/skills",
        ".cursor/skills",
      ],
      userDiscoveryRoots: [
        "~/.grok/skills",
        "~/.agents/skills",
        "~/.claude/skills",
        "~/.cursor/skills",
      ],
      walkUpToRepoRoot: true,
      consumesProjectSkills: true,
      duplicateSemantics: "priority-override",
      duplicatePolicy: "report",
      // Product docs: skill file changes reload into the slash menu without a
      // new session (same model as Claude's live-watch fact).
      sessionRefresh: "live-watch-docs-only",
      probeCaveats: [
        "Pier projects managed/system skills only to .agents/skills (and optional .claude/skills); never writes ~/.grok/skills or project .grok/skills",
        "Claude/Cursor skill roots are default-on but disableable via [compat.claude]/skills / [compat.cursor].skills or GROK_CLAUDE_SKILLS_ENABLED / GROK_CURSOR_SKILLS_ENABLED; matrix always models them as scanned",
      ],
      officialDocsUrl:
        "https://docs.x.ai/build/features/skills-plugins-marketplaces",
      verifiedOn: "2026-08-12",
    },
    {
      // Goose Skills platform extension (default on). Recommended roots are
      // `.agents/skills` / `~/.agents/skills`; also discovers `.goose/skills`
      // and Claude-compat roots. Evidence: block/goose docs using-skills.md.
      agentKind: "goose",
      discoveryRoots: [".agents/skills", ".goose/skills", ".claude/skills"],
      userDiscoveryRoots: ["~/.agents/skills", "~/.claude/skills"],
      walkUpToRepoRoot: false,
      consumesProjectSkills: true,
      duplicateSemantics: "priority-override",
      duplicatePolicy: "report",
      sessionRefresh: "new-session-recommended",
      probeCaveats: [
        "CLI also exposes /skills <name> multi-load; bare /skill-id force-invoke is not separately documented — skill-invoke still uses slash family for L1",
      ],
      officialDocsUrl:
        "https://block.github.io/goose/docs/guides/context-engineering/using-skills/",
      verifiedOn: "2026-08-12",
    },
    {
      // Droid native `.factory/skills` + Agent Skills compatibility roots
      // `.agents/skills` (and `.agent/skills`, not a Pier projection target).
      // Evidence: https://docs.factory.ai/harness/skills.md “Where skills live”.
      agentKind: "droid",
      discoveryRoots: [".factory/skills", ".agents/skills"],
      userDiscoveryRoots: ["~/.factory/skills", "~/.agents/skills"],
      walkUpToRepoRoot: false,
      consumesProjectSkills: true,
      // Project/folder-specific factory skills beat personal/built-in.
      duplicateSemantics: "priority-override",
      duplicatePolicy: "report",
      sessionRefresh: "new-session-recommended",
      probeCaveats: [
        "Also scans recursive .agent/skills (singular) compatibility roots; Pier does not project there",
        "Folder-specific <area>/.factory/skills is not modeled as a separate discovery root",
      ],
      officialDocsUrl: "https://docs.factory.ai/harness/skills",
      verifiedOn: "2026-08-12",
    },
  ] as const;

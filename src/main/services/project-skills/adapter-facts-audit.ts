import type { SkillDiscoveryAdapter } from "./adapters.ts";

/**
 * Audit-evidence-only adapter entries (design v8 §2.2, verified 2026-07-20),
 * split from adapter-facts.ts (file-size cap): agents with verified official
 * skills support but only product-private discovery roots that Pier never
 * projects into. `consumesProjectSkills: false` — not launch-gated, no
 * matrix cells, roots outside Pier enumeration.
 */
export const AUDIT_ONLY_SKILL_DISCOVERY_ADAPTERS: readonly SkillDiscoveryAdapter[] =
  [
    {
      agentKind: "kiro",
      discoveryRoots: [".kiro/skills"],
      userDiscoveryRoots: ["~/.kiro/skills"],
      walkUpToRepoRoot: false,
      consumesProjectSkills: false,
      duplicateSemantics: "multi-root-scan",
      duplicatePolicy: "report",
      sessionRefresh: "new-session-recommended",
      probeCaveats: [
        "custom agents load skills only when skill:// resources are configured",
      ],
      officialDocsUrl: "https://kiro.dev/docs/cli/skills/",
      verifiedOn: "2026-07-20",
    },
    {
      agentKind: "qwen-code",
      discoveryRoots: [".qwen/skills"],
      userDiscoveryRoots: ["~/.qwen/skills"],
      walkUpToRepoRoot: false,
      consumesProjectSkills: false,
      duplicateSemantics: "multi-root-scan",
      duplicatePolicy: "report",
      sessionRefresh: "new-session-recommended",
      probeCaveats: [],
      officialDocsUrl:
        "https://qwenlm.github.io/qwen-code-docs/en/users/features/skills/",
      verifiedOn: "2026-07-20",
    },
    {
      agentKind: "codebuddy",
      discoveryRoots: [".codebuddy/skills"],
      userDiscoveryRoots: ["~/.codebuddy/skills"],
      walkUpToRepoRoot: false,
      consumesProjectSkills: false,
      duplicateSemantics: "multi-root-scan",
      duplicatePolicy: "report",
      sessionRefresh: "new-session-recommended",
      probeCaveats: [],
      officialDocsUrl: "https://www.codebuddy.ai/docs/cli/skills",
      verifiedOn: "2026-07-20",
    },
    {
      agentKind: "qodercli",
      discoveryRoots: [".qoder/skills"],
      userDiscoveryRoots: ["~/.qoder/skills"],
      walkUpToRepoRoot: false,
      consumesProjectSkills: false,
      // Documented: project-level takes priority over user-level.
      duplicateSemantics: "priority-override",
      duplicatePolicy: "report",
      sessionRefresh: "new-session-recommended",
      probeCaveats: [],
      officialDocsUrl: "https://docs.qoder.com/en/cli/Skills",
      verifiedOn: "2026-07-20",
    },
    {
      agentKind: "grok",
      discoveryRoots: [".grok/skills"],
      userDiscoveryRoots: ["~/.grok/skills", "~/.agents/skills"],
      walkUpToRepoRoot: true,
      consumesProjectSkills: false,
      duplicateSemantics: "multi-root-scan",
      duplicatePolicy: "report",
      sessionRefresh: "new-session-recommended",
      probeCaveats: [],
      officialDocsUrl:
        "https://docs.x.ai/build/features/skills-plugins-marketplaces",
      verifiedOn: "2026-07-20",
    },
    {
      agentKind: "droid",
      discoveryRoots: [".factory/skills"],
      userDiscoveryRoots: ["~/.factory/skills"],
      walkUpToRepoRoot: false,
      consumesProjectSkills: false,
      duplicateSemantics: "multi-root-scan",
      duplicatePolicy: "report",
      sessionRefresh: "new-session-recommended",
      probeCaveats: [],
      officialDocsUrl: "https://docs.factory.ai/cli/configuration/skills",
      verifiedOn: "2026-07-20",
    },
    {
      agentKind: "ante",
      discoveryRoots: [".ante/skills"],
      userDiscoveryRoots: ["~/.ante/skills"],
      walkUpToRepoRoot: false,
      consumesProjectSkills: false,
      duplicateSemantics: "multi-root-scan",
      duplicatePolicy: "report",
      sessionRefresh: "new-session-recommended",
      probeCaveats: [],
      officialDocsUrl: "https://github.com/AntigmaLabs/ante-preview",
      verifiedOn: "2026-07-20",
    },
    {
      agentKind: "hermes",
      // No project-level discovery; skills live only under the user root.
      discoveryRoots: [],
      userDiscoveryRoots: ["~/.hermes/skills"],
      walkUpToRepoRoot: false,
      consumesProjectSkills: false,
      duplicateSemantics: "multi-root-scan",
      duplicatePolicy: "report",
      sessionRefresh: "new-session-recommended",
      probeCaveats: [
        "config skills.external_dirs can add extra read-only roots; not modeled",
      ],
      officialDocsUrl:
        "https://hermes-agent.nousresearch.com/docs/user-guide/features/skills",
      verifiedOn: "2026-07-20",
    },
  ] as const;

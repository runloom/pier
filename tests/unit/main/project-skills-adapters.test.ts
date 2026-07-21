import {
  createSkillDiscoveryAdapterRegistry,
  listDuplicateDiscoveryAgentKinds,
  listProjectDiscoveryRoots,
  SKILL_DISCOVERY_ADAPTERS,
  type SkillDiscoveryAdapter,
} from "@main/services/project-skills/adapters.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import { describe, expect, it } from "vitest";

describe("project-skills discovery adapters", () => {
  it("registers every audited AgentKind with official skills docs (2026-07-20)", () => {
    const registry = createSkillDiscoveryAdapterRegistry();
    const kinds = registry
      .list()
      .map((a) => a.agentKind)
      .sort();
    expect(kinds).toEqual(
      [
        // Consume Pier projection targets (.agents/.claude):
        "claude",
        "codex",
        "cursor",
        "opencode",
        "gemini",
        "antigravity",
        "amp",
        "copilot",
        "kimi",
        "cline",
        "crush",
        "aug",
        "command-code",
        "rovo",
        "pi",
        "devin",
        "kilo",
        "codebuff",
        "mistral-vibe",
        "autohand",
        "openclaw",
        "mimo-code",
        "omp",
        "openclaude",
        // Verified skills support, private roots only (audit evidence):
        "kiro",
        "qwen-code",
        "codebuddy",
        "qodercli",
        "grok",
        "droid",
        "ante",
        "hermes",
      ].sort()
    );
  });

  it("every adapter entry carries evidence (officialDocsUrl + verifiedOn)", () => {
    for (const adapter of SKILL_DISCOVERY_ADAPTERS) {
      expect(adapter.officialDocsUrl).toMatch(/^https:\/\//);
      expect(adapter.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("consuming adapters scan at least one Pier projection target", () => {
    for (const adapter of SKILL_DISCOVERY_ADAPTERS) {
      const scansProjectionTarget = adapter.discoveryRoots.some(
        (root) => root === ".agents/skills" || root === ".claude/skills"
      );
      expect(adapter.consumesProjectSkills).toBe(scansProjectionTarget);
    }
  });

  it("exposes v8 discovery facts (verified 2026-07-19)", () => {
    const byKind = new Map(
      SKILL_DISCOVERY_ADAPTERS.map((a) => [a.agentKind, a] as const)
    );

    // Codex: .agents walk-up + .codex project layer; dual user roots
    // (~/.agents current official, ~/.codex deprecated but still loaded).
    expect(byKind.get("codex")).toMatchObject({
      agentKind: "codex",
      discoveryRoots: [".agents/skills", ".codex/skills"],
      userDiscoveryRoots: ["~/.agents/skills", "~/.codex/skills"],
      walkUpToRepoRoot: true,
      consumesProjectSkills: true,
      duplicateSemantics: "coexist",
      duplicatePolicy: "report",
    } satisfies Partial<SkillDiscoveryAdapter>);

    // Claude Code: enterprise > user > project — user shadows project.
    expect(byKind.get("claude")).toMatchObject({
      agentKind: "claude",
      discoveryRoots: [".claude/skills"],
      userDiscoveryRoots: ["~/.claude/skills"],
      duplicateSemantics: "user-shadows-project",
      consumesProjectSkills: true,
      duplicatePolicy: "report",
      sessionRefresh: "live-watch-docs-only",
    });

    // OpenCode: priority override, project .opencode highest.
    expect(byKind.get("opencode")?.discoveryRoots).toEqual([
      ".opencode/skills",
      ".agents/skills",
      ".claude/skills",
    ]);
    expect(byKind.get("opencode")?.duplicateSemantics).toBe(
      "priority-override"
    );
    expect(byKind.get("opencode")?.consumesProjectSkills).toBe(true);

    expect(byKind.get("cursor")?.discoveryRoots).toEqual([
      ".agents/skills",
      ".cursor/skills",
      ".claude/skills",
      ".codex/skills",
    ]);
    expect(byKind.get("cursor")?.duplicateSemantics).toBe("multi-root-scan");
    expect(byKind.get("cursor")?.probeCaveats.length).toBeGreaterThan(0);
    expect(byKind.get("cursor")?.consumesProjectSkills).toBe(true);
  });

  it("marks only true duplicate scanners when Claude delivery is on (v8: OpenCode overrides, not duplicates)", () => {
    const registry = createSkillDiscoveryAdapterRegistry();
    const duplicateKinds = listDuplicateDiscoveryAgentKinds({
      registry,
      dualDelivery: true,
    }).sort();
    // Priority-override / user-shadows scanners resolve same-name copies
    // deterministically; only multi-root scanners that read BOTH projection
    // targets surface duplicates.
    expect(duplicateKinds).toEqual(["autohand", "copilot", "crush", "cursor"]);

    expect(
      listDuplicateDiscoveryAgentKinds({
        registry,
        dualDelivery: false,
      })
    ).toEqual([]);
  });

  it("returns undefined / not-applicable for agents without verified skills support", () => {
    const registry = createSkillDiscoveryAdapterRegistry();
    // aider has no native skills discovery (audited 2026-07-20, see
    // adapter-facts.ts) — not registered at all.
    const unregistered = "aider" as AgentKind;
    expect(registry.get(unregistered)).toBeUndefined();
    expect(registry.isApplicable(unregistered)).toBe(false);
    // kiro is registered as audit evidence but scans only private roots —
    // not applicable, so it never participates in the launch gate.
    expect(registry.get("kiro")).toBeDefined();
    expect(registry.isApplicable("kiro")).toBe(false);
    expect(registry.isApplicable("codex")).toBe(true);
  });

  it("uses report-only duplicate policy for every registered adapter", () => {
    for (const adapter of SKILL_DISCOVERY_ADAPTERS) {
      expect(adapter.duplicatePolicy).toBe("report");
      if (adapter.consumesProjectSkills) {
        expect(adapter.discoveryRoots.length).toBeGreaterThan(0);
      }
      for (const root of adapter.discoveryRoots) {
        expect(root.startsWith("/")).toBe(false);
        expect(root.includes("..")).toBe(false);
      }
    }
  });

  it("derives project discovery roots from consuming adapters (dot roots only)", () => {
    const registry = createSkillDiscoveryAdapterRegistry();
    const roots = listProjectDiscoveryRoots(registry);
    expect(roots).toContain(".agents/skills");
    expect(roots).toContain(".claude/skills");
    expect(roots).toContain(".gemini/skills");
    // OpenClaw's workspace-level `skills/` root is a matrix fact only.
    expect(roots).not.toContain("skills");
    // Private roots of non-consuming adapters stay out of enumeration.
    expect(roots).not.toContain(".kiro/skills");
    expect(new Set(roots).size).toBe(roots.length);
    for (const root of roots) {
      expect(root.startsWith(".")).toBe(true);
    }
  });
});

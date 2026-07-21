import type { AgentKind } from "../../../shared/contracts/agent.ts";
import { SKILL_DISCOVERY_ADAPTERS } from "./adapter-facts.ts";

/**
 * Skill discovery adapter registry (design v8 §2.2 / §5.1). The fact table
 * lives in adapter-facts.ts (file-size cap); this module owns the types and
 * every derived root list. Only agents that consume Pier project skill
 * projections participate in ManagedAgentLaunchGate; others are
 * not-applicable.
 *
 * Root-list ownership (single source of truth = the adapter registry):
 * - project discovery roots  → `listProjectDiscoveryRoots(registry)`
 * - user (global) roots      → `listUserSkillRoots(registry)`
 * - Pier projection targets  → `PIER_PROJECTION_TARGET_*` constants below
 */
export type SkillDiscoverySessionRefresh =
  | "new-session-recommended"
  | "live-watch-docs-only";

/**
 * Same-name semantics across scanned roots (design v8 §2.1):
 * - `coexist` — Codex: same-named skills are not merged, both appear.
 * - `user-shadows-project` — Claude Code: enterprise > user > project.
 * - `priority-override` — OpenCode: project root wins, extras are overridden.
 * - `multi-root-scan` — Cursor: all roots scanned; duplicates surface.
 */
export type SkillDuplicateSemantics =
  | "coexist"
  | "user-shadows-project"
  | "priority-override"
  | "multi-root-scan";

export interface SkillDiscoveryAdapter {
  agentKind: AgentKind;
  consumesProjectSkills: boolean;
  /**
   * Project-relative discovery roots, POSIX separators, ordered by the
   * agent's own precedence (highest first) where semantics are priority-based.
   */
  discoveryRoots: readonly string[];
  /** v1 only reports multi-root duplicates; never silently merge. */
  duplicatePolicy: "report";
  duplicateSemantics: SkillDuplicateSemantics;
  /**
   * Official docs URL (evidence only; not used for path inference at runtime).
   */
  officialDocsUrl: string;
  /**
   * Known root-level caveats requiring version probing before promising
   * visibility (e.g. Cursor CLI `/` menu not scanning `~/.agents/skills`).
   */
  probeCaveats: readonly string[];
  sessionRefresh: SkillDiscoverySessionRefresh;
  /**
   * User-level (`~`-relative) discovery roots — the fixed whitelist input for
   * the user-global read-only enumeration (design v8 §6.1). Never written by
   * Pier.
   */
  userDiscoveryRoots: readonly string[];
  /** Evidence verification date (ISO date). */
  verifiedOn: string;
  /** Codex scans project roots walking up to the repository root. */
  walkUpToRepoRoot: boolean;
}

export { SKILL_DISCOVERY_ADAPTERS } from "./adapter-facts.ts";

/**
 * Pier projection target roots. These are Pier's OUTPUT surface (where apply
 * writes managed symlinks), a fixed two-root subset of the registry's
 * discovery roots. Each root is opt-in via manifest `delivery`; none selected
 * ⇒ no projection. Plan/repair own the projection semantics; the registry
 * owns which agents scan these roots.
 */
export const PIER_PROJECTION_TARGET_AGENTS_ROOT = ".agents/skills";
export const PIER_PROJECTION_TARGET_CLAUDE_ROOT = ".claude/skills";

export interface SkillDiscoveryAdapterRegistry {
  get(agentKind: AgentKind): SkillDiscoveryAdapter | undefined;
  isApplicable(agentKind: AgentKind): boolean;
  list(): readonly SkillDiscoveryAdapter[];
}

export function createSkillDiscoveryAdapterRegistry(
  adapters: readonly SkillDiscoveryAdapter[] = SKILL_DISCOVERY_ADAPTERS
): SkillDiscoveryAdapterRegistry {
  const byKind = new Map<AgentKind, SkillDiscoveryAdapter>();
  for (const adapter of adapters) {
    byKind.set(adapter.agentKind, adapter);
  }

  return {
    list(): readonly SkillDiscoveryAdapter[] {
      return adapters;
    },
    get(agentKind: AgentKind): SkillDiscoveryAdapter | undefined {
      return byKind.get(agentKind);
    },
    isApplicable(agentKind: AgentKind): boolean {
      const adapter = byKind.get(agentKind);
      return adapter?.consumesProjectSkills === true;
    },
  };
}

/**
 * Registry-derived project discovery roots scanned for unmanaged entries
 * (layer 5) and accepted by discovery imports. Deduplicated union of the
 * project roots of consuming adapters, preserving registry order.
 *
 * Non-dot roots (OpenClaw's workspace `skills/`) are excluded from
 * enumeration: a top-level `skills/` directory is too generic a name to
 * treat as a skill surface in arbitrary repositories. They remain adapter
 * facts for the effective matrix.
 */
export function listProjectDiscoveryRoots(
  registry: SkillDiscoveryAdapterRegistry
): string[] {
  const roots: string[] = [];
  for (const adapter of registry.list()) {
    if (!adapter.consumesProjectSkills) continue;
    for (const root of adapter.discoveryRoots) {
      if (!root.startsWith(".")) continue;
      if (!roots.includes(root)) {
        roots.push(root);
      }
    }
  }
  return roots;
}

/**
 * Registry-derived fixed whitelist of user-level skill roots for the
 * user-global read-only enumeration (design v8 §6.1). `~`-relative,
 * deduplicated, each annotated with the agents that scan it. Never accepts
 * caller paths.
 */
export function listUserSkillRoots(
  registry: SkillDiscoveryAdapterRegistry
): Array<{ root: string; readByAgents: AgentKind[] }> {
  const byRoot = new Map<string, AgentKind[]>();
  for (const adapter of registry.list()) {
    if (!adapter.consumesProjectSkills) continue;
    for (const root of adapter.userDiscoveryRoots) {
      const agents = byRoot.get(root) ?? [];
      if (!agents.includes(adapter.agentKind)) {
        agents.push(adapter.agentKind);
      }
      byRoot.set(root, agents);
    }
  }
  return [...byRoot.entries()]
    .map(([root, readByAgents]) => ({ root, readByAgents }))
    .sort((a, b) => a.root.localeCompare(b.root));
}

/**
 * Multi-root scanners that can surface the same skill twice when both Pier
 * projection roots are selected.
 */
export function listDuplicateDiscoveryAgentKinds(args: {
  registry: SkillDiscoveryAdapterRegistry;
  dualDelivery: boolean;
}): AgentKind[] {
  if (!args.dualDelivery) {
    return [];
  }
  const kinds: AgentKind[] = [];
  for (const adapter of args.registry.list()) {
    if (!adapter.consumesProjectSkills) continue;
    if (adapter.duplicatePolicy !== "report") continue;
    // Priority-override scanners resolve same-name copies deterministically
    // (one copy wins); only coexist / multi-root scanners surface duplicates.
    if (adapter.duplicateSemantics === "priority-override") continue;
    if (adapter.duplicateSemantics === "user-shadows-project") continue;
    const roots = new Set(adapter.discoveryRoots);
    if (
      roots.has(PIER_PROJECTION_TARGET_AGENTS_ROOT) &&
      roots.has(PIER_PROJECTION_TARGET_CLAUDE_ROOT)
    ) {
      kinds.push(adapter.agentKind);
    }
  }
  return kinds;
}

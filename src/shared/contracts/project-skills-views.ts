import type { ProjectSkillSource } from "./project-skills.ts";

/**
 * Project skills renderer-facing view types (design v8 §2.1 / §3.6), split
 * from project-skills.ts (file-size cap). Pure types — no schemas.
 */

/** Six-layer skill landscape; Pier manages only `project-managed`. */
export type SkillLayer =
  | "system"
  | "enterprise"
  | "user-global"
  | "plugin"
  | "project-unmanaged"
  | "project-managed";

/**
 * Per (skill, agent) effective state derived by main's effective-matrix
 * derivation. Layer-3 facts (shadowing/override) never block anything.
 */
export type SkillAgentEffect =
  | { state: "discoverable"; viaRoot: string }
  | { state: "not-projected" }
  | {
      state: "shadowed-by-user";
      viaRoot: string;
      shadowedByRoot: string;
    }
  | { state: "overridden"; viaRoot: string; overriddenByRoot: string }
  | { state: "duplicate"; roots: string[] }
  | { state: "root-not-scanned" }
  | { state: "agent-not-installed" }
  | { state: "not-applicable" }
  | { state: "unknown-version"; viaRoot: string };

export interface SkillEffectiveCell {
  agentKind: string;
  effect: SkillAgentEffect;
}

/** Managed skill view (design v8 §3.6 ProjectSkillView). */
export interface ProjectSkillView {
  /**
   * Pier Home always-include lock. True only for `managedBy: "pier-bound"`
   * rows that cannot be unbound from the project (IA v5).
   */
  alwaysInclude: boolean;
  /**
   * Current on-disk library tree digest. Used as the edit-base digest for
   * content-update TOCTOU (baseContentDigest) and, for system/pier-bound
   * rows, version convergence. Disk content is authoritative — there is no
   * separate "expected" manifest digest.
   */
  contentDigest: string;
  /**
   * Explicit per-skill discovery channels when set on the manifest entry.
   * Null means inherit project `manifest.delivery` (legacy).
   */
  delivery: { agents: boolean; claude: boolean } | null;
  description: string;
  /** Library tree breakdown (same shape as import candidates, §7.5). */
  directorySummary: {
    skillMd: boolean;
    scripts: number;
    references: number;
    assets: number;
    otherFiles: number;
  } | null;
  effects: SkillEffectiveCell[];
  enabled: boolean;
  fileCount: number;
  id: string;
  issueIds: string[];
  /** Managed origin: user manifest entry vs Pier system / Pier Home bind. */
  managedBy: "user" | "pier-system" | "pier-bound";
  /** From library SKILL.md frontmatter; empty string when unparsable. */
  name: string;
  riskSummary: {
    executables: string[];
    dynamicCommandTraces: string[];
    riskFrontmatter: Record<string, unknown>;
  } | null;
  /**
   * Origin of the skill content:
   * - user sources (`local-import` / …) for project-managed rows
   * - `pier-home` for Pier Home library binds
   * - `pier-system` for app/plugin-bundled system skills (provider id+version)
   */
  source:
    | ProjectSkillSource
    | { type: "pier-home" }
    | {
        type: "pier-system";
        providerId: string;
        providerVersion: string;
      };
  totalBytes: number;
  /**
   * From SKILL.md `user-invocable` (default true). When false, Enhanced Input
   * must not offer a force-invoke row (Grok hides non-invocable skills).
   */
  userInvocable: boolean;
}

/** Unmanaged discovery-root entry (layer 5), read-only. */
export interface UnmanagedSkillView {
  description: string;
  directoryName: string;
  effects: SkillEffectiveCell[];
  kind: "real-directory" | "foreign-symlink";
  name: string;
  /** Discovery root, e.g. `.claude/skills`. */
  root: string;
  /** From SKILL.md `user-invocable`; default true when unknown. */
  userInvocable: boolean;
}

/**
 * User-global entry (layer 3), read-only: it takes effect for this project
 * too, so the unified list shows it alongside managed/unmanaged skills.
 */
export interface UserGlobalSkillView {
  description: string;
  directoryName: string;
  effects: SkillEffectiveCell[];
  name: string;
  /** `~`-relative user root, e.g. `~/.claude/skills`. */
  root: string;
  /** From SKILL.md `user-invocable`; default true when unknown. */
  userInvocable: boolean;
}

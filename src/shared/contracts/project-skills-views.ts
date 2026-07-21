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
   * Actual on-disk library tree digest when it differs from the manifest
   * digest (drift, design §3.5); null while they match or unreadable.
   */
  actualContentDigest: string | null;
  contentDigest: string;
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
  /** Managed origin: user manifest entry vs Pier system channel. */
  managedBy: "user" | "pier-system";
  /** From library SKILL.md frontmatter; empty string when unparsable. */
  name: string;
  riskSummary: {
    executables: string[];
    dynamicCommandTraces: string[];
    riskFrontmatter: Record<string, unknown>;
  } | null;
  source: ProjectSkillSource;
  totalBytes: number;
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
}

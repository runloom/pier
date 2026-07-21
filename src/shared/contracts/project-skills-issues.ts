import { z } from "zod";

/**
 * Health issue codes + degrade policy (design §5.1), split from
 * project-skills.ts (file-size cap). Self-contained — imports only zod.
 */

export const PROJECT_SKILLS_ISSUE_CODES = [
  "disabled",
  "adapter-disabled",
  "agent-not-installed",
  "not-applicable",
  "shadowed-by-user-skill",
  "new-session-recommended",
  "git-visible-projection",
  "git-tracked-projection",
  "cleanup-pending",
  "projection-missing",
  "projection-stale",
  "recovery-pending",
  "missing-source",
  "invalid-skill",
  "library-drift",
  "content-conflict",
  "unmanaged-conflict",
  "managed-target-modified",
  "project-identity-changed",
  "ledger-corrupt",
  "recovery-record-corrupt",
  "recovery-blocked",
  "durability-unknown",
  "filesystem-unsupported",
  "permission-changed",
  "insufficient-space",
  "operation-busy",
  "duplicate-discovery",
  "agent-version-unsupported",
  "unknown-agent-behavior",
] as const;

export const projectSkillsIssueCodeSchema = z.enum(PROJECT_SKILLS_ISSUE_CODES);
export type ProjectSkillsIssueCode = z.infer<
  typeof projectSkillsIssueCodeSchema
>;

export const DEGRADE_POLICIES = [
  "allowed",
  "requires-content-risk-confirmation",
  "denied",
] as const;

export const degradePolicySchema = z.enum(DEGRADE_POLICIES);
export type DegradePolicy = z.infer<typeof degradePolicySchema>;

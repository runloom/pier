import type { AgentKind } from "../../../shared/contracts/agent.ts";
import {
  type ProjectRootRef as ContractProjectRootRef,
  type DegradePolicy,
  PROJECT_SKILLS_ISSUE_CODES,
  type ProjectSkillsIssueCode,
} from "../../../shared/contracts/project-skills.ts";

/**
 * Fixed health issue mapping table (design §5.1) + issue constructors,
 * split from health.ts (file-size cap). One row per issue code; the
 * exhaustiveness guard throws at module load when a code is missing.
 */

export type HealthIssueSeverity = "info" | "notice" | "warning" | "error";

export type HealthBlockingScope =
  | "enable"
  | "projection"
  | "launch"
  | "write"
  | "read";

export interface HealthIssueMapping {
  blockingScopes: readonly HealthBlockingScope[];
  code: ProjectSkillsIssueCode;
  degradePolicy: DegradePolicy;
  repairable: boolean;
  severity: HealthIssueSeverity;
}

export interface ProjectSkillsIssue {
  adapterKind?: AgentKind;
  blockingScopes: readonly HealthBlockingScope[];
  checkedAt: number;
  code: ProjectSkillsIssueCode;
  degradePolicy: DegradePolicy;
  evidence: Record<string, unknown>;
  id: string;
  relativeTarget?: string;
  repairable: boolean;
  scope: "skill" | "adapter" | "project" | "target";
  severity: HealthIssueSeverity;
  skillId?: string;
}

export interface SnapshotHealth {
  checkedAt: number;
  issues: ProjectSkillsIssue[];
  projectRef: ContractProjectRootRef;
}

const EMPTY_SCOPES: readonly HealthBlockingScope[] = [];

/** Design §5.1 fixed mapping — one row per issue code. */
export const HEALTH_ISSUE_MAPPINGS: readonly HealthIssueMapping[] = [
  {
    code: "disabled",
    severity: "info",
    blockingScopes: EMPTY_SCOPES,
    degradePolicy: "allowed",
    repairable: false,
  },
  {
    code: "adapter-disabled",
    severity: "info",
    blockingScopes: EMPTY_SCOPES,
    degradePolicy: "allowed",
    repairable: false,
  },
  {
    code: "agent-not-installed",
    severity: "info",
    blockingScopes: EMPTY_SCOPES,
    degradePolicy: "allowed",
    repairable: false,
  },
  {
    code: "not-applicable",
    severity: "info",
    blockingScopes: EMPTY_SCOPES,
    degradePolicy: "allowed",
    repairable: false,
  },
  // v8: layer-3 fact — a same-named user-global skill shadows the project
  // projection for user-shadows-project agents. Notice only, never blocks.
  {
    code: "shadowed-by-user-skill",
    severity: "notice",
    blockingScopes: EMPTY_SCOPES,
    degradePolicy: "allowed",
    repairable: false,
  },
  {
    code: "new-session-recommended",
    severity: "notice",
    blockingScopes: EMPTY_SCOPES,
    degradePolicy: "allowed",
    repairable: false,
  },
  {
    code: "git-visible-projection",
    severity: "notice",
    blockingScopes: EMPTY_SCOPES,
    degradePolicy: "allowed",
    repairable: false,
  },
  {
    code: "git-tracked-projection",
    severity: "notice",
    blockingScopes: EMPTY_SCOPES,
    degradePolicy: "allowed",
    repairable: false,
  },
  {
    code: "cleanup-pending",
    severity: "notice",
    blockingScopes: EMPTY_SCOPES,
    degradePolicy: "allowed",
    repairable: false,
  },
  {
    code: "projection-missing",
    severity: "warning",
    // Reported in settings; never gates agent spawn.
    blockingScopes: EMPTY_SCOPES,
    degradePolicy: "allowed",
    repairable: true,
  },
  {
    code: "projection-stale",
    severity: "warning",
    blockingScopes: EMPTY_SCOPES,
    degradePolicy: "allowed",
    repairable: true,
  },
  {
    code: "recovery-pending",
    severity: "warning",
    blockingScopes: EMPTY_SCOPES,
    degradePolicy: "allowed",
    repairable: true,
  },
  {
    code: "missing-source",
    severity: "error",
    // Settings-only integrity (delete / re-import). Opening an agent is not a
    // skills hygiene decision — never refuse spawn for library content gaps.
    blockingScopes: ["enable", "projection", "write"],
    degradePolicy: "denied",
    repairable: false,
  },
  {
    code: "invalid-skill",
    severity: "error",
    // Corrupt / unreadable project skill list (e.g. bad manifest.json).
    // Settings can repair or reset; agent launch must not be gated on it.
    blockingScopes: ["enable", "projection", "write"],
    degradePolicy: "denied",
    repairable: false,
  },
  {
    code: "content-conflict",
    severity: "error",
    blockingScopes: ["enable", "projection", "write"],
    degradePolicy: "denied",
    repairable: false,
  },
  {
    code: "unmanaged-conflict",
    severity: "error",
    // Settings-only integrity: foreign/unowned objects at a projection path
    // block enable/projection/write, but must NOT refuse opening an agent.
    // Launch is the user's intent — never a skills hygiene decision point.
    // Surface the state in settings; do not auto-adopt or prompt-to-block at
    // spawn.
    blockingScopes: ["enable", "projection", "write"],
    degradePolicy: "denied",
    repairable: false,
  },
  {
    code: "managed-target-modified",
    severity: "error",
    // Same as unmanaged-conflict: settings hygiene only. Do not refuse spawn.
    blockingScopes: ["enable", "projection", "write"],
    degradePolicy: "denied",
    repairable: false,
  },
  {
    code: "project-identity-changed",
    severity: "error",
    // Identity mismatch makes skills I/O unsafe; still do not refuse spawn —
    // the agent session itself does not depend on the skills ledger.
    blockingScopes: ["read", "write"],
    degradePolicy: "denied",
    repairable: false,
  },
  {
    code: "ledger-corrupt",
    severity: "error",
    // Machine-local ownership ledger corrupt: block skills writes only.
    blockingScopes: ["write"],
    degradePolicy: "denied",
    repairable: false,
  },
  {
    code: "recovery-record-corrupt",
    severity: "error",
    blockingScopes: ["write"],
    degradePolicy: "denied",
    repairable: false,
  },
  {
    code: "recovery-blocked",
    severity: "error",
    blockingScopes: ["write"],
    degradePolicy: "denied",
    repairable: false,
  },
  {
    code: "durability-unknown",
    severity: "error",
    blockingScopes: ["write"],
    degradePolicy: "denied",
    repairable: false,
  },
  {
    code: "filesystem-unsupported",
    severity: "error",
    blockingScopes: ["write"],
    degradePolicy: "denied",
    repairable: false,
  },
  {
    code: "permission-changed",
    severity: "error",
    blockingScopes: ["write"],
    degradePolicy: "denied",
    repairable: false,
  },
  {
    code: "insufficient-space",
    severity: "error",
    blockingScopes: ["write"],
    degradePolicy: "denied",
    repairable: false,
  },
  {
    code: "operation-busy",
    severity: "error",
    blockingScopes: ["write"],
    degradePolicy: "denied",
    repairable: false,
  },
  {
    // v8.2: a documented consequence of the Claude delivery setting (the
    // toggle hint says so) — reported inline, never blocks apply or launch.
    code: "duplicate-discovery",
    severity: "notice",
    blockingScopes: EMPTY_SCOPES,
    degradePolicy: "allowed",
    repairable: false,
  },
  {
    code: "agent-version-unsupported",
    severity: "error",
    // Skills discovery caveat only — do not refuse opening the agent.
    blockingScopes: EMPTY_SCOPES,
    degradePolicy: "allowed",
    repairable: false,
  },
  {
    code: "unknown-agent-behavior",
    severity: "error",
    blockingScopes: EMPTY_SCOPES,
    degradePolicy: "allowed",
    repairable: false,
  },
] as const;

const MAPPING_BY_CODE: Readonly<
  Record<ProjectSkillsIssueCode, HealthIssueMapping>
> = (() => {
  const record = {} as Record<ProjectSkillsIssueCode, HealthIssueMapping>;
  for (const mapping of HEALTH_ISSUE_MAPPINGS) {
    record[mapping.code] = mapping;
  }
  // Exhaustiveness guard: every contract code must have a row.
  for (const code of PROJECT_SKILLS_ISSUE_CODES) {
    if (!(code in record)) {
      throw new Error(`missing health mapping for issue code: ${code}`);
    }
  }
  return record;
})();

export function getHealthIssueMapping(
  code: ProjectSkillsIssueCode
): HealthIssueMapping {
  return MAPPING_BY_CODE[code];
}

export function buildProjectSkillsIssue(args: {
  code: ProjectSkillsIssueCode;
  scope: ProjectSkillsIssue["scope"];
  skillId?: string;
  adapterKind?: AgentKind;
  relativeTarget?: string;
  evidence?: Record<string, unknown>;
  checkedAt: number;
  id?: string;
}): ProjectSkillsIssue {
  const mapping = getHealthIssueMapping(args.code);
  const id =
    args.id ??
    [
      args.code,
      args.skillId ?? "",
      args.adapterKind ?? "",
      args.relativeTarget ?? "",
    ].join(":");
  return {
    id,
    code: args.code,
    severity: mapping.severity,
    scope: args.scope,
    ...(args.skillId === undefined ? {} : { skillId: args.skillId }),
    ...(args.adapterKind === undefined
      ? {}
      : { adapterKind: args.adapterKind }),
    ...(args.relativeTarget === undefined
      ? {}
      : { relativeTarget: args.relativeTarget }),
    blockingScopes: mapping.blockingScopes,
    degradePolicy: mapping.degradePolicy,
    repairable: mapping.repairable,
    evidence: args.evidence ?? {},
    checkedAt: args.checkedAt,
  };
}

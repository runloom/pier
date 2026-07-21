import type {
  ProjectRootRef,
  ProjectSkillsDraft,
  ProjectSkillView,
  UnmanagedSkillView,
  UserGlobalSkillView,
} from "@shared/contracts/project-skills.ts";

/**
 * Project skills renderer view model: types, draft helpers, and IPC payload
 * normalizers, split from project-skills.store.ts (file-size cap).
 */

/** UI draft mirrors the shared contract draft 1:1. */
export type SkillsUiDraft = ProjectSkillsDraft;

export interface ProjectSkillsPlanView {
  applicable: boolean;
  blockingIssues: PlanIssueView[];
  confirmationRequirements: PlanConfirmationView[];
  draftFingerprint: string;
  gitStates?: Array<{
    relativeTarget: string;
    state: "absent" | "ignored" | "untracked" | "tracked" | "unknown";
  }>;
  observedRevision: string;
  planDigest: string;
}

export interface PlanConfirmationView {
  contentDigest?: string;
  expectedActualTreeDigest?: string;
  gitState?: string;
  id: string;
  kind: string;
  relativeTarget?: string;
  skillId?: string;
}

export interface PlanIssueView {
  adapterKind?: string;
  code: string;
  id: string;
  relativeTarget?: string;
  skillId?: string;
}

export interface ProjectSkillsProjectSummary {
  checkedAt: number;
  displayPath: string;
  projectRef: ProjectRootRef;
  readStatus: "ok" | "missing-manifest" | "invalid-manifest" | "error";
  skillCount: number;
  source: "panel" | "environment" | "unknown";
}

export interface ProjectSkillsSnapshotView {
  checkedAt: number;
  health: {
    issues: Array<{
      id: string;
      code: string;
      severity?: string;
      skillId?: string;
      adapterKind?: string;
      evidence?: Record<string, unknown>;
    }>;
  };
  manifest: {
    version?: number;
    delivery?: { agents?: boolean; claude?: boolean };
    skills?: unknown[];
  } | null;
  manifestRevision: string | null;
  observedRevision: string;
  projectRef: ProjectRootRef;
  skills: ProjectSkillView[];
  unmanagedSkills: UnmanagedSkillView[];
  userGlobalSkills: UserGlobalSkillView[];
}

export interface ImportCandidateView {
  baseContentDigest?: string;
  contentDigest: string;
  description: string;
  directorySummary?: {
    skillMd: boolean;
    scripts: number;
    references: number;
    assets: number;
    otherFiles: number;
  };
  expiresAt: number;
  fileCount: number;
  name: string;
  riskFingerprint: string;
  riskSummary?: {
    executables: string[];
    dynamicCommandTraces: string[];
    riskFrontmatter: Record<string, unknown>;
  };
  skillId: string;
  skillMdPreview?: string;
  skillMdTruncated?: boolean;
  sourceDisplayPath: string;
  sourceKind: string;
  token: string;
  totalBytes: number;
}

/** In-page modes (design v9 §7.1). */
/** Detail target: managed (editable) vs read-only discovered entries. */
export type SkillDetailTarget =
  | { kind: "managed"; skillId: string }
  | { kind: "project"; root: string; directoryName: string }
  | { kind: "user-global"; root: string; directoryName: string };

export type SkillsViewMode =
  | { kind: "projects" }
  | { kind: "detail" }
  | { kind: "skill-detail"; target: SkillDetailTarget }
  | { kind: "import-review"; candidate: ImportCandidateView };

export function emptyDraft(
  delivery: { agents?: boolean; claude?: boolean } = {}
): SkillsUiDraft {
  return {
    deleteSkillIds: [],
    deliveryAgents: delivery.agents === true,
    deliveryClaude: delivery.claude === true,
    enabledBySkillId: {},
    importTokens: [],
  };
}

export function draftFingerprint(draft: SkillsUiDraft): string {
  return JSON.stringify({
    deleteSkillIds: [...draft.deleteSkillIds].sort(),
    deliveryAgents: draft.deliveryAgents,
    deliveryClaude: draft.deliveryClaude,
    enabledBySkillId: Object.keys(draft.enabledBySkillId)
      .sort()
      .map((id) => [id, draft.enabledBySkillId[id]]),
    importTokens: [...draft.importTokens].sort(),
  });
}

type DraftSnapshotBaseline = {
  manifest?: {
    delivery?: { agents?: boolean; claude?: boolean };
  } | null;
  skills?: readonly {
    id: string;
    enabled: boolean;
  }[];
} | null;

/**
 * Dirty vs the loaded snapshot baseline.
 * `enabledBySkillId` only counts when it actually changes enablement.
 */
export function draftIsDirty(
  draft: SkillsUiDraft | null,
  snapshot: DraftSnapshotBaseline = null
): boolean {
  if (!draft) {
    return false;
  }
  const baselineAgents = Boolean(snapshot?.manifest?.delivery?.agents);
  const baselineClaude = Boolean(snapshot?.manifest?.delivery?.claude);
  if (
    draft.importTokens.length > 0 ||
    draft.deleteSkillIds.length > 0 ||
    draft.deliveryAgents !== baselineAgents ||
    draft.deliveryClaude !== baselineClaude
  ) {
    return true;
  }
  const baselineEnabled = new Map(
    (snapshot?.skills ?? []).map((skill) => [skill.id, skill.enabled] as const)
  );
  for (const [skillId, enabled] of Object.entries(draft.enabledBySkillId)) {
    if ((baselineEnabled.get(skillId) ?? false) !== enabled) {
      return true;
    }
  }
  return false;
}

export function isProjectRootRef(value: unknown): value is ProjectRootRef {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.realPath === "string" &&
    record.realPath.length > 0 &&
    typeof record.volumeIdentity === "string" &&
    record.volumeIdentity.length > 0 &&
    typeof record.directoryIdentity === "string" &&
    record.directoryIdentity.length > 0
  );
}

export function isProjectSummary(
  value: unknown
): value is ProjectSkillsProjectSummary {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.displayPath === "string" &&
    typeof record.skillCount === "number" &&
    record.projectRef !== null &&
    typeof record.projectRef === "object"
  );
}

export function isSnapshotView(
  value: unknown
): value is ProjectSkillsSnapshotView {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.observedRevision === "string" && Array.isArray(record.skills)
  );
}

export function normalizeSnapshot(
  value: unknown
): ProjectSkillsSnapshotView | null {
  if (!isSnapshotView(value)) {
    return null;
  }
  const record = value as ProjectSkillsSnapshotView & Record<string, unknown>;
  return {
    ...record,
    health: {
      issues: Array.isArray(record.health?.issues) ? record.health.issues : [],
    },
    skills: record.skills
      .filter(
        (skill): skill is ProjectSkillView =>
          Boolean(skill) && typeof (skill as { id?: unknown }).id === "string"
      )
      .map((skill) => ({
        ...skill,
        name: typeof skill.name === "string" ? skill.name : "",
        description:
          typeof skill.description === "string" ? skill.description : "",
        enabled: skill.enabled === true,
        managedBy: skill.managedBy === "pier-system" ? "pier-system" : "user",
        fileCount: typeof skill.fileCount === "number" ? skill.fileCount : 0,
        totalBytes: typeof skill.totalBytes === "number" ? skill.totalBytes : 0,
        riskSummary: skill.riskSummary ?? null,
        effects: Array.isArray(skill.effects) ? skill.effects : [],
        issueIds: Array.isArray(skill.issueIds) ? skill.issueIds : [],
        contentDigest:
          typeof skill.contentDigest === "string" ? skill.contentDigest : "",
        actualContentDigest:
          typeof skill.actualContentDigest === "string"
            ? skill.actualContentDigest
            : null,
        directorySummary: skill.directorySummary ?? null,
      })),
    unmanagedSkills: Array.isArray(record.unmanagedSkills)
      ? record.unmanagedSkills.map((entry) => ({
          ...entry,
          effects: Array.isArray(entry.effects) ? entry.effects : [],
        }))
      : [],
    userGlobalSkills: Array.isArray(record.userGlobalSkills)
      ? record.userGlobalSkills.map((entry) => ({
          ...entry,
          effects: Array.isArray(entry.effects) ? entry.effects : [],
        }))
      : [],
  };
}

export function normalizeConfirmation(
  value: unknown
): PlanConfirmationView | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.kind !== "string") {
    return null;
  }
  return {
    id: record.id,
    kind: record.kind,
    ...(typeof record.skillId === "string" ? { skillId: record.skillId } : {}),
    ...(typeof record.relativeTarget === "string"
      ? { relativeTarget: record.relativeTarget }
      : {}),
    ...(typeof record.contentDigest === "string"
      ? { contentDigest: record.contentDigest }
      : {}),
    ...(typeof record.gitState === "string"
      ? { gitState: record.gitState }
      : {}),
    ...(typeof record.expectedActualTreeDigest === "string"
      ? { expectedActualTreeDigest: record.expectedActualTreeDigest }
      : {}),
  };
}

export function normalizeIssue(value: unknown): PlanIssueView | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.code !== "string") return null;
  return {
    id: typeof record.id === "string" ? record.id : record.code,
    code: record.code,
    ...(typeof record.skillId === "string" ? { skillId: record.skillId } : {}),
    ...(typeof record.relativeTarget === "string"
      ? { relativeTarget: record.relativeTarget }
      : {}),
    ...(typeof record.adapterKind === "string"
      ? { adapterKind: record.adapterKind }
      : {}),
  };
}

export function isPlanPayload(value: unknown): value is {
  observedRevision?: string;
  planDigest?: string;
  applicable?: boolean;
  confirmationRequirements?: unknown[];
  blockingIssues?: unknown[];
  gitStates?: unknown[];
} {
  return Boolean(value && typeof value === "object");
}

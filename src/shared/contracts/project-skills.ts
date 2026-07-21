import { z } from "zod";

/**
 * Project skills shared contracts (design v8 §3.6 / §4.1).
 * Strict schemas only — handlers and service logic live in main.
 */

export const skillIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  .max(64);

/** Reserved prefix for Pier system skills (design v8 §8). */
export const PIER_SYSTEM_SKILL_PREFIX = "pier-";

export const contentDigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const observedRevisionSchema = z.string().min(1);
export const planDigestSchema = z.string().min(1);
export const repairPlanDigestSchema = z.string().min(1);

export const projectSkillSourceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("local-import") }).strict(),
  z.object({ type: z.literal("project-discovery-import") }).strict(),
  z.object({ type: z.literal("git-declared") }).strict(),
]);

export const projectSkillManifestEntrySchema = z
  .object({
    id: skillIdSchema,
    enabled: z.boolean(),
    contentDigest: contentDigestSchema,
    source: projectSkillSourceSchema,
  })
  .strict();

export const projectSkillsDeliverySchema = z.preprocess((value) => {
  if (!value || typeof value !== "object") {
    return value;
  }
  const record = value as Record<string, unknown>;
  // v9.x migration: older manifests only stored `claude`; `.agents/skills`
  // was always projected. Missing `agents` ⇒ true so existing projects keep
  // their discovery surface until the user turns it off.
  if (
    typeof record.claude === "boolean" &&
    typeof record.agents !== "boolean"
  ) {
    return { ...record, agents: true };
  }
  return value;
}, z.object({ agents: z.boolean(), claude: z.boolean() }).strict());

export type ProjectSkillsDelivery = z.infer<typeof projectSkillsDeliverySchema>;

export const PIER_PROJECTION_ROOT_AGENTS = ".agents/skills";
export const PIER_PROJECTION_ROOT_CLAUDE = ".claude/skills";

/** Roots Pier will write for the given delivery flags (may be empty). */
export function listPierProjectionRoots(
  delivery: ProjectSkillsDelivery
): string[] {
  const roots: string[] = [];
  if (delivery.agents) {
    roots.push(PIER_PROJECTION_ROOT_AGENTS);
  }
  if (delivery.claude) {
    roots.push(PIER_PROJECTION_ROOT_CLAUDE);
  }
  return roots;
}

export const projectSkillsManifestSchema = z
  .object({
    version: z.literal(1),
    delivery: projectSkillsDeliverySchema,
    skills: z.array(projectSkillManifestEntrySchema),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const seen = new Set<string>();
    for (const [index, entry] of manifest.skills.entries()) {
      if (seen.has(entry.id)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate skill id: ${entry.id}`,
          path: ["skills", index, "id"],
        });
        continue;
      }
      seen.add(entry.id);
    }
  });

export type ProjectSkillsManifest = z.infer<typeof projectSkillsManifestSchema>;
export type ProjectSkillManifestEntry = z.infer<
  typeof projectSkillManifestEntrySchema
>;
export type ProjectSkillSource = z.infer<typeof projectSkillSourceSchema>;

export {
  DEGRADE_POLICIES,
  type DegradePolicy,
  degradePolicySchema,
  PROJECT_SKILLS_ISSUE_CODES,
  type ProjectSkillsIssueCode,
  projectSkillsIssueCodeSchema,
} from "./project-skills-issues.ts";

import { degradePolicySchema } from "./project-skills-issues.ts";

/**
 * Opaque project root handle issued/normalized by main.
 * Path + stable identity; optional short-lived authorization token.
 */
export const projectRootRefSchema = z
  .object({
    realPath: z.string().min(1),
    volumeIdentity: z.string().min(1),
    directoryIdentity: z.string().min(1),
    token: z.string().min(1).optional(),
  })
  .strict();
export type ProjectRootRef = z.infer<typeof projectRootRefSchema>;

export type {
  ProjectSkillView,
  SkillAgentEffect,
  SkillEffectiveCell,
  SkillLayer,
  UnmanagedSkillView,
  UserGlobalSkillView,
} from "./project-skills-views.ts";

/** Renderer intent only — main re-derives digests/source/health. */
export const projectSkillsDraftSchema = z
  .object({
    deliveryAgents: z.boolean(),
    deliveryClaude: z.boolean(),
    enabledBySkillId: z.record(skillIdSchema, z.boolean()),
    importTokens: z.array(z.string().min(1)),
    deleteSkillIds: z.array(skillIdSchema),
  })
  .strict();
export type ProjectSkillsDraft = z.infer<typeof projectSkillsDraftSchema>;

export const projectSkillsAcknowledgementSchema = z
  .object({
    requirementId: z.string().min(1),
    nonce: z.string().min(1),
    expectedActualTreeDigest: contentDigestSchema.optional(),
  })
  .strict();
export type ProjectSkillsAcknowledgement = z.infer<
  typeof projectSkillsAcknowledgementSchema
>;

const projectSkillsCommittedRevisionsSchema = z
  .object({
    manifestRevision: z.string().min(1),
    observedRevision: observedRevisionSchema,
  })
  .strict();

/**
 * Apply result union (design §3.6).
 * `indeterminate` MUST NOT carry a fake authoritative snapshot.
 */
export const applyResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("converged"),
      operationId: z.string().min(1),
      revisions: projectSkillsCommittedRevisionsSchema,
      targetResults: z.array(z.unknown()),
      snapshot: z.unknown(),
    })
    .strict(),
  z
    .object({
      status: z.literal("degraded"),
      operationId: z.string().min(1),
      revisions: projectSkillsCommittedRevisionsSchema,
      targetResults: z.array(z.unknown()),
      snapshot: z.unknown(),
      pendingIssueIds: z.array(z.string().min(1)),
    })
    .strict(),
  z
    .object({
      status: z.literal("indeterminate"),
      operationId: z.string().min(1),
      lastConfirmedObservedRevision: observedRevisionSchema,
      manifestRevision: z.string().min(1).optional(),
      operationStatusQuery: z
        .object({
          projectRef: projectRootRefSchema,
          operationId: z.string().min(1),
        })
        .strict(),
    })
    .strict(),
]);
export type ApplyResult = z.infer<typeof applyResultSchema>;

export const launchGateDecisionSchema = z.enum([
  "open-settings",
  "degrade",
  "cancel",
]);
export type LaunchGateDecision = z.infer<typeof launchGateDecisionSchema>;

/**
 * v8: launch attempts are one-shot handles keyed by launchAttemptId; the v7
 * opaque challenge ceremony was removed (renderer is a trusted client — the
 * acknowledgement model applies, design §5.2).
 */
export const launchGateResultSchema = z.discriminatedUnion("status", [
  z
    .object({ status: z.literal("ready"), launchAttemptId: z.string().min(1) })
    .strict(),
  z
    .object({
      status: z.literal("blocked"),
      launchAttemptId: z.string().min(1),
      issueSummary: z.array(z.string()),
      degradePolicySummary: degradePolicySchema,
      expiresAt: z.number().int().nonnegative(),
    })
    .strict(),
]);
export type LaunchGateBlocked = Extract<
  z.infer<typeof launchGateResultSchema>,
  { status: "blocked" }
>;
export type LaunchGateResult = z.infer<typeof launchGateResultSchema>;

export const projectSkillsInvalidatedEventSchema = z
  .object({
    type: z.literal("project-skills.invalidated"),
    projectIdentity: z.string().min(1),
    observedRevision: observedRevisionSchema,
  })
  .strict();
export type ProjectSkillsInvalidatedEvent = z.infer<
  typeof projectSkillsInvalidatedEventSchema
>;

// --- PierCommand request payloads (type attached in commands.ts) ---

const projectRefField = {
  projectRef: projectRootRefSchema,
} as const;

export const skillsProjectsSnapshotRequestSchema = z
  .object({ projectRootPath: z.string().min(1).optional() })
  .strict();

export const skillsSnapshotRequestSchema = z.object(projectRefField).strict();

/**
 * Locator for reading one discovered skill's SKILL.md (read-only view /
 * editor prefill). Roots are re-validated by main against the registry
 * whitelists; directory names must be plain child names.
 */
export const skillContentRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("managed"), skillId: skillIdSchema }).strict(),
  z
    .object({
      kind: z.literal("project"),
      root: z.string().min(1),
      directoryName: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("user-global"),
      root: z.string().min(1),
      directoryName: z.string().min(1),
    })
    .strict(),
]);
export type SkillContentRef = z.infer<typeof skillContentRefSchema>;

export const skillsSkillReadRequestSchema = z
  .object({
    ...projectRefField,
    ref: skillContentRefSchema,
  })
  .strict();

export interface SkillContentResult {
  /** SKILL.md text (UTF-8, capped at 1 MiB — truncated flag set when cut). */
  skillMd: string;
  truncated: boolean;
}

export const skillsImportPrepareRequestSchema = z
  .object({
    ...projectRefField,
    /**
     * Optional preselected source from the global read-only view. Never an
     * arbitrary path: main re-validates `root` against the registry-derived
     * user-root whitelist and `directoryName` as a plain child name.
     */
    globalSource: z
      .object({
        root: z.string().min(1),
        directoryName: z.string().min(1),
      })
      .strict()
      .optional(),
  })
  .strict();

export const skillsImportPrepareFromDiscoveryRequestSchema = z
  .object({
    ...projectRefField,
    relativeSource: z.string().min(1),
  })
  .strict();

/** New blank managed skill from a template (design v8 §7.5, source local-import). */
export const skillsImportPrepareTemplateRequestSchema = z
  .object({
    ...projectRefField,
    skillId: skillIdSchema,
    description: z.string().min(1).max(1024),
  })
  .strict();

/**
 * Content-update candidate from renderer-submitted SKILL.md bytes (design v8
 * §6.1). Main re-runs the full import limits and recomputes digests/risk; the
 * candidate is bound to (baseSkillId, baseContentDigest) preconditions.
 */
export const skillsImportPrepareContentUpdateRequestSchema = z
  .object({
    ...projectRefField,
    skillId: skillIdSchema,
    baseContentDigest: contentDigestSchema,
    skillMd: z
      .string()
      .min(1)
      .max(1024 * 1024),
  })
  .strict();

/**
 * Drift acceptance candidate (design v9 §6.2): snapshots current drifted
 * library content for integrity adoption (“Use current files”). The base
 * digest is the observed drifted digest so apply refuses further concurrent
 * change. Not a content-approval / re-review gate.
 */
export const skillsImportPrepareDriftAcceptanceRequestSchema = z
  .object({
    ...projectRefField,
    skillId: skillIdSchema,
  })
  .strict();

export const skillsImportDiscardRequestSchema = z
  .object({
    ...projectRefField,
    token: z.string().min(1),
  })
  .strict();

export const skillsPlanRequestSchema = z
  .object({
    ...projectRefField,
    observedRevision: observedRevisionSchema,
    draft: projectSkillsDraftSchema,
  })
  .strict();

export const skillsApplyRequestSchema = z
  .object({
    ...projectRefField,
    observedRevision: observedRevisionSchema,
    draft: projectSkillsDraftSchema,
    planDigest: planDigestSchema,
    operationId: z.uuid(),
    acknowledgements: z.array(projectSkillsAcknowledgementSchema),
  })
  .strict();

export const skillsRepairPlanRequestSchema = z
  .object({
    ...projectRefField,
    observedRevision: observedRevisionSchema,
    continuationOf: z.string().min(1).optional(),
  })
  .strict();

export const skillsRepairRequestSchema = z
  .object({
    ...projectRefField,
    observedRevision: observedRevisionSchema,
    operationId: z.uuid(),
    repairPlanDigest: repairPlanDigestSchema,
    acknowledgements: z.array(projectSkillsAcknowledgementSchema),
    continuationOf: z.string().min(1).optional(),
  })
  .strict();

export const skillsDoctorRequestSchema = z.object(projectRefField).strict();

export const skillsOperationStatusRequestSchema = z
  .object({
    ...projectRefField,
    operationId: z.string().min(1),
  })
  .strict();

export const agentLaunchContinueRequestSchema = z
  .object({
    launchAttemptId: z.string().min(1),
    decision: launchGateDecisionSchema,
    acknowledgements: z.array(projectSkillsAcknowledgementSchema).optional(),
  })
  .strict();

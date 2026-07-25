import { z } from "zod";
import { projectRootRefSchema, skillIdSchema } from "./project-skills.ts";
import type { SkillEffectiveCell } from "./project-skills-views.ts";

/**
 * Pier Home skills library + project pierBindings contracts (design
 * 2026-07-23 §0.7 step 1). Library content lives under
 * `{userData}/pier-home/skills/library/<id>/`; per-project bind ledger is
 * `{userData}/project-skills/<rootKey>/pier-bindings.json`.
 */

/** Wire-tolerant cell; typed as SkillEffectiveCell for renderer matrix UI. */
const pierHomeSkillEffectiveCellSchema = z
  .object({
    agentKind: z.string().min(1),
    effect: z.object({ state: z.string().min(1) }).passthrough(),
  })
  .passthrough();

/** Discovery roots used when a library skill is always-included into projects. */
export const pierHomeSkillDeliverySchema = z
  .object({
    agents: z.boolean(),
    claude: z.boolean(),
  })
  .strict();
export type PierHomeSkillDelivery = z.infer<typeof pierHomeSkillDeliverySchema>;

export const pierHomeSkillViewSchema = z
  .object({
    absolutePath: z.string().min(1),
    alwaysInclude: z.boolean(),
    createdAt: z.number().int().nonnegative(),
    /**
     * Meaningful only when `alwaysInclude` — which Pier projection roots to
     * publish into each project. `null` when not always-included.
     */
    delivery: pierHomeSkillDeliverySchema.nullable(),
    description: z.string(),
    effects: z.array(pierHomeSkillEffectiveCellSchema),
    id: skillIdSchema,
    name: z.string(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();
export type PierHomeSkillView = Omit<
  z.infer<typeof pierHomeSkillViewSchema>,
  "effects"
> & {
  effects: SkillEffectiveCell[];
};

export const pierHomeUserGlobalSkillViewSchema = z
  .object({
    absolutePath: z.string().min(1),
    description: z.string(),
    directoryName: z.string().min(1),
    effects: z.array(pierHomeSkillEffectiveCellSchema),
    name: z.string(),
    root: z.string().min(1),
  })
  .strict();
export type PierHomeUserGlobalSkillView = Omit<
  z.infer<typeof pierHomeUserGlobalSkillViewSchema>,
  "effects"
> & {
  effects: SkillEffectiveCell[];
};

export const pierHomeSkillsSnapshotRequestSchema = z.object({}).strict();

export const pierHomeSkillsListRequestSchema = z.object({}).strict();

export const pierHomeSkillsRevealRequestSchema = z
  .object({
    absolutePath: z.string().min(1).optional(),
    skillId: skillIdSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasSkill = typeof value.skillId === "string";
    const hasPath = typeof value.absolutePath === "string";
    if (hasSkill === hasPath) {
      ctx.addIssue({
        code: "custom",
        message: "provide exactly one of skillId or absolutePath",
      });
    }
  });

export const pierHomeSkillsCreateRequestSchema = z
  .object({
    alwaysInclude: z.boolean().optional(),
    delivery: pierHomeSkillDeliverySchema.optional(),
    description: z.string().max(512).optional(),
    skillId: skillIdSchema,
  })
  .strict();

/**
 * Library skillId, agent-global discovery ref (root + directoryName), or
 * absolutePath under a whitelisted root (compat / reveal-aligned).
 */
export const pierHomeSkillsReadRequestSchema = z
  .object({
    absolutePath: z.string().min(1).optional(),
    directoryName: z.string().min(1).optional(),
    root: z.string().min(1).optional(),
    skillId: skillIdSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasSkill = typeof value.skillId === "string";
    const hasPath = typeof value.absolutePath === "string";
    const hasRef =
      typeof value.root === "string" && typeof value.directoryName === "string";
    const modes = [hasSkill, hasPath, hasRef].filter(Boolean).length;
    if (modes !== 1) {
      ctx.addIssue({
        code: "custom",
        message:
          "provide exactly one of skillId, {root,directoryName}, or absolutePath",
      });
    }
  });

export const pierHomeSkillsWriteRequestSchema = z
  .object({
    skillId: skillIdSchema,
    skillMd: z
      .string()
      .min(1)
      .max(1024 * 1024),
  })
  .strict();

export const pierHomeSkillsDeleteRequestSchema = z
  .object({ skillId: skillIdSchema })
  .strict();

export const pierHomeSkillsSetAlwaysIncludeRequestSchema = z
  .object({
    alwaysInclude: z.boolean(),
    /**
     * Required when `alwaysInclude` is true (defaults applied in the service
     * if omitted). Cleared when always-include is turned off.
     */
    delivery: pierHomeSkillDeliverySchema.optional(),
    skillId: skillIdSchema,
  })
  .strict();

export const pierBoundSkillViewSchema = z
  .object({
    alwaysInclude: z.boolean(),
    contentDigest: z.string().nullable(),
    /**
     * Always-include: library catalog delivery. Manual bind: per-bind
     * delivery from pier-bindings.json (defaults to agents-only).
     */
    delivery: pierHomeSkillDeliverySchema,
    description: z.string(),
    id: skillIdSchema,
    name: z.string(),
  })
  .strict();
export type PierBoundSkillView = z.infer<typeof pierBoundSkillViewSchema>;

/** Result of fan-out ensureReady across affected projects. */
export const pierBindingsConvergeResultSchema = z
  .object({
    converged: z.array(z.string().min(1)),
    failed: z.array(
      z
        .object({
          message: z.string(),
          rootKey: z.string().min(1),
        })
        .strict()
    ),
  })
  .strict();
export type PierBindingsConvergeResult = z.infer<
  typeof pierBindingsConvergeResultSchema
>;

export const skillsPierBindingsListRequestSchema = z
  .object({ projectRef: projectRootRefSchema })
  .strict();

export const skillsPierBindingsMutateRequestSchema = z
  .object({
    /** Optional for bind; ignored for unbind. Defaults to agents-only. */
    delivery: pierHomeSkillDeliverySchema.optional(),
    projectRef: projectRootRefSchema,
    skillId: skillIdSchema,
  })
  .strict();

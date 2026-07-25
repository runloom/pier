import { z } from "zod";

export const pierHomeInfoSchema = z
  .object({
    createdAt: z.number().int().nonnegative(),
    kind: z.literal("pier-home"),
    rootPath: z.string().min(1),
  })
  .strict();

export type PierHomeInfo = z.infer<typeof pierHomeInfoSchema>;

export const pierHomeInfoRequestSchema = z.object({}).strict();

export const pierHomeRevealRequestSchema = z.object({}).strict();

export {
  type PierBindingsConvergeResult,
  type PierBoundSkillView,
  type PierHomeSkillDelivery,
  type PierHomeSkillView,
  type PierHomeUserGlobalSkillView,
  pierBindingsConvergeResultSchema,
  pierBoundSkillViewSchema,
  pierHomeSkillDeliverySchema,
  pierHomeSkillsCreateRequestSchema,
  pierHomeSkillsDeleteRequestSchema,
  pierHomeSkillsListRequestSchema,
  pierHomeSkillsReadRequestSchema,
  pierHomeSkillsRevealRequestSchema,
  pierHomeSkillsSetAlwaysIncludeRequestSchema,
  pierHomeSkillsSnapshotRequestSchema,
  pierHomeSkillsWriteRequestSchema,
  pierHomeSkillViewSchema,
  pierHomeUserGlobalSkillViewSchema,
  skillsPierBindingsListRequestSchema,
  skillsPierBindingsMutateRequestSchema,
} from "./pier-home-skills.ts";

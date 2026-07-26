import { z } from "zod";
import {
  assertPlanAcyclic,
  assertPlanDepsExist,
} from "../project-plan-model.ts";

/**
 * Zod contract for design-time plan documents.
 * Pure graph helpers live in `project-plan-model.ts` / `.pier/plans/lib/plan-model.ts`.
 *
 * @see docs/superpowers/specs/2026-07-26-canvas-product-design-workflow-design.md
 */

export const PLAN_DOCUMENT_VERSION = 1 as const;

export const planNodeStatusSchema = z.enum([
  "todo",
  "in_progress",
  "blocked",
  "done",
  "cancelled",
]);

export const planBoardColumnSchema = z.enum([
  "backlog",
  "doing",
  "review",
  "done",
]);

export const planSessionRefSchema = z
  .object({
    agentId: z.string().min(1).max(128).optional(),
    boundAt: z.string().min(1).max(64),
    panelHint: z.string().min(1).max(256).optional(),
    role: z.enum(["implement", "review", "explore"]).optional(),
    sessionId: z.string().min(1).max(128),
  })
  .strict();

export const planNodeSchema = z
  .object({
    acceptance: z.array(z.string().max(500)).max(32).optional(),
    column: planBoardColumnSchema.optional(),
    deps: z.array(z.string().min(1).max(64)).max(64).default([]),
    docRefs: z.array(z.string().max(512)).max(32).optional(),
    id: z.string().min(1).max(64),
    notes: z.string().max(4000).optional(),
    paths: z.array(z.string().max(512)).max(64).optional(),
    sessionRefs: z.array(planSessionRefSchema).max(16).optional(),
    status: planNodeStatusSchema,
    title: z.string().min(1).max(200),
  })
  .strict();

export const planEdgeSchema = z
  .object({
    from: z.string().min(1).max(64),
    to: z.string().min(1).max(64),
  })
  .strict();

export const planBriefSchema = z
  .object({
    goals: z.array(z.string().max(500)).max(32).optional(),
    nonGoals: z.array(z.string().max(500)).max(32).optional(),
    problem: z.string().max(4000).optional(),
    product: z.string().max(8000).optional(),
    success: z.array(z.string().max(500)).max(32).optional(),
    tech: z.string().max(8000).optional(),
  })
  .strict();

export const planDocumentSchema = z
  .object({
    brief: planBriefSchema.optional(),
    description: z.string().max(2000).optional(),
    edges: z.array(planEdgeSchema).max(256).optional(),
    id: z.string().min(1).max(128),
    nodes: z.array(planNodeSchema).min(1).max(256),
    title: z.string().min(1).max(200),
    updatedAt: z.string().min(1).max(64),
    version: z.literal(PLAN_DOCUMENT_VERSION),
  })
  .strict();

export type PlanDocument = z.infer<typeof planDocumentSchema>;
export type PlanNode = z.infer<typeof planNodeSchema>;
export type PlanEdge = z.infer<typeof planEdgeSchema>;
export type PlanSessionRef = z.infer<typeof planSessionRefSchema>;
export type PlanBoardColumn = z.infer<typeof planBoardColumnSchema>;
export type PlanNodeStatus = z.infer<typeof planNodeStatusSchema>;

export function parsePlanDocument(input: unknown): PlanDocument {
  const doc = planDocumentSchema.parse(input);
  assertPlanDepsExist(doc.nodes);
  assertPlanAcyclic(doc.nodes);
  return doc;
}

export {
  assertPlanAcyclic,
  assertPlanDepsExist,
  edgesFromNodes,
  layeredLayout,
  statusToColumn,
} from "../project-plan-model.ts";

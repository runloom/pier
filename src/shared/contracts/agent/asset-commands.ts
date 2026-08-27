import { z } from "zod";
import {
  agentMcpCatalogRequestSchema,
  agentMcpPathActionRequestSchema,
  rulesEnsureRequestSchema,
  rulesReadRequestSchema,
  rulesSnapshotRequestSchema,
  rulesWriteRequestSchema,
} from "./assets.ts";
import {
  memoryDeleteObservationRequestSchema,
  memoryEnableRequestSchema,
  memoryRootRequestSchema,
} from "./memory.ts";

/**
 * Rules / MCP / memory command schemas. Kept out of `commands.ts` so the
 * discriminated union file stays under the 500-line cap.
 */
export const assetCommandSchemas = [
  rulesSnapshotRequestSchema.extend({
    type: z.literal("rules.snapshot"),
  }),
  rulesReadRequestSchema.extend({
    type: z.literal("rules.read"),
  }),
  rulesWriteRequestSchema.extend({
    type: z.literal("rules.write"),
  }),
  rulesEnsureRequestSchema.extend({
    type: z.literal("rules.ensure"),
  }),
  agentMcpCatalogRequestSchema.extend({
    type: z.literal("agentMcp.catalog"),
  }),
  agentMcpPathActionRequestSchema.extend({
    type: z.literal("agentMcp.reveal"),
  }),
  agentMcpPathActionRequestSchema.extend({
    type: z.literal("agentMcp.open"),
  }),
  memoryEnableRequestSchema.extend({
    type: z.literal("memory.enable"),
  }),
  memoryRootRequestSchema.extend({
    type: z.literal("memory.disable"),
  }),
  memoryRootRequestSchema.extend({
    type: z.literal("memory.status"),
  }),
  memoryRootRequestSchema.extend({
    type: z.literal("memory.list"),
  }),
  memoryDeleteObservationRequestSchema.extend({
    type: z.literal("memory.deleteObservation"),
  }),
  memoryRootRequestSchema.extend({
    type: z.literal("memory.clearStore"),
  }),
] as const;

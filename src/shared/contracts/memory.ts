import { z } from "zod";
import { assetRootRefSchema } from "./agent/assets.ts";

export const memoryRootRequestSchema = z
  .object({
    root: assetRootRefSchema,
  })
  .strict();

export const memoryEnableRequestSchema = z
  .object({
    acknowledged: z.boolean().optional(),
    root: assetRootRefSchema,
  })
  .strict();

export const memoryTargetRowSchema = z
  .object({
    configPath: z.string(),
    consumers: z.array(z.string()),
    detail: z.string().optional(),
    outcome: z.enum(["written", "removed", "failed", "skipped"]),
  })
  .strict();

export const memoryReportSchema = z
  .object({
    kind: z.literal("report"),
    state: z.enum(["disabled", "enabled", "degraded"]),
    targets: z.array(memoryTargetRowSchema),
  })
  .strict();

export const memoryNeedsConfirmationSchema = z
  .object({
    kind: z.literal("needsConfirmation"),
    trackedTargets: z.array(z.string()),
  })
  .strict();

export const memoryEnableResultSchema = z.discriminatedUnion("kind", [
  memoryNeedsConfirmationSchema,
  memoryReportSchema,
]);

export const memoryStatusSnapshotSchema = z
  .object({
    derivedState: z.enum(["disabled", "enabled", "degraded"]),
    desiredState: z.enum(["enabled", "disabled"]),
    enginePackage: z.string(),
    entityCount: z.number().int().nonnegative().nullable(),
    observationCount: z.number().int().nonnegative().nullable(),
    storePath: z.string(),
    targets: z.array(memoryTargetRowSchema),
  })
  .strict();

export type MemoryEnableResult = z.infer<typeof memoryEnableResultSchema>;
export type MemoryReport = z.infer<typeof memoryReportSchema>;
export type MemoryStatusSnapshot = z.infer<typeof memoryStatusSnapshotSchema>;

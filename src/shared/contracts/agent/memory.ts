import { z } from "zod";
import { assetRootRefSchema } from "./assets.ts";

export const memoryRootRequestSchema = z
  .object({
    root: assetRootRefSchema,
  })
  .strict();

export const memoryEnableRequestSchema = z
  .object({
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

/** v3:全局注册在用户家目录,git 跟踪确认门已删除,enable 恒返回 report。 */
export const memoryEnableResultSchema = memoryReportSchema;

export const memoryStatusSnapshotSchema = z
  .object({
    derivedState: z.enum(["disabled", "enabled", "degraded"]),
    desiredState: z.enum(["enabled", "disabled"]),
    enginePackage: z.string(),
    entityCount: z.number().int().nonnegative().nullable(),
    observationCount: z.number().int().nonnegative().nullable(),
    storePath: z.string(),
    /** 面向展示的路径(家目录折叠为 `~`);打开/定位仍用 storePath。 */
    storePathDisplay: z.string(),
    targets: z.array(memoryTargetRowSchema),
  })
  .strict();

export type MemoryEnableResult = z.infer<typeof memoryEnableResultSchema>;
export type MemoryReport = z.infer<typeof memoryReportSchema>;
export type MemoryStatusSnapshot = z.infer<typeof memoryStatusSnapshotSchema>;

export const MEMORY_ENTITY_TYPES = [
  "convention",
  "pitfall",
  "decision",
  "environment",
] as const;

export const memoryEntityTypeSchema = z.enum(MEMORY_ENTITY_TYPES);
export type MemoryEntityType = z.infer<typeof memoryEntityTypeSchema>;

export const memoryObservationItemSchema = z
  .object({
    entityName: z.string().min(1),
    entityType: memoryEntityTypeSchema,
    index: z.number().int().nonnegative(),
    observation: z.string().min(1),
  })
  .strict();

export const memoryListResultSchema = z
  .object({
    items: z.array(memoryObservationItemSchema),
    tooLarge: z.boolean(),
  })
  .strict();

export const memoryDeleteObservationRequestSchema = z
  .object({
    entityName: z.string().min(1),
    index: z.number().int().nonnegative(),
    /** 原文校验:与磁盘上该下标的 observation 不一致时拒删(防并发错删)。 */
    observation: z.string().min(1),
    root: assetRootRefSchema,
  })
  .strict();

export type MemoryObservationItem = z.infer<typeof memoryObservationItemSchema>;
export type MemoryListResult = z.infer<typeof memoryListResultSchema>;
export type MemoryDeleteObservationRequest = z.infer<
  typeof memoryDeleteObservationRequestSchema
>;

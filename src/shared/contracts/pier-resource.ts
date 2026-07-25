import { z } from "zod";
import { agentKindSchema } from "./agent.ts";

/**
 * Pier 资源快照（工作台「工作台资源」物料 / 指标目录）。
 *
 * L1 Electron 进程族 + L2 终端 session 树 + L3 活动身份；
 * renderer 拉取式消费（可见时 2s 轮询）；main 无常驻采样器。
 * CPU 为单核基准比例（1 = 100%，可 >1）。
 */

export const pierProcessRoleSchema = z.enum([
  "main",
  "window",
  "gpu",
  "utility",
  "other",
]);
export type PierProcessRole = z.infer<typeof pierProcessRoleSchema>;

export const appProcessMetricSchema = z.object({
  cpuPercent: z.number().min(0).nullable(),
  memoryBytes: z.number().nonnegative(),
  pid: z.number().int().positive(),
  role: pierProcessRoleSchema,
  /** Chromium type 原名，仅开发者视图；产品 UI 用 role。 */
  typeName: z.string().optional(),
});
export type AppProcessMetric = z.infer<typeof appProcessMetricSchema>;

export const sessionIdentitySchema = z.discriminatedUnion("kind", [
  z
    .object({
      agentId: agentKindSchema,
      kind: z.literal("agent"),
      sessionTitle: z.string().min(1).max(40).optional(),
      status: z.string().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("task"),
      label: z.string().min(1),
      runId: z.string().min(1),
      taskId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      commandLine: z.string().max(4096).optional(),
      kind: z.literal("shell"),
    })
    .strict(),
  z.object({ kind: z.literal("idle") }).strict(),
  z.object({ kind: z.literal("terminal") }).strict(),
]);
export type SessionIdentity = z.infer<typeof sessionIdentitySchema>;

export const processNodeSchema: z.ZodType<ProcessNode> = z.lazy(() =>
  z.object({
    children: z.array(processNodeSchema),
    cpuPercent: z.number().min(0).nullable(),
    memoryBytes: z.number().nonnegative().nullable(),
    name: z.string(),
    pid: z.number().int().positive(),
    ppid: z.number().int().nonnegative(),
  })
);

export interface ProcessNode {
  children: readonly ProcessNode[];
  cpuPercent: number | null;
  memoryBytes: number | null;
  name: string;
  pid: number;
  ppid: number;
}

export const sessionResourceRowSchema = z.object({
  cpuPercent: z.number().min(0).nullable(),
  hot: z.boolean(),
  identity: sessionIdentitySchema,
  memoryBytes: z.number().nonnegative().nullable(),
  panelId: z.string().min(1),
  processCount: z.number().int().nonnegative().nullable(),
  shellPid: z.number().int().positive().nullable(),
  topProcess: z
    .object({
      cpuPercent: z.number().min(0).nullable(),
      memoryBytes: z.number().nonnegative().nullable(),
      name: z.string(),
      pid: z.number().int().positive(),
    })
    .nullable(),
  tree: z.array(processNodeSchema).optional(),
  windowId: z.string().min(1).max(32),
});
export type SessionResourceRow = z.infer<typeof sessionResourceRowSchema>;

export const pierResourceSnapshotSchema = z.object({
  appProcesses: z.array(appProcessMetricSchema),
  meta: z.object({
    cpuWarmingUp: z.boolean(),
    platform: z.enum(["darwin", "linux", "win32"]),
    treeCapability: z.enum(["full", "shallow", "unavailable"]),
  }),
  sampledAt: z.number().int().positive(),
  sessions: z.array(sessionResourceRowSchema),
  summary: z.object({
    hostMemoryFreeBytes: z.number().nonnegative().optional(),
    hostMemoryTotalBytes: z.number().positive().optional(),
    hotCount: z.number().int().nonnegative(),
    pierAppCpuPercent: z.number().min(0).nullable(),
    pierAppMemoryBytes: z.number().nonnegative(),
    terminalCount: z.number().int().nonnegative(),
    /** L1∪L2 去重后；P0 等于 pierApp*。 */
    totalRelatedCpuPercent: z.number().min(0).nullable(),
    totalRelatedMemoryBytes: z.number().nonnegative(),
    workloadCpuPercent: z.number().min(0).nullable(),
    workloadMemoryBytes: z.number().nonnegative(),
  }),
});
export type PierResourceSnapshot = z.infer<typeof pierResourceSnapshotSchema>;

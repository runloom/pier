import { z } from "zod";

/**
 * 系统资源快照（core.system-resources 物料的数据契约）。
 * renderer 拉取式消费（面板可见时 2s 轮询），main 侧无常驻采样器——
 * 无人订阅即零开销；历史序列由 renderer ring buffer 维护，不落盘。
 */
export const systemStatsSnapshotSchema = z.object({
  /** Pier 主进程 RSS（bytes）。 */
  appMemoryRss: z.number().nonnegative(),
  /**
   * 全系统 CPU 占用比例 0-1。基于 os.cpus() 两次采样差分，
   * 首次调用无基线返回 null。
   */
  cpuUsage: z.number().min(0).max(1).nullable(),
  cpuCount: z.number().int().positive(),
  loadAvg1: z.number().nonnegative(),
  loadAvg5: z.number().nonnegative(),
  loadAvg15: z.number().nonnegative(),
  memoryFree: z.number().nonnegative(),
  memoryTotal: z.number().positive(),
  sampledAt: z.number().int().positive(),
});
export type SystemStatsSnapshot = z.infer<typeof systemStatsSnapshotSchema>;

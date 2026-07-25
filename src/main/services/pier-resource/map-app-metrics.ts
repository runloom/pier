import type {
  AppProcessMetric,
  PierProcessRole,
} from "@shared/contracts/pier-resource.ts";

/** Electron ProcessMetric 的可测子集（避免单测依赖 electron 模块）。 */
export interface AppMetricInput {
  cpu: { percentCPUUsage: number };
  memory: { workingSetSize: number };
  pid: number;
  type: string;
}

/**
 * Electron `ProcessMetric.type` → 产品 role。
 * Browser = main；Tab = 窗口 renderer；其余按 Chromium 进程模型映射。
 */
export function mapProcessTypeToRole(type: string): PierProcessRole {
  switch (type) {
    case "Browser":
      return "main";
    case "Tab":
      return "window";
    case "GPU":
      return "gpu";
    case "Utility":
      return "utility";
    default:
      return "other";
  }
}

/**
 * 将 getAppMetrics 行映射为契约行。
 * - memory.workingSetSize 单位为 KB → bytes
 * - cpu.percentCPUUsage 为 0–100+ 的「百分比点数」→ 单核比例（/100）；
 *   首次采样（warming）时 cpu 记 null
 */
export function mapAppMetrics(
  metrics: readonly AppMetricInput[],
  options: { cpuWarmingUp: boolean }
): AppProcessMetric[] {
  return metrics.map((metric) => {
    const cpuRatio = metric.cpu.percentCPUUsage / 100;
    return {
      cpuPercent: options.cpuWarmingUp
        ? null
        : Math.max(0, Number.isFinite(cpuRatio) ? cpuRatio : 0),
      memoryBytes: Math.max(0, metric.memory.workingSetSize) * 1024,
      pid: metric.pid,
      role: mapProcessTypeToRole(metric.type),
      typeName: metric.type,
    };
  });
}

export function sumAppProcessCpu(
  processes: readonly AppProcessMetric[]
): number | null {
  if (processes.length === 0) {
    return 0;
  }
  let total = 0;
  for (const process of processes) {
    if (process.cpuPercent === null) {
      return null;
    }
    total += process.cpuPercent;
  }
  return total;
}

export function sumAppProcessMemory(
  processes: readonly AppProcessMetric[]
): number {
  let total = 0;
  for (const process of processes) {
    total += process.memoryBytes;
  }
  return total;
}

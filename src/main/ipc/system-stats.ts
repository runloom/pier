import os from "node:os";
import type { SystemStatsSnapshot } from "@shared/contracts/system-stats.ts";
import { PIER } from "@shared/ipc-channels.ts";
import type { IpcMain } from "electron";

interface CpuTimesTotals {
  idle: number;
  total: number;
}

function readCpuTotals(): CpuTimesTotals {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    idle += cpu.times.idle;
    total +=
      cpu.times.idle +
      cpu.times.irq +
      cpu.times.nice +
      cpu.times.sys +
      cpu.times.user;
  }
  return { idle, total };
}

/**
 * 全系统 CPU 占用：os.cpus() 累计时间的两次采样差分。
 * 模块级基线跨调用保留——renderer 2s 轮询节奏下即滚动 2s 窗口均值。
 */
let cpuBaseline: CpuTimesTotals | null = null;

function sampleCpuUsage(): number | null {
  const current = readCpuTotals();
  const baseline = cpuBaseline;
  cpuBaseline = current;
  if (!baseline) {
    return null;
  }
  const totalDelta = current.total - baseline.total;
  if (totalDelta <= 0) {
    return null;
  }
  const idleDelta = current.idle - baseline.idle;
  const usage = 1 - idleDelta / totalDelta;
  return Math.min(1, Math.max(0, usage));
}

export function sampleSystemStats(): SystemStatsSnapshot {
  const [loadAvg1 = 0, loadAvg5 = 0, loadAvg15 = 0] = os.loadavg();
  return {
    appMemoryRss: process.memoryUsage().rss,
    cpuCount: os.cpus().length,
    cpuUsage: sampleCpuUsage(),
    loadAvg1,
    loadAvg5,
    loadAvg15,
    memoryFree: os.freemem(),
    memoryTotal: os.totalmem(),
    sampledAt: Date.now(),
  };
}

export function registerSystemStatsIpc(ipcMain: IpcMain): void {
  ipcMain.handle(PIER.SYSTEM_STATS_SNAPSHOT, () => sampleSystemStats());
}

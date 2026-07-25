import os from "node:os";
import type { ForegroundActivity } from "@shared/contracts/foreground-activity.ts";
import type { PierResourceSnapshot } from "@shared/contracts/pier-resource.ts";
import { app } from "electron";
import {
  assembleSessionRows,
  sumSessionWorkload,
} from "./assemble-sessions.ts";
import {
  mapAppMetrics,
  sumAppProcessCpu,
  sumAppProcessMemory,
} from "./map-app-metrics.ts";
import { scanPanelEnvMarkers } from "./panel-env-scan.ts";
import { listProcessTable } from "./process-table.ts";

/**
 * getAppMetrics 的 CPU 字段依赖「相对上次调用」差分。
 * 模块级标记：首次 snapshot 的 CPU 视为 warming（null），之后才有意义。
 */
let hasCompletedWarmupSample = false;

function platformTag(): PierResourceSnapshot["meta"]["platform"] {
  if (process.platform === "darwin") {
    return "darwin";
  }
  if (process.platform === "linux") {
    return "linux";
  }
  return "win32";
}

function treeCapability(): PierResourceSnapshot["meta"]["treeCapability"] {
  if (process.platform === "win32") {
    return "shallow";
  }
  if (process.platform === "darwin" || process.platform === "linux") {
    return "full";
  }
  return "unavailable";
}

export interface SamplePierResourceInput {
  activities?: readonly ForegroundActivity[];
}

/**
 * 采样 Pier 资源快照（L1 Electron + L2 终端进程树 + L3 身份 join）。
 */
export function samplePierResource(
  input: SamplePierResourceInput = {}
): PierResourceSnapshot {
  const cpuWarmingUp = !hasCompletedWarmupSample;
  const raw = app.getAppMetrics();
  const appProcesses = mapAppMetrics(raw, { cpuWarmingUp });
  hasCompletedWarmupSample = true;

  const pierAppMemoryBytes = sumAppProcessMemory(appProcesses);
  const pierAppCpuPercent = sumAppProcessCpu(appProcesses);

  const processes = listProcessTable();
  const appPids = [
    ...new Set([
      ...appProcesses.map((processMetric) => processMetric.pid),
      process.pid,
    ]),
  ];
  const markers = scanPanelEnvMarkers({ appPids, processes });
  const sessions = assembleSessionRows({
    activities: input.activities ?? [],
    appPids,
    markers,
    processes,
  });
  const workload = sumSessionWorkload(sessions);

  const appPidSet = new Set(appPids);
  let totalRelatedMemoryBytes = pierAppMemoryBytes;
  // warmup 期间 L1 CPU 为 null：Related 也保持 null，避免「仅 workload」半截数字
  let totalRelatedCpuPercent: number | null = cpuWarmingUp
    ? null
    : pierAppCpuPercent;
  for (const session of sessions) {
    if (session.shellPid !== null && appPidSet.has(session.shellPid)) {
      continue;
    }
    if (session.memoryBytes !== null) {
      totalRelatedMemoryBytes += session.memoryBytes;
    }
    if (!cpuWarmingUp && session.cpuPercent !== null) {
      totalRelatedCpuPercent =
        totalRelatedCpuPercent === null
          ? session.cpuPercent
          : totalRelatedCpuPercent + session.cpuPercent;
    }
  }

  const hotCount = sessions.reduce(
    (count, session) => count + (session.hot ? 1 : 0),
    0
  );

  return {
    appProcesses,
    meta: {
      cpuWarmingUp,
      platform: platformTag(),
      treeCapability: treeCapability(),
    },
    sampledAt: Date.now(),
    sessions,
    summary: {
      hostMemoryFreeBytes: os.freemem(),
      hostMemoryTotalBytes: os.totalmem(),
      hotCount,
      pierAppCpuPercent,
      pierAppMemoryBytes,
      terminalCount: sessions.length,
      totalRelatedCpuPercent,
      totalRelatedMemoryBytes,
      workloadCpuPercent: workload.cpuPercent,
      workloadMemoryBytes: workload.memoryBytes,
    },
  };
}

/** 测试用：重置 CPU warmup 状态。 */
export function resetPierResourceSamplingStateForTests(): void {
  hasCompletedWarmupSample = false;
}

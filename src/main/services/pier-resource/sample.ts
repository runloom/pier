import type { ForegroundActivity } from "@shared/contracts/foreground-activity.ts";
import type { PierResourceSnapshot } from "@shared/contracts/pier-resource.ts";
import { app } from "electron";
import {
  assembleSessionRows,
  sumSessionWorkload,
} from "./assemble-sessions.ts";
import {
  readHostLogicalCpuCount,
  readHostMemoryAvailableBytes,
  readHostMemoryTotalBytes,
} from "./host-memory.ts";
import {
  mapAppMetrics,
  sumAppProcessCpu,
  sumAppProcessMemory,
} from "./map-app-metrics.ts";
import { scanPanelEnvMarkers } from "./panel-env-scan.ts";
import { listProcessTable } from "./process-table.ts";
import { aggregateFromRoot } from "./resolve-session-roots.ts";
import { listTerminalResourceSessions } from "./terminal-session-registry.ts";

/**
 * getAppMetrics 的 CPU 字段依赖「相对上次调用」差分。
 * 采样间隔过长（物料隐藏）时重新 warmup，避免长窗口均值当实时值。
 */
const WARMUP_GAP_MS = 10_000;
/** 上次**完整采样结束**时刻（用于 gap warmup）。 */
let lastSampleCompletedAt = 0;
let hasCompletedWarmupSample = false;

/** 进程级单飞：多窗并发 snapshot 合并为一次重采样。 */
let inFlightSample: Promise<PierResourceSnapshot> | null = null;
let lastSnapshot: PierResourceSnapshot | null = null;
let lastSnapshotAt = 0;
/** 极短窗口内复用快照（多窗几乎同时 invoke）。 */
const SNAPSHOT_COALESCE_MS = 400;

function platformTag(): PierResourceSnapshot["meta"]["platform"] {
  if (process.platform === "darwin") {
    return "darwin";
  }
  if (process.platform === "linux") {
    return "linux";
  }
  return "win32";
}

/**
 * 进程树拓扑：darwin/linux 可扫子树。
 * Linux 会话 CPU 不可信（见 nullSessionCpu），但树与内存仍可用 → full。
 */
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

async function samplePierResourceOnce(
  input: SamplePierResourceInput
): Promise<PierResourceSnapshot> {
  const startedAt = Date.now();
  const gapWarmup =
    !hasCompletedWarmupSample ||
    lastSampleCompletedAt === 0 ||
    startedAt - lastSampleCompletedAt > WARMUP_GAP_MS;
  const cpuWarmingUp = gapWarmup;

  const raw = app.getAppMetrics();
  const appProcesses = mapAppMetrics(raw, { cpuWarmingUp });
  hasCompletedWarmupSample = true;

  const pierAppMemoryBytes = sumAppProcessMemory(appProcesses);
  const pierAppCpuPercent = sumAppProcessCpu(appProcesses);

  const [processes, hostMemoryFreeBytes] = await Promise.all([
    listProcessTable(),
    readHostMemoryAvailableBytes(),
  ]);
  const appPids = [
    ...new Set([
      ...appProcesses.map((processMetric) => processMetric.pid),
      process.pid,
    ]),
  ];
  const appPidSet = new Set(appPids);
  const markers = await scanPanelEnvMarkers({ appPids, processes });
  const nullSessionCpu = process.platform === "linux";
  const sessions = assembleSessionRows({
    activities: input.activities ?? [],
    appPids,
    markers,
    nullSessionCpu,
    processes,
  });
  const workload = sumSessionWorkload(sessions);

  // Related = L1 + 各会话树，但会话树内若撞上 Pier 本体 pid 则剔除（真·L1∪L2 去重）
  let totalRelatedMemoryBytes = pierAppMemoryBytes;
  let totalRelatedCpuPercent: number | null = cpuWarmingUp
    ? null
    : pierAppCpuPercent;

  const registrations = listTerminalResourceSessions();
  const rootByPanel = new Map(
    registrations.map((session) => [
      `${session.windowId}\0${session.panelId}`,
      session.rootPid,
    ])
  );

  for (const session of sessions) {
    const key = `${session.windowId}\0${session.panelId}`;
    const rootPid = rootByPanel.get(key);
    if (rootPid === null || rootPid === undefined) {
      // 无根：用行上已聚合值（marker-only 路径可能未进 registry root）
      if (session.memoryBytes !== null) {
        totalRelatedMemoryBytes += session.memoryBytes;
      }
      if (!(cpuWarmingUp || nullSessionCpu) && session.cpuPercent !== null) {
        totalRelatedCpuPercent =
          totalRelatedCpuPercent === null
            ? session.cpuPercent
            : totalRelatedCpuPercent + session.cpuPercent;
      }
      continue;
    }
    const agg = aggregateFromRoot(rootPid, processes, {
      excludePids: appPidSet,
    });
    totalRelatedMemoryBytes += agg.memoryBytes;
    if (!(cpuWarmingUp || nullSessionCpu)) {
      totalRelatedCpuPercent =
        totalRelatedCpuPercent === null
          ? agg.cpuPercent
          : totalRelatedCpuPercent + agg.cpuPercent;
    }
  }

  const hotCount = sessions.reduce(
    (count, session) => count + (session.hot ? 1 : 0),
    0
  );

  const snapshot: PierResourceSnapshot = {
    appProcesses,
    meta: {
      cpuWarmingUp,
      platform: platformTag(),
      treeCapability: treeCapability(),
    },
    sampledAt: Date.now(),
    sessions,
    summary: {
      hostLogicalCpuCount: readHostLogicalCpuCount(),
      hostMemoryFreeBytes,
      hostMemoryTotalBytes: readHostMemoryTotalBytes(),
      hotCount,
      pierAppCpuPercent,
      pierAppMemoryBytes,
      terminalCount: sessions.length,
      totalRelatedCpuPercent,
      totalRelatedMemoryBytes,
      workloadCpuPercent: nullSessionCpu ? null : workload.cpuPercent,
      workloadMemoryBytes: workload.memoryBytes,
    },
  };
  lastSampleCompletedAt = Date.now();
  return snapshot;
}

/**
 * 采样 Pier 资源快照（L1 Electron + L2 终端进程树 + L3 身份 join）。
 * 异步 ps / vm_stat；多窗并发单飞合并。
 */
export function samplePierResource(
  input: SamplePierResourceInput = {}
): Promise<PierResourceSnapshot> {
  const now = Date.now();
  if (
    lastSnapshot !== null &&
    now - lastSnapshotAt < SNAPSHOT_COALESCE_MS &&
    inFlightSample === null
  ) {
    return Promise.resolve(lastSnapshot);
  }
  if (inFlightSample) {
    return inFlightSample;
  }
  inFlightSample = samplePierResourceOnce(input)
    .then((snapshot) => {
      lastSnapshot = snapshot;
      lastSnapshotAt = Date.now();
      return snapshot;
    })
    .finally(() => {
      inFlightSample = null;
    });
  return inFlightSample;
}

/** 测试用：重置 CPU warmup / 单飞 / 快照缓存。 */
export function resetPierResourceSamplingStateForTests(): void {
  hasCompletedWarmupSample = false;
  lastSampleCompletedAt = 0;
  inFlightSample = null;
  lastSnapshot = null;
  lastSnapshotAt = 0;
}

/** 测试用：读 coalesce 窗口与 warmup 常量。 */
export function pierResourceSamplingConstantsForTests(): {
  coalesceMs: number;
  warmupGapMs: number;
} {
  return {
    coalesceMs: SNAPSHOT_COALESCE_MS,
    warmupGapMs: WARMUP_GAP_MS,
  };
}

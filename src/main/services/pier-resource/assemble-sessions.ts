import type { ForegroundActivity } from "@shared/contracts/foreground-activity.ts";
import type {
  SessionIdentity,
  SessionResourceRow,
} from "@shared/contracts/pier-resource.ts";
import type { PanelEnvMarker } from "./panel-env-scan.ts";
import type { ProcessTableRow } from "./process-table.ts";
import {
  aggregateFromRoot,
  pickPreferredResolvedRoot,
  reconcileTerminalSessionRoots,
  resolveRootFromPid,
} from "./resolve-session-roots.ts";
import { listTerminalResourceSessions } from "./terminal-session-registry.ts";

const HOT_CPU_RATIO = 0.25;
const HOT_MEMORY_BYTES = 512 * 1024 * 1024;

function panelKey(windowId: string, panelId: string): string {
  return `${windowId}\0${panelId}`;
}

export function identityFromActivity(
  activity: ForegroundActivity | undefined
): SessionIdentity {
  if (!activity) {
    return { kind: "terminal" };
  }
  switch (activity.kind) {
    case "agent":
      return {
        agentId: activity.agentId,
        kind: "agent",
        ...(activity.sessionTitle === undefined
          ? {}
          : { sessionTitle: activity.sessionTitle }),
        ...(activity.status === undefined ? {} : { status: activity.status }),
      };
    case "task":
      return {
        kind: "task",
        label: activity.label,
        runId: activity.runId,
        taskId: activity.taskId,
      };
    case "shell":
      return {
        kind: "shell",
        ...(activity.commandLine === undefined
          ? {}
          : { commandLine: activity.commandLine }),
      };
    case "idle":
      return { kind: "idle" };
    default:
      return { kind: "terminal" };
  }
}

/**
 * 组装 L2 session 行：
 * 1) 登记表（create 时写入 seed）保证空闲终端也有行
 * 2) reconcile 绑定 login 根（seed / env 标记优先；无歧义时 1:1 发现）
 * 3) 活动身份 join
 * 4) 登记尚未绑根但有 marker 时，用 marker 解析（prefer login）即时聚合
 */
export function assembleSessionRows(input: {
  activities: readonly ForegroundActivity[];
  appPids: readonly number[];
  markers: readonly PanelEnvMarker[];
  /**
   * Linux 上 ps %cpu 是生命周期均值，会话 CPU 置 null，只保留内存/树。
   */
  nullSessionCpu?: boolean;
  processes: readonly ProcessTableRow[];
}): SessionResourceRow[] {
  const sessions = reconcileTerminalSessionRoots({
    appPids: input.appPids,
    markers: input.markers,
    processes: input.processes,
  });

  const activityByPanel = new Map<string, ForegroundActivity>();
  for (const activity of input.activities) {
    activityByPanel.set(
      panelKey(activity.windowId, activity.panelId),
      activity
    );
  }

  const keys = new Set<string>(
    sessions.map((session) => panelKey(session.windowId, session.panelId))
  );
  for (const activity of input.activities) {
    keys.add(panelKey(activity.windowId, activity.panelId));
  }
  for (const marker of input.markers) {
    keys.add(panelKey(marker.windowId, marker.panelId));
  }

  const sessionByKey = new Map(
    sessions.map((session) => [
      panelKey(session.windowId, session.panelId),
      session,
    ])
  );

  const markersByKey = new Map<string, PanelEnvMarker[]>();
  for (const marker of input.markers) {
    const key = panelKey(marker.windowId, marker.panelId);
    const list = markersByKey.get(key);
    if (list) {
      list.push(marker);
    } else {
      markersByKey.set(key, [marker]);
    }
  }

  const rows: SessionResourceRow[] = [];
  for (const key of keys) {
    const registered = sessionByKey.get(key);
    const activity = activityByPanel.get(key);
    const markers = markersByKey.get(key) ?? [];
    const panelId =
      registered?.panelId ?? activity?.panelId ?? markers[0]?.panelId;
    const windowId =
      registered?.windowId ?? activity?.windowId ?? markers[0]?.windowId;
    if (!(panelId && windowId)) {
      continue;
    }

    let cpuPercent: number | null = null;
    let memoryBytes: number | null = null;
    let processCount: number | null = null;
    let topProcess: SessionResourceRow["topProcess"] = null;
    let rootPid = registered?.rootPid ?? null;
    let shellPid = registered?.shellPid ?? registered?.rootPid ?? null;

    // 登记未绑根、但 env 已标记：即时从 marker 解析并聚合（prefer login）
    if (rootPid === null && markers.length > 0) {
      const preferred = pickPreferredResolvedRoot(
        markers.map((marker) => resolveRootFromPid(marker.pid, input.processes))
      );
      if (preferred) {
        rootPid = preferred.rootPid;
        shellPid = preferred.shellPid ?? preferred.rootPid;
      }
    }

    if (rootPid !== null) {
      const agg = aggregateFromRoot(rootPid, input.processes);
      cpuPercent = input.nullSessionCpu ? null : agg.cpuPercent;
      memoryBytes = agg.memoryBytes;
      processCount = agg.processCount;
      if (input.nullSessionCpu) {
        topProcess =
          agg.topProcess === null
            ? null
            : { ...agg.topProcess, cpuPercent: null };
      } else {
        topProcess = agg.topProcess;
      }
    }

    const hot =
      (cpuPercent !== null && cpuPercent >= HOT_CPU_RATIO) ||
      (memoryBytes !== null && memoryBytes >= HOT_MEMORY_BYTES);

    rows.push({
      cpuPercent,
      hot,
      identity: identityFromActivity(activity),
      memoryBytes,
      panelId,
      processCount,
      shellPid,
      topProcess,
      windowId,
    });
  }

  rows.sort((a, b) => {
    if (a.hot !== b.hot) {
      return a.hot ? -1 : 1;
    }
    const cpu = (b.cpuPercent ?? 0) - (a.cpuPercent ?? 0);
    if (cpu !== 0) {
      return cpu;
    }
    return (b.memoryBytes ?? 0) - (a.memoryBytes ?? 0);
  });

  return rows;
}

export function sumSessionWorkload(sessions: readonly SessionResourceRow[]): {
  cpuPercent: number;
  memoryBytes: number;
} {
  let cpuPercent = 0;
  let memoryBytes = 0;
  for (const session of sessions) {
    if (session.cpuPercent !== null) {
      cpuPercent += session.cpuPercent;
    }
    if (session.memoryBytes !== null) {
      memoryBytes += session.memoryBytes;
    }
  }
  return { cpuPercent, memoryBytes };
}

/** 供测试/诊断：当前登记条数 */
export function registeredTerminalSessionCount(): number {
  return listTerminalResourceSessions().length;
}

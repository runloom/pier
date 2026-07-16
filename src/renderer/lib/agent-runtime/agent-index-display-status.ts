import type { AgentRuntimeIndexEntry } from "@shared/contracts/agent-runtime-index.ts";
import type {
  AgentActivity,
  ForegroundActivity,
} from "@shared/contracts/foreground-activity.ts";

export interface AgentIndexDisplayFields {
  spawnedAt?: number;
  stateStartedAt?: number;
  status: AgentRuntimeIndexEntry["status"];
  subagentCount: number;
}

function isLocalAgentActivity(
  entry: AgentRuntimeIndexEntry,
  localActivity: ForegroundActivity | undefined
): localActivity is AgentActivity {
  return (
    localActivity?.kind === "agent" && localActivity.windowId === entry.windowId
  );
}

/**
 * 本窗条目优先用 FA store（与终端状态栏同一订阅源）。
 * 匹配条件：panelId 命中且 FA.windowId === entry.windowId（不依赖 preferredWindowId）。
 */
export function resolveAgentIndexDisplayStatus(
  entry: AgentRuntimeIndexEntry,
  localActivity: ForegroundActivity | undefined
): AgentIndexDisplayFields {
  if (isLocalAgentActivity(entry, localActivity)) {
    return {
      status: localActivity.status,
      subagentCount: localActivity.subagentCount,
      ...(localActivity.stateStartedAt === undefined
        ? {}
        : { stateStartedAt: localActivity.stateStartedAt }),
      spawnedAt: localActivity.spawnedAt,
    };
  }
  return {
    status: entry.status,
    subagentCount: 0,
    ...(entry.stateStartedAt === undefined
      ? {}
      : { stateStartedAt: entry.stateStartedAt }),
  };
}

/**
 * 用本窗 FA 覆盖 Index 条目的 status，供分组 / 排序 / 搜索与行文案同源。
 */
export function enrichAgentIndexEntriesWithLocalFa(
  entries: readonly AgentRuntimeIndexEntry[],
  localActivities: Readonly<Record<string, ForegroundActivity | undefined>>
): AgentRuntimeIndexEntry[] {
  return entries.map((entry) => {
    const localActivity = localActivities[entry.panelId];
    if (!isLocalAgentActivity(entry, localActivity)) {
      return entry;
    }
    const enriched: AgentRuntimeIndexEntry = {
      agentId: entry.agentId,
      agentRef: entry.agentRef,
      panelId: entry.panelId,
      source: localActivity.source,
      updatedAt: Math.max(entry.updatedAt, localActivity.updatedAt),
      windowId: entry.windowId,
      ...(localActivity.status === undefined
        ? {}
        : { status: localActivity.status }),
      ...(localActivity.stateStartedAt === undefined
        ? {}
        : { stateStartedAt: localActivity.stateStartedAt }),
      ...(entry.cwd ? { cwd: entry.cwd } : {}),
      ...(entry.projectRootPath
        ? { projectRootPath: entry.projectRootPath }
        : {}),
      ...(entry.worktreeKey ? { worktreeKey: entry.worktreeKey } : {}),
    };
    return enriched;
  });
}

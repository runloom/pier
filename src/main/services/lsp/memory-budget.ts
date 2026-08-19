import type { LspSessionCloseCause } from "@shared/contracts/lsp.ts";
import type { RuntimeLogger } from "./session-runtime.ts";
import type { WorkspaceLspPolicy } from "./workspace-policy.ts";

export const LSP_MEMORY_SAMPLE_INTERVAL_MS = 60_000;

interface ProcessRow {
  pid: number;
  ppid: number;
  rssBytes: number;
}

interface SessionSnapshot {
  pid: number | null;
  sessionId: string;
  workspaceKey: string;
}

export interface LspMemoryBudgetDeps {
  closeWorkspaceSessions(
    workspaceKey: string,
    cause: LspSessionCloseCause
  ): Promise<void>;
  intervalMs?: number;
  listProcessTable(): Promise<readonly ProcessRow[]>;
  listSessions(): readonly SessionSnapshot[];
  logger?: RuntimeLogger;
  policy: Pick<
    WorkspaceLspPolicy,
    "getPrefs" | "hasTreeBlocker" | "listActive"
  >;
}

function collectTreeRssBytes(
  rootPid: number,
  rows: readonly ProcessRow[]
): number {
  const childrenByParent = new Map<number, ProcessRow[]>();
  const byPid = new Map<number, ProcessRow>();
  for (const row of rows) {
    byPid.set(row.pid, row);
    const list = childrenByParent.get(row.ppid);
    if (list) {
      list.push(row);
    } else {
      childrenByParent.set(row.ppid, [row]);
    }
  }
  let total = 0;
  const seen = new Set<number>();
  const stack = [rootPid];
  while (stack.length > 0) {
    const pid = stack.pop();
    if (pid === undefined || seen.has(pid)) {
      continue;
    }
    seen.add(pid);
    total += byPid.get(pid)?.rssBytes ?? 0;
    for (const child of childrenByParent.get(pid) ?? []) {
      stack.push(child.pid);
    }
  }
  return total;
}

/**
 * LSP 全局内存预算安全网：周期采样各真实会话进程树 RSS，总量超过
 * `lsp.memoryBudgetMb` 时按 LRU 关停最冷工作区（跳过 agentBusy 与树屏障，
 * 永不动最近活跃的工作区）。关停走 idle-release 语义，renderer 侧经
 * root-recovery 透明复活。
 */
export function createLspMemoryBudgetMonitor(deps: LspMemoryBudgetDeps): {
  dispose(): void;
  sampleOnce(): Promise<void>;
  start(): void;
} {
  const intervalMs = deps.intervalMs ?? LSP_MEMORY_SAMPLE_INTERVAL_MS;
  let timer: ReturnType<typeof setInterval> | null = null;
  let sampling = false;

  async function sampleOnce(): Promise<void> {
    if (sampling) {
      return;
    }
    sampling = true;
    try {
      const prefs = deps.policy.getPrefs();
      if (!prefs.enabled || prefs.memoryBudgetMb <= 0) {
        return;
      }
      const sessions = deps
        .listSessions()
        .filter(
          (session): session is SessionSnapshot & { pid: number } =>
            session.pid !== null
        );
      if (sessions.length === 0) {
        return;
      }
      const rows = await deps.listProcessTable();
      if (rows.length === 0) {
        return;
      }
      const budgetBytes = prefs.memoryBudgetMb * 1024 * 1024;
      const rssByWorkspaceKey = new Map<string, number>();
      let totalBytes = 0;
      for (const session of sessions) {
        const bytes = collectTreeRssBytes(session.pid, rows);
        totalBytes += bytes;
        rssByWorkspaceKey.set(
          session.workspaceKey,
          (rssByWorkspaceKey.get(session.workspaceKey) ?? 0) + bytes
        );
      }
      if (totalBytes <= budgetBytes) {
        return;
      }

      // LRU 候选：跳过 agentBusy / 树屏障 / 请求在途（refCount>0），
      // 且永远保留最近活跃的一个工作区（单工作区超预算时不抖动）。
      const active = [...deps.policy.listActive()].sort(
        (left, right) => left.lastTouchAt - right.lastTouchAt
      );
      const hottest = active.at(-1);
      let projected = totalBytes;
      for (const workspace of active) {
        if (projected <= budgetBytes) {
          break;
        }
        if (workspace === hottest) {
          continue;
        }
        if (
          workspace.agentBusy ||
          workspace.refCount > 0 ||
          deps.policy.hasTreeBlocker(workspace.workspaceKey)
        ) {
          continue;
        }
        const reclaim = rssByWorkspaceKey.get(workspace.workspaceKey) ?? 0;
        if (reclaim <= 0) {
          continue;
        }
        projected -= reclaim;
        deps.logger?.warn("[lsp] memory budget exceeded; reaping workspace", {
          budgetMb: prefs.memoryBudgetMb,
          totalMb: Math.round(totalBytes / (1024 * 1024)),
          workspaceKey: workspace.workspaceKey,
          workspaceMb: Math.round(reclaim / (1024 * 1024)),
        });
        await deps.closeWorkspaceSessions(
          workspace.workspaceKey,
          "idle-release"
        );
      }
    } catch (error) {
      deps.logger?.warn("[lsp] memory budget sampling failed", { error });
    } finally {
      sampling = false;
    }
  }

  return {
    dispose() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    sampleOnce,
    start() {
      if (timer) {
        return;
      }
      timer = setInterval(() => {
        sampleOnce().catch(() => undefined);
      }, intervalMs);
      timer.unref?.();
    },
  };
}

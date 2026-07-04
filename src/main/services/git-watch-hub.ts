import type { FSWatcher } from "node:fs";
import type { RefsTable } from "./git-refs-table.ts";

/**
 * repo 级监听中枢（v3 拓扑）。每个物理仓库（canonical gitCommonDir）恰好一个：
 * - 唯一元数据 watcher：递归挂 commonDir，事件按路径路由到 agent 或升级为 repo-wide
 * - 唯一 poll timer：兜底轮询以 repo 为粒度，不随打开的 worktree 数膨胀
 * - refs 快照每轮只算一次（for-each-ref → 签名 + 共享 refs 表），fan-out 给全部 agent
 *
 * hub 不 import watch service（单向依赖）：agent 以 HubAgent 接口注入。
 */

/** 一轮 hub refresh 算出的 refs 快照。table 仅默认路径有（注入 refs 签名替身时无）。 */
export interface RefsSnapshot {
  signature: string;
  table?: RefsTable;
}

/** watch service 侧的 agent 句柄。hub 只认这三样，不触碰 entry 内部。 */
export interface HubAgent {
  gitDir: string;
  gitRoot: string;
  /** 触发一轮 agent refresh；refsSnap 提供时跳过 agent 自己的 refs 计算。 */
  requestRefresh(refsSnap?: RefsSnapshot): void;
}

export interface CreateRepoHubOptions {
  commonDir: string;
  /** 计算本仓库 refs 快照；cwd 用任一注册 agent 的 gitRoot。 */
  computeRefsSnapshot(cwd: string): Promise<RefsSnapshot>;
  debounceMs: number;
  fsWatch(path: string, options?: { recursive?: boolean }): FSWatcher;
  isPollActive(): boolean;
  maxWaitMs: number;
  /** hub 销毁回调（最后一个 agent 卸载时），service 侧从注册表移除。 */
  onDispose(): void;
  pollMs: number;
}

export interface RepoHub {
  attach(agent: HubAgent): void;
  detach(agent: HubAgent): void;
  /** repo-wide 刷新：refs 快照算一次 + fan-out 全部 agent（pulse / poll / refs 事件）。 */
  refreshAll(): void;
}

const WATCHER_RECREATE_COOLDOWN_MS = 5000;

/**
 * commonDir 相对路径的事件过滤。git 写 ref/index 是 `x.lock` 写完 rename 到 `x`，
 * 最终文件必有事件，过滤 lock 零损失（VS Code 同款）；objects 是 gc/fetch 风暴源；
 * logs 是每条命令都追加的 reflog 噪声（配对的 HEAD/refs 事件携带同等信号）。
 */
function isNoiseEvent(relPath: string): boolean {
  return (
    relPath.endsWith(".lock") ||
    relPath.includes(".watchman-cookie") ||
    relPath.startsWith("objects/") ||
    relPath.startsWith("logs/") ||
    relPath.startsWith("subtree-cache/")
  );
}

export function createRepoHub({
  commonDir,
  computeRefsSnapshot,
  debounceMs,
  fsWatch,
  isPollActive,
  maxWaitMs,
  onDispose,
  pollMs,
}: CreateRepoHubOptions): RepoHub {
  const agents = new Set<HubAgent>();
  let watcher: FSWatcher | null = null;
  let recreateCoolingUntil = 0;
  let debounceTimer: NodeJS.Timeout | null = null;
  let firstEventAt: number | null = null;
  let refreshing = false;
  let rerunRequested = false;
  let disposed = false;

  const pollTimer = setInterval(() => {
    if (isPollActive()) {
      runRefreshAll();
    }
  }, pollMs);

  /**
   * repo-wide refresh 串行化：refs 快照每轮恰好算一次；执行中收到新请求合并成
   * trailing 一轮。agent 级串行化由 agent 自身保证（requestRefresh 内部）。
   */
  async function runRefreshAllOnce(): Promise<void> {
    const anchor = agents.values().next().value;
    if (anchor === undefined) {
      return;
    }
    let snap: RefsSnapshot | undefined;
    try {
      snap = await computeRefsSnapshot(anchor.gitRoot);
    } catch {
      // refs 快照失败（瞬时 git 故障）：agent 各自降级为自算 refs
    }
    for (const agent of agents) {
      agent.requestRefresh(snap);
    }
  }

  function runRefreshAll(): void {
    if (disposed) {
      return;
    }
    if (refreshing) {
      rerunRequested = true;
      return;
    }
    refreshing = true;
    runRefreshAllOnce()
      .catch(() => undefined)
      .finally(() => {
        refreshing = false;
        if (rerunRequested) {
          rerunRequested = false;
          runRefreshAll();
        }
      });
  }

  /** 与 agent 侧同参的 debounce + max-wait：突发元数据事件合并为一轮 refreshAll。 */
  function scheduleRefreshAll(): void {
    const now = Date.now();
    if (firstEventAt === null) {
      firstEventAt = now;
    }
    const delay = Math.max(
      0,
      Math.min(debounceMs, maxWaitMs - (now - firstEventAt))
    );
    clearTimeout(debounceTimer ?? undefined);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      firstEventAt = null;
      runRefreshAll();
    }, delay);
  }

  /**
   * `worktrees/<name>/**` 事件：路由到 gitDir 匹配的 agent
   * （HEAD/index/MERGE_HEAD/rebase 进度），refs 不重算。
   * 未注册的 worktree（外部工具的）：其分支移动经 refs/ 事件覆盖，此处忽略。
   */
  function routeWorktreeEvent(rest: string): void {
    const slash = rest.indexOf("/");
    const name = slash === -1 ? rest : rest.slice(0, slash);
    const inner = slash === -1 ? "" : rest.slice(slash + 1);
    if (inner.length > 0 && isNoiseEvent(inner)) {
      return;
    }
    const gitDir = `${commonDir}/worktrees/${name}`;
    for (const agent of agents) {
      if (agent.gitDir === gitDir) {
        agent.requestRefresh();
        return;
      }
    }
  }

  /**
   * 元数据事件路由：
   * - `worktrees/<name>/**` → 对应 agent
   * - 其余（refs/**、packed-refs、HEAD、FETCH_HEAD、config、reftable/**、
   *   主仓 checkout 的顶层 index 等）→ repo-wide（refs 快照 + 全 agent）
   * - filename 未知（null）→ 保守升级 repo-wide
   */
  function routeEvent(rawPath: string | null): void {
    if (rawPath === null) {
      scheduleRefreshAll();
      return;
    }
    const relPath = rawPath.split("\\").join("/");
    if (isNoiseEvent(relPath)) {
      return;
    }
    if (relPath.startsWith("worktrees/")) {
      routeWorktreeEvent(relPath.slice("worktrees/".length));
      return;
    }
    scheduleRefreshAll();
  }

  function attachWatcher(): void {
    watcher = fsWatch(commonDir, { recursive: true });
    watcher.on("change", (_event, filename) => {
      routeEvent(typeof filename === "string" ? filename : null);
    });
    watcher.on("error", () => {
      const now = Date.now();
      if (now < recreateCoolingUntil) {
        return; // 冷却期内不重建；靠 poll 兜底
      }
      recreateCoolingUntil = now + WATCHER_RECREATE_COOLDOWN_MS;
      try {
        watcher?.close();
      } catch {
        // watcher 已 dead
      }
      attachWatcher();
    });
  }

  attachWatcher();

  return {
    attach(agent) {
      agents.add(agent);
    },
    detach(agent) {
      agents.delete(agent);
      if (agents.size > 0 || disposed) {
        return;
      }
      disposed = true;
      clearTimeout(debounceTimer ?? undefined);
      clearInterval(pollTimer);
      try {
        watcher?.close();
      } catch {
        // watcher 已 dead
      }
      onDispose();
    },
    refreshAll: runRefreshAll,
  };
}

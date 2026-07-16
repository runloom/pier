import type { GitChangeEvent } from "../../shared/contracts/git.ts";
import type {
  CreateGitWatchServiceOptions,
  GitWatchService,
} from "./git-watch-contract.ts";
import {
  createRepoHub,
  type HubAgent,
  type RefsSnapshot,
  type RepoHub,
} from "./git-watch-hub.ts";
import {
  closeWatchEntryWatcher,
  collectRepoHubs,
  defaultFsWatch,
  findNestedWatchRoot,
  isGitMetadataTreeEvent,
  isNoiseTreeEvent,
  isPathInsideWatchRoot,
  recoverWatchEntry,
  type WatchEntry,
} from "./git-watch-internals.ts";
import { createGitWatchRefreshCoordinator } from "./git-watch-refresh.ts";
import {
  defaultHeadSignature,
  defaultRefsSignature,
  defaultRefsSnapshot,
  defaultRepoStateSignature,
  resolveRepoAnchors as defaultResolveRepoAnchors,
  defaultWorktreeSignature,
  invalidateGitWatchSignatureCaches,
} from "./git-watch-signatures.ts";

export type {
  CreateGitWatchServiceOptions,
  GitWatchService,
} from "./git-watch-contract.ts";
export type { FsWatchFn } from "./git-watch-internals.ts";

const DEFAULT_DEBOUNCE_MS = 400;
/**
 * 单次 fs event burst 内，从首事件起最长 maxWait 一定 refresh。
 * 避免 AI 一次写百文件时纯 trailing debounce 被反复重排导致长时间不更新。
 */
const DEFAULT_MAX_WAIT_MS = 1500;
/** 5s 兜底轮询：fs.watch 掉事件或非可靠 FS 时保 latency 上界 ≤ 5s。 */
const DEFAULT_POLL_MS = 5000;
/** watcher recreate 冷却窗：防止连续 error 触发无限重建。 */
const WATCHER_RECREATE_COOLDOWN_MS = 5000;

/**
 * git 变更监听服务（v3 两级拓扑）。
 * - agent（每 gitRoot）：工作树 watcher（过滤 .git/node_modules/lock）→ debounce →
 *   重算 worktree/head/repoState 签名 → 比对 → 广播；standalone 时兼算 refs 签名与自有 poll
 * - hub（每物理仓库，key = canonical commonDir）：唯一元数据 watcher（commonDir 递归，
 *   worktrees/<name> 事件路由到对应 agent，refs 级事件升级 repo-wide）、唯一 poll、
 *   refs 快照每轮恰算一次（for-each-ref → 签名 + 共享 refs 表）fan-out 给全部 agent
 */
export function createGitWatchService({
  computeWorktreeSignature = defaultWorktreeSignature,
  computeHeadSignature = defaultHeadSignature,
  computeRepoStateSignature = defaultRepoStateSignature,
  computeRefsSignature = defaultRefsSignature,
  fsWatch = defaultFsWatch,
  getStatus,
  isPollActive = () => true,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  maxWaitMs = DEFAULT_MAX_WAIT_MS,
  pollMs = DEFAULT_POLL_MS,
  resolveRepoAnchors = defaultResolveRepoAnchors,
}: CreateGitWatchServiceOptions = {}): GitWatchService {
  const entries = new Map<string, WatchEntry>();
  const hubs = new Map<string, RepoHub>();
  const inFlightRefreshes = new Set<Promise<void>>();
  /** 注入 refs 签名替身时 hub 也走替身（测试 seam）；默认路径才产出共享表。 */
  const refsSigIsDefault = computeRefsSignature === defaultRefsSignature;
  async function computeRefsSnapshot(
    cwd: string,
    context: { readonly signal: AbortSignal }
  ): Promise<RefsSnapshot> {
    if (refsSigIsDefault) {
      return await defaultRefsSnapshot(cwd, context);
    }
    return { signature: await computeRefsSignature(cwd, context) };
  }
  const { broadcastChange, refresh } = createGitWatchRefreshCoordinator({
    computeHeadSignature,
    computeRefsSignature,
    computeRepoStateSignature,
    computeWorktreeSignature,
    entries,
    getStatus,
    inFlightRefreshes,
  });

  function scheduleRefresh(gitRoot: string): void {
    const entry = entries.get(gitRoot);
    if (!entry) {
      return;
    }
    if (!entry.baselineReady) {
      // 不与空签名比较，但记住夹缝事件；baseline 结束后通知消费者重读。
      entry.baselineDirty = true;
      return;
    }
    const now = Date.now();
    if (entry.firstEventAt === null) {
      entry.firstEventAt = now;
    }
    const elapsed = now - entry.firstEventAt;
    // max-wait：从 burst 首事件起最多等 maxWait ms；不够 debounceMs 就按剩余时间跑
    const delay = Math.max(0, Math.min(debounceMs, maxWaitMs - elapsed));
    clearTimeout(entry.debounceTimer ?? undefined);
    entry.debounceTimer = setTimeout(() => {
      const target = entries.get(gitRoot);
      if (target) {
        target.debounceTimer = null;
        target.firstEventAt = null;
      }
      refresh(gitRoot, false).catch(() => {
        // 单次失败由下一次 fs 事件或轮询兜底
      });
    }, delay);
  }

  function attachWatcherHandlers(entry: WatchEntry, gitRoot: string): void {
    const watcher = entry.watcher;
    if (watcher === null) {
      return;
    }
    watcher.on("change", (_event, filename) => {
      if (entries.get(gitRoot) !== entry) {
        return;
      }
      const nestedRoot = findNestedWatchRoot(gitRoot, filename, entries.keys());
      if (nestedRoot !== null) {
        scheduleRefresh(nestedRoot);
      }
      if (!entry.baselineReady) {
        entry.baselineDirty = true;
        return;
      }
      if (typeof filename === "string") {
        if (isGitMetadataTreeEvent(filename)) {
          // 锚点解析期间或 standalone 模式没有 hub 代收 Git 元数据事件。
          if (entry.hub !== null) {
            return;
          }
        } else if (isNoiseTreeEvent(filename)) {
          return;
        }
      }
      scheduleRefresh(gitRoot);
    });
    watcher.on("error", () => {
      if (entry.watcher === watcher) {
        closeWatchEntryWatcher(entry);
        recoverWatchEntry({
          attachHandlers: () => attachWatcherHandlers(entry, gitRoot),
          cooldownMs: WATCHER_RECREATE_COOLDOWN_MS,
          entry,
          fsWatch,
          gitRoot,
          isCurrent: () => entries.get(gitRoot) === entry,
        });
      }
    });
  }

  /**
   * 异步把 entry 挂接到 repo hub：锚点解析成功 → 加入（或建立）commonDir 对应 hub，
   * 自有 poll 上收 hub。解析失败保持 standalone（非 git 目录 / git 不可用）。
   * entry 引用比对防换代竞态（解析期间退订又重订产生新 entry）。
   */
  async function attachToHub(
    gitRoot: string,
    entry: WatchEntry
  ): Promise<void> {
    const anchors = await resolveRepoAnchors(gitRoot, {
      signal: entry.lifecycleAbortController.signal,
    });
    if (anchors === null) {
      return;
    }
    if (entries.get(gitRoot) !== entry || entry.hub !== null) {
      return;
    }
    let hub = hubs.get(anchors.commonDir);
    if (hub === undefined) {
      const commonDir = anchors.commonDir;
      hub = createRepoHub({
        commonDir,
        computeRefsSnapshot,
        debounceMs,
        fsWatch,
        isPollActive,
        maxWaitMs,
        onDispose: () => hubs.delete(commonDir),
        pollMs,
      });
      hubs.set(commonDir, hub);
    }
    const handle: HubAgent = {
      gitDir: anchors.gitDir,
      gitRoot,
      requestRefresh: (request) => {
        const target = entries.get(gitRoot);
        if (!target?.baselineReady) {
          return;
        }
        refresh(
          gitRoot,
          false,
          request.kind === "repository" ? request.snapshot : undefined
        ).catch(() => undefined);
      },
    };
    entry.hub = hub;
    entry.hubHandle = handle;
    hub.attach(handle);
    // poll 上收 hub：每物理仓库一个 poll，不随打开的 worktree 数膨胀
    clearInterval(entry.pollTimer ?? undefined);
    entry.pollTimer = null;
  }

  function disposeEntry(entry: WatchEntry): void {
    entry.lifecycleAbortController.abort();
    entry.abortController?.abort();
    entry.abortController = null;
    clearTimeout(entry.debounceTimer ?? undefined);
    clearTimeout(entry.recreateTimer ?? undefined);
    clearInterval(entry.pollTimer ?? undefined);
    closeWatchEntryWatcher(entry);
    if (entry.hub !== null && entry.hubHandle !== null) {
      entry.hub.detach(entry.hubHandle);
      entry.hub = null;
      entry.hubHandle = null;
    }
  }

  function startBaseline(gitRoot: string, entry: WatchEntry): void {
    if (
      entries.get(gitRoot) !== entry ||
      entry.baselineReady ||
      entry.refreshing
    ) {
      return;
    }
    refresh(gitRoot, true)
      .then(() => {
        if (entries.get(gitRoot) !== entry) {
          return;
        }
        entry.baselineReady = true;
        if (entry.baselineDirty) {
          entry.baselineDirty = false;
          broadcastChange(entry, gitRoot, "worktree").catch(() => undefined);
        }
        attachToHub(gitRoot, entry).catch(() => undefined);
        if (entry.pendingPulse) {
          entry.pendingPulse = false;
          refresh(gitRoot, false).catch(() => undefined);
        }
      })
      .catch(() => undefined);
  }

  function watch(
    gitRoot: string,
    listener: (event: GitChangeEvent) => void
  ): () => void {
    let entry = entries.get(gitRoot);
    if (!entry) {
      const pollTimer = setInterval(() => {
        const target = entries.get(gitRoot);
        if (!target) {
          return;
        }
        if (!target.baselineReady) {
          startBaseline(gitRoot, target);
          return;
        }
        // A5：非聚焦时 poll 不 refresh（fs 事件/pulse 不受门控影响）
        if (!isPollActive()) {
          return;
        }
        refresh(gitRoot, false).catch(() => undefined);
      }, pollMs);
      entry = {
        abortController: null,
        baselineDirty: false,
        baselineReady: false,
        debounceTimer: null,
        firstEventAt: null,
        headSig: "",
        hub: null,
        hubHandle: null,
        lastRefsTable: null,
        lifecycleAbortController: new AbortController(),
        listeners: new Set(),
        pendingRefsSnap: undefined,
        pendingPulse: false,
        pollTimer,
        recreateCoolingUntil: 0,
        recreateTimer: null,
        refsSig: "",
        refreshing: false,
        repoStateSig: "",
        rerunRequested: false,
        watcher: null,
        worktreeSig: "",
      };
      const createdEntry: WatchEntry = entry;
      entries.set(gitRoot, createdEntry);
      // 先注册 entry 与兜底 poll，再尝试 watcher。EMFILE、权限抖动等同步失败
      // 由 main 统一进入受控冷却重试，不把恢复责任泄漏给每个 renderer 消费者。
      recoverWatchEntry({
        attachHandlers: () => attachWatcherHandlers(createdEntry, gitRoot),
        cooldownMs: WATCHER_RECREATE_COOLDOWN_MS,
        entry: createdEntry,
        fsWatch,
        gitRoot,
        isCurrent: () => entries.get(gitRoot) === createdEntry,
      });
      // 初始签名采集:完成后才标 baselineReady,避免与初始 "" 签名比较误报。
      // hub 挂接严格在 baseline 之后：保证 baseline 一定自算 refs 基线
      // （防"挂接抢跑 → refsSig 空基线 → 首轮 refresh 误报 refs 变化"）。
      startBaseline(gitRoot, createdEntry);
    }
    entry.listeners.add(listener);
    return () => {
      const target = entries.get(gitRoot);
      if (!target) {
        return;
      }
      target.listeners.delete(listener);
      if (target.listeners.size === 0) {
        disposeEntry(target);
        entries.delete(gitRoot);
        invalidateGitWatchSignatureCaches(gitRoot);
      }
    };
  }

  async function dispose(): Promise<void> {
    const pending = [...inFlightRefreshes];
    const pendingHubs = collectRepoHubs(entries.values());
    const roots = [...entries.keys()];
    for (const entry of entries.values()) {
      disposeEntry(entry);
    }
    entries.clear();
    for (const root of roots) {
      invalidateGitWatchSignatureCaches(root);
    }
    await Promise.allSettled([
      ...pending,
      ...pendingHubs.map((hub) => hub.whenIdle()),
    ]);
  }

  function activeRoots(): string[] {
    return Array.from(entries.keys());
  }

  function pulse(gitRoot: string): void {
    let resolvedRoot = gitRoot;
    let entry = entries.get(gitRoot);
    if (!entry) {
      // 写操作完成后以仓库内任意路径 pulse：回退最长前缀匹配（路径边界感知）
      let bestRoot: string | null = null;
      for (const root of entries.keys()) {
        if (
          isPathInsideWatchRoot(root, gitRoot) &&
          (bestRoot === null || root.length > bestRoot.length)
        ) {
          bestRoot = root;
        }
      }
      resolvedRoot = bestRoot ?? gitRoot;
      entry = bestRoot === null ? undefined : entries.get(bestRoot);
    }
    if (!entry) {
      return;
    }
    if (!entry.baselineReady) {
      entry.pendingPulse = true;
      return;
    }
    if (entry.hub !== null) {
      // repo-wide：refs 快照算一次 fan-out 全部同仓 agent（fetch 影响整个物理仓库）
      entry.hub.refreshAll();
      return;
    }
    refresh(resolvedRoot, false).catch(() => undefined);
  }

  return { activeRoots, dispose, pulse, watch };
}

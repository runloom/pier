import type {
  GitChangeEvent,
  GitChangeKind,
  GitStatus,
} from "../../shared/contracts/git.ts";
import type { PrefetchedStatus } from "./git-status-assembler.ts";
import {
  createRepoHub,
  type HubAgent,
  type RefsSnapshot,
  type RepoHub,
} from "./git-watch-hub.ts";
import {
  defaultFsWatch,
  deriveChangeKind,
  type FsWatchFn,
  isNoiseTreeEvent,
  type WatchEntry,
} from "./git-watch-internals.ts";
import {
  defaultHeadSignature,
  defaultRefsSignature,
  defaultRefsSnapshot,
  defaultRepoStateSignature,
  resolveRepoAnchors as defaultResolveRepoAnchors,
  defaultWorktreeSignature,
  type RepoAnchors,
  takeRawWorktreeSnapshot,
} from "./git-watch-signatures.ts";

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

export interface CreateGitWatchServiceOptions {
  /** sha256(HEAD oid + symbolic-ref HEAD)。注入便于测试。 */
  computeHeadSignature?: (gitRoot: string) => Promise<string>;
  /** refs 签名：refs/heads + refs/remotes + refs/stash 的 refname+oid+upstream+track+symref。注入便于测试。 */
  computeRefsSignature?: (gitRoot: string) => Promise<string>;
  /**
   * `.git/*_HEAD` 与 rebase 步进的存在性/内容签名。变化 → 归入 worktree changeKind。
   * 默认实现读 gitDir 下 MERGE_HEAD / CHERRY_PICK_HEAD / REVERT_HEAD / BISECT_START /
   * rebase-merge/msgnum / rebase-apply/next。gitDir 通过 `git rev-parse` 解析并缓存。
   */
  computeRepoStateSignature?: (gitRoot: string) => Promise<string>;
  /** sha256(git status --porcelain=v2 --branch -z + unstaged/staged numstat)。注入便于测试。 */
  computeWorktreeSignature?: (gitRoot: string) => Promise<string>;
  debounceMs?: number;
  /** fs.watch 替身。默认尝试 recursive,失败 fallback 到 .git 目录。 */
  fsWatch?: FsWatchFn;
  /**
   * 获取完整 GitStatus。变化触发时一并算出随广播下发，
   * 让多个 renderer 订阅者共享一份 snapshot，免各自 IPC refetch + 消除竞态。
   * 第二参 prefetched：本轮签名计算已拿到的原始输出 + hub 共享 refs 表，
   * getStatus 复用后可跳过重复 spawn（A7）。
   */
  getStatus?: (
    gitRoot: string,
    prefetched?: PrefetchedStatus
  ) => Promise<GitStatus>;
  /**
   * poll timer 门控（A5）：返回 false 时 poll tick 跳过 refresh（fs 事件/pulse 不受影响）。
   * 装配处注入"窗口是否聚焦"，避免后台无谓轮询；聚焦补课由 index.ts 的 pulse 完成。
   */
  isPollActive?: () => boolean;
  maxWaitMs?: number;
  pollMs?: number;
  /**
   * gitDir/commonDir 锚点解析（hub 归属判定）。注入便于测试；
   * 解析失败（非 git 目录）时 entry 以 standalone 模式运行（仅工作树 watcher + 自有 poll）。
   */
  resolveRepoAnchors?: (gitRoot: string) => Promise<RepoAnchors | null>;
}

export interface GitWatchService {
  /** 有订阅者的 gitRoot 列表(autofetch 用作活跃仓库注册表)。 */
  activeRoots(): string[];
  /** 主动关闭所有 watcher 和 poll timer。 */
  dispose(): Promise<void>;
  /** 立即重算签名走既有广播(autofetch fetch 完成后调用,免等 poll)。 */
  pulse(gitRoot: string): void;
  /**
   * 订阅 gitRoot 的 git 变化。返回 unsubscribe 函数。
   * 同一 gitRoot 多个 listener 共用一个底层 fs watcher(引用计数)；
   * 同一物理仓库（commonDir）的多个 gitRoot 共用一个元数据 hub。
   * 最后一个 listener 退订时,watcher 自动关闭。
   */
  watch(gitRoot: string, listener: (event: GitChangeEvent) => void): () => void;
}

/**
 * git 变更监听服务（v3 两级拓扑）。
 * 设计:
 * - agent（每 gitRoot）：工作树 watcher（过滤 .git/node_modules/lock）→ debounce →
 *   重算 worktree/head/repoState 签名 → 比对 → 广播；standalone 时兼算 refs 签名与自有 poll
 * - hub（每物理仓库，key = canonical commonDir）：唯一元数据 watcher（commonDir 递归，
 *   worktrees/<name> 事件路由到对应 agent，refs 级事件升级 repo-wide）、唯一 poll、
 *   refs 快照每轮恰算一次（for-each-ref → 签名 + 共享 refs 表）fan-out 给全部 agent
 * - Max-wait debounce：burst 内首事件后最多 maxWait 一定 refresh
 * - Broadcast 携带 status snapshot：getStatus 注入时随广播下发（prefetched 复用原始输出与 refs 表）
 * - 引用计数：多个 listener 共用 agent；多个 agent 共用 hub
 * - pulse(gitRoot)/activeRoots()：外部驱动方（autofetch/聚焦补课/写操作完成）即时触发
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
  /** 注入 refs 签名替身时 hub 也走替身（测试 seam）；默认路径才产出共享表。 */
  const refsSigIsDefault = computeRefsSignature === defaultRefsSignature;

  async function computeRefsSnapshot(cwd: string): Promise<RefsSnapshot> {
    if (refsSigIsDefault) {
      return await defaultRefsSnapshot(cwd);
    }
    return { signature: await computeRefsSignature(cwd) };
  }

  /**
   * 每 root 串行化（A6）：若正在 refresh，标记 rerunRequested 后返回；
   * 执行体结束若被重复请求，立即合并成一轮 trailing refresh。
   * hub 下发的 refs 快照在忙碌时暂存 pendingRefsSnap，trailing 轮消费。
   */
  async function refresh(
    gitRoot: string,
    force: boolean,
    refsSnap?: RefsSnapshot
  ): Promise<void> {
    const entry = entries.get(gitRoot);
    if (!entry) {
      return;
    }
    if (entry.refreshing) {
      entry.rerunRequested = true;
      if (refsSnap !== undefined) {
        entry.pendingRefsSnap = refsSnap;
      }
      return;
    }
    entry.refreshing = true;
    try {
      await runRefresh(entry, gitRoot, force, refsSnap);
    } finally {
      entry.refreshing = false;
      if (entry.rerunRequested) {
        entry.rerunRequested = false;
        const pending = entry.pendingRefsSnap ?? undefined;
        entry.pendingRefsSnap = null;
        // trailing 合并：立即再跑一轮（非 force）
        refresh(gitRoot, false, pending).catch(() => undefined);
      }
    }
  }

  /**
   * refs 三态：hub 下发快照 → 直接用；standalone（含 baseline，挂接晚于 baseline）→
   * 自算；hub-attached 且本轮无快照（纯工作树事件）→ 跳过（refs 归 hub 排他驱动）
   */
  function resolveRefsSignature(
    entry: WatchEntry,
    gitRoot: string,
    refsSnap?: RefsSnapshot
  ): Promise<string> {
    if (refsSnap !== undefined) {
      return Promise.resolve(refsSnap.signature);
    }
    if (entry.hub === null) {
      return computeRefsSignature(gitRoot);
    }
    return Promise.resolve(entry.refsSig);
  }

  /** 广播变更：getStatus 注入时随广播附完整 status（prefetch 复用原始输出 + hub refs 表，A7）。 */
  async function broadcastChange(
    entry: WatchEntry,
    gitRoot: string,
    changeKind: GitChangeKind
  ): Promise<void> {
    let status: GitStatus | undefined;
    if (getStatus) {
      const raw = takeRawWorktreeSnapshot(gitRoot);
      let prefetched: PrefetchedStatus | undefined;
      if (raw !== undefined) {
        prefetched =
          entry.lastRefsTable === null
            ? raw
            : { ...raw, refsTable: entry.lastRefsTable };
      }
      try {
        status = await getStatus(gitRoot, prefetched);
      } catch {
        // getStatus 失败不阻塞广播；renderer 接到不带 status 的广播会走 getStatus IPC fallback
      }
    } else {
      takeRawWorktreeSnapshot(gitRoot);
    }
    for (const listener of entry.listeners) {
      listener(
        status === undefined
          ? { changeKind, gitRoot }
          : { changeKind, gitRoot, status }
      );
    }
  }

  async function runRefresh(
    entry: WatchEntry,
    gitRoot: string,
    force: boolean,
    refsSnap?: RefsSnapshot
  ): Promise<void> {
    const [nextWorktree, nextHead, nextRepoState, nextRefs] = await Promise.all(
      [
        computeWorktreeSignature(gitRoot),
        computeHeadSignature(gitRoot),
        computeRepoStateSignature(gitRoot),
        resolveRefsSignature(entry, gitRoot, refsSnap),
      ]
    );
    if (refsSnap?.table !== undefined) {
      entry.lastRefsTable = refsSnap.table;
    }
    const worktreeChanged = nextWorktree !== entry.worktreeSig;
    const headChanged = nextHead !== entry.headSig;
    const repoStateChanged = nextRepoState !== entry.repoStateSig;
    const refsChanged = nextRefs !== entry.refsSig;
    entry.worktreeSig = nextWorktree;
    entry.headSig = nextHead;
    entry.repoStateSig = nextRepoState;
    entry.refsSig = nextRefs;
    if (force) {
      // baseline：签名已存基线，丢弃本轮采到的原始快照（无广播即无消费者）
      takeRawWorktreeSnapshot(gitRoot);
      return;
    }
    const changeKind = deriveChangeKind(
      worktreeChanged || repoStateChanged,
      headChanged,
      refsChanged
    );
    if (!changeKind) {
      takeRawWorktreeSnapshot(gitRoot);
      return;
    }
    await broadcastChange(entry, gitRoot, changeKind);
  }

  function scheduleRefresh(gitRoot: string): void {
    const entry = entries.get(gitRoot);
    if (!entry?.baselineReady) {
      // baseline 未完成,fs event 静默丢弃(避免与初始 "" 签名误比较)
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
    entry.watcher.on("change", (_event, filename) => {
      if (typeof filename === "string" && isNoiseTreeEvent(filename)) {
        return;
      }
      scheduleRefresh(gitRoot);
    });
    entry.watcher.on("error", () => safeRecreateWatcher(entry, gitRoot));
  }

  function safeRecreateWatcher(entry: WatchEntry, gitRoot: string): void {
    const now = Date.now();
    if (now < entry.recreateCoolingUntil) {
      // 冷却期内不重建；靠 poll 兜底
      return;
    }
    entry.recreateCoolingUntil = now + WATCHER_RECREATE_COOLDOWN_MS;
    try {
      entry.watcher.close();
    } catch {
      // watcher 已 dead
    }
    entry.watcher = fsWatch(gitRoot, { recursive: true });
    attachWatcherHandlers(entry, gitRoot);
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
    const anchors = await resolveRepoAnchors(gitRoot);
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
      requestRefresh: (snap) => {
        const target = entries.get(gitRoot);
        if (!target?.baselineReady) {
          return;
        }
        refresh(gitRoot, false, snap).catch(() => undefined);
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
    clearTimeout(entry.debounceTimer ?? undefined);
    clearInterval(entry.pollTimer ?? undefined);
    entry.watcher.close();
    if (entry.hub !== null && entry.hubHandle !== null) {
      entry.hub.detach(entry.hubHandle);
      entry.hub = null;
      entry.hubHandle = null;
    }
  }

  function watch(
    gitRoot: string,
    listener: (event: GitChangeEvent) => void
  ): () => void {
    let entry = entries.get(gitRoot);
    if (!entry) {
      const watcher = fsWatch(gitRoot, { recursive: true });
      const pollTimer = setInterval(() => {
        const target = entries.get(gitRoot);
        if (!target?.baselineReady) {
          return;
        }
        // A5：非聚焦时 poll 不 refresh（fs 事件/pulse 不受门控影响）
        if (!isPollActive()) {
          return;
        }
        refresh(gitRoot, false).catch(() => undefined);
      }, pollMs);
      entry = {
        baselineReady: false,
        debounceTimer: null,
        firstEventAt: null,
        headSig: "",
        hub: null,
        hubHandle: null,
        lastRefsTable: null,
        listeners: new Set(),
        pendingRefsSnap: null,
        pendingPulse: false,
        pollTimer,
        recreateCoolingUntil: 0,
        refsSig: "",
        refreshing: false,
        repoStateSig: "",
        rerunRequested: false,
        watcher,
        worktreeSig: "",
      };
      entries.set(gitRoot, entry);
      attachWatcherHandlers(entry, gitRoot);
      // 初始签名采集:完成后才标 baselineReady,避免与初始 "" 签名比较误报。
      // hub 挂接严格在 baseline 之后：保证 baseline 一定自算 refs 基线
      // （防"挂接抢跑 → refsSig 空基线 → 首轮 refresh 误报 refs 变化"）。
      refresh(gitRoot, true)
        .catch(() => undefined)
        .finally(() => {
          const target = entries.get(gitRoot);
          if (!target) {
            return;
          }
          target.baselineReady = true;
          // 失败静默保持 standalone（自有 poll 兜底）
          attachToHub(gitRoot, target).catch(() => undefined);
          if (target.pendingPulse) {
            // baseline 期间排队的外部驱动（autofetch/写操作）：补一轮，不丢信号
            target.pendingPulse = false;
            refresh(gitRoot, false).catch(() => undefined);
          }
        });
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
      }
    };
  }

  function dispose(): Promise<void> {
    for (const entry of entries.values()) {
      disposeEntry(entry);
    }
    entries.clear();
    return Promise.resolve();
  }

  function activeRoots(): string[] {
    return Array.from(entries.keys());
  }

  function pulse(gitRoot: string): void {
    let entry = entries.get(gitRoot);
    if (!entry) {
      // 写操作完成后以仓库内任意路径 pulse：回退最长前缀匹配（路径边界感知）
      let bestRoot: string | null = null;
      for (const root of entries.keys()) {
        if (
          gitRoot.startsWith(`${root}/`) &&
          (bestRoot === null || root.length > bestRoot.length)
        ) {
          bestRoot = root;
        }
      }
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
    refresh(gitRoot, false).catch(() => undefined);
  }

  return { activeRoots, dispose, pulse, watch };
}

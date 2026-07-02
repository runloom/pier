import { execGit as defaultExecGit, GitExecError } from "./git-exec.ts";

const HEARTBEAT_MS = 30_000;
const FETCH_TIMEOUT_MS = 30_000;
/** 连续失败退避倍数上限（5min 间隔 → 最长 40min）。 */
const MAX_BACKOFF_MULTIPLIER = 8;
/** 鉴权失败冷却时长：命中真实凭据错误后暂停自动 fetch，到期自动恢复尝试。 */
const AUTH_COOLDOWN_MS = 60 * 60_000;
/** 聚焦补跑最短间隔地板：防止连续聚焦/失焦抖动触发风暴级重试。 */
const FOCUS_CATCHUP_FLOOR_MS = 60_000;
/**
 * 鉴权/交互类失败：真实凭据错误才判定，进入冷却而非永久停用。
 * 裸 "permission denied"（本地文件属主/锁问题）不命中；SSH 的
 * "Permission denied (publickey" 属于凭据错误，保留命中。
 */
const AUTH_FAILURE_RE =
  /terminal prompts disabled|authentication failed|could not read Username|host key verification failed|permission denied \(publickey/i;
/** roots 死路径判定：该 root 本身不是有效 git 目录，换下一个 root 重试。 */
const DEAD_ROOT_RE = /not a git repository|no such file or directory/i;

export interface GitAutofetchConfig {
  enabled: boolean;
  intervalMinutes: number;
}

export interface CreateGitAutofetchServiceOptions {
  /** 活跃仓库来源：watch service 的订阅表（spec §2，不另建注册表）。 */
  activeRoots(): readonly string[];
  execGit?: typeof defaultExecGit;
  getConfig(): GitAutofetchConfig;
  heartbeatMs?: number;
  isFocused(): boolean;
  now?(): number;
  /** fetch 成功后逐 root 调用，走 watch service 既有广播（唯一出口）。 */
  pulse(gitRoot: string): void;
  resolveCommonDir?(gitRoot: string): Promise<string | null>;
}

export interface TickOptions {
  /** 聚焦补跑：额外放行"距上次成功已超间隔"的仓库（受地板保护）。 */
  focusCatchup?: boolean;
}

export interface GitAutofetchService {
  dispose(): void;
  onFocusGained(): void;
  start(): void;
  /** 执行一轮检查+fetch。生产由 start() 心跳驱动；测试直接 await。 */
  tick(options?: TickOptions): Promise<void>;
}

interface RepoFetchState {
  /** 0 = 无冷却；否则为冷却截止时间戳，命中真实鉴权错误时设置。 */
  authCooldownUntil: number;
  failureCount: number;
  inFlight: boolean;
  lastAttemptAt: number;
  /** 最近一次 fetch 成功的时间戳，供聚焦补跑判断"距上次成功"用。 */
  lastSuccessAt: number;
}

/**
 * common dir 解析缓存（worktree 生命周期内稳定）。
 * 仅缓存成功结果；解析失败（可能是瞬时故障）不缓存，下一轮 tick 自动重试。
 */
export function createCommonDirResolver(
  execGit: typeof defaultExecGit
): (gitRoot: string) => Promise<string | null> {
  const cache = new Map<string, string | null>();
  return async (gitRoot) => {
    const cached = cache.get(gitRoot);
    if (cached !== undefined) {
      return cached;
    }
    try {
      const out = await execGit(
        ["rev-parse", "--path-format=absolute", "--git-common-dir"],
        { cwd: gitRoot }
      );
      const dir = out.trim();
      const result = dir.length > 0 ? dir : null;
      cache.set(gitRoot, result);
      return result;
    } catch {
      return null;
    }
  };
}

/** 用户没配 GIT_SSH_COMMAND 时补 BatchMode，防 ssh passphrase 询问挂起。 */
function sshBatchEnv(): Readonly<Record<string, string>> {
  if (process.env.GIT_SSH_COMMAND) {
    return {};
  }
  return { GIT_SSH_COMMAND: "ssh -oBatchMode=yes" };
}

export function createGitAutofetchService({
  activeRoots,
  execGit = defaultExecGit,
  getConfig,
  heartbeatMs = HEARTBEAT_MS,
  isFocused,
  now = () => Date.now(),
  pulse,
  resolveCommonDir,
}: CreateGitAutofetchServiceOptions): GitAutofetchService {
  const resolve = resolveCommonDir ?? createCommonDirResolver(execGit);
  const repoStates = new Map<string, RepoFetchState>();
  let heartbeat: NodeJS.Timeout | null = null;
  let disposed = false;

  function stateFor(commonDir: string): RepoFetchState {
    let state = repoStates.get(commonDir);
    if (!state) {
      state = {
        authCooldownUntil: 0,
        failureCount: 0,
        inFlight: false,
        lastAttemptAt: 0,
        lastSuccessAt: 0,
      };
      repoStates.set(commonDir, state);
    }
    return state;
  }

  function isDeadRootError(error: unknown): boolean {
    const stderr = error instanceof GitExecError ? error.stderr : "";
    const message = error instanceof Error ? error.message : String(error);
    return DEAD_ROOT_RE.test(`${stderr}\n${message}`);
  }

  async function attemptFetch(cwd: string): Promise<void> {
    await execGit(["fetch", "--prune", "--quiet"], {
      cwd,
      env: sshBatchEnv(),
      timeoutMs: FETCH_TIMEOUT_MS,
    });
  }

  /** 按序尝试 roots：首个死路径（非 git 目录/不存在）自动换下一个重试，每组每轮最多遍历一次。 */
  async function fetchWithRootFallback(
    roots: readonly string[]
  ): Promise<void> {
    for (let i = 0; i < roots.length; i += 1) {
      const cwd = roots[i];
      if (cwd === undefined) {
        continue;
      }
      try {
        await attemptFetch(cwd);
        return;
      } catch (error) {
        const hasNextRoot = i + 1 < roots.length;
        if (!(hasNextRoot && isDeadRootError(error))) {
          throw error;
        }
        // 换下一个 root 重试
      }
    }
  }

  async function fetchRepo(
    roots: readonly string[],
    state: RepoFetchState
  ): Promise<void> {
    if (roots.length === 0) {
      state.inFlight = false;
      return;
    }
    try {
      await fetchWithRootFallback(roots);
      state.failureCount = 0;
      state.lastSuccessAt = now();
      for (const root of roots) {
        pulse(root);
      }
    } catch (error) {
      state.failureCount += 1;
      const stderr = error instanceof GitExecError ? error.stderr : "";
      const message = error instanceof Error ? error.message : String(error);
      if (AUTH_FAILURE_RE.test(`${stderr}\n${message}`)) {
        state.authCooldownUntil = now() + AUTH_COOLDOWN_MS;
        console.warn(
          `[git-autofetch] 鉴权失败，暂停 60 分钟自动 fetch: ${roots[0]}: ${message}`
        );
      }
    } finally {
      state.inFlight = false;
    }
  }

  /** 按 common dir 分组：同主仓多 worktree 只 fetch 一次（spec §2）。 */
  async function groupByCommonDir(
    roots: readonly string[]
  ): Promise<Map<string, string[]>> {
    const groups = new Map<string, string[]>();
    for (const root of roots) {
      const commonDir = await resolve(root);
      if (commonDir === null) {
        continue;
      }
      const group = groups.get(commonDir);
      if (group) {
        group.push(root);
      } else {
        groups.set(commonDir, [root]);
      }
    }
    return groups;
  }

  function isDueForFetch(
    state: RepoFetchState,
    intervalMs: number,
    focusCatchup: boolean
  ): boolean {
    const backoff = Math.min(2 ** state.failureCount, MAX_BACKOFF_MULTIPLIER);
    const dueRegular = now() - state.lastAttemptAt >= intervalMs * backoff;
    const dueFocusCatchup =
      focusCatchup &&
      now() - state.lastSuccessAt >= intervalMs &&
      now() - state.lastAttemptAt >= FOCUS_CATCHUP_FLOOR_MS;
    return dueRegular || dueFocusCatchup;
  }

  async function tick(options?: TickOptions): Promise<void> {
    if (disposed) {
      return;
    }
    const config = getConfig();
    if (!(config.enabled && isFocused())) {
      return;
    }
    const intervalMs = Math.max(1, config.intervalMinutes) * 60_000;
    const focusCatchup = options?.focusCatchup === true;
    const groups = await groupByCommonDir(activeRoots());
    const jobs: Promise<void>[] = [];
    for (const [commonDir, roots] of groups) {
      const state = stateFor(commonDir);
      if (state.inFlight || now() < state.authCooldownUntil) {
        continue;
      }
      if (!isDueForFetch(state, intervalMs, focusCatchup)) {
        continue;
      }
      state.lastAttemptAt = now();
      state.inFlight = true;
      jobs.push(fetchRepo(roots, state));
    }
    await Promise.all(jobs);
  }

  return {
    dispose() {
      disposed = true;
      if (heartbeat !== null) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
    },
    onFocusGained() {
      if (disposed) {
        return;
      }
      tick({ focusCatchup: true }).catch(() => undefined);
    },
    start() {
      if (disposed || heartbeat !== null) {
        return;
      }
      heartbeat = setInterval(() => {
        tick().catch(() => undefined);
      }, heartbeatMs);
    },
    tick,
  };
}

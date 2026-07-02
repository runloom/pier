import { execGit as defaultExecGit, GitExecError } from "./git-exec.ts";

const HEARTBEAT_MS = 30_000;
const FETCH_TIMEOUT_MS = 30_000;
/** 连续失败退避倍数上限（5min 间隔 → 最长 40min）。 */
const MAX_BACKOFF_MULTIPLIER = 8;
/** 鉴权/交互类失败：本会话停用该仓库，不做无意义重试（也避免锁死凭据）。 */
const AUTH_FAILURE_RE =
  /terminal prompts disabled|authentication failed|could not read Username|permission denied|host key verification failed/i;

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

export interface GitAutofetchService {
  dispose(): void;
  onFocusGained(): void;
  start(): void;
  /** 执行一轮检查+fetch。生产由 start() 心跳驱动；测试直接 await。 */
  tick(): Promise<void>;
}

interface RepoFetchState {
  disabledForSession: boolean;
  failureCount: number;
  inFlight: boolean;
  lastAttemptAt: number;
}

/** common dir 解析缓存（worktree 生命周期内稳定）。 */
function createCommonDirResolver(
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
      cache.set(gitRoot, null);
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

  function stateFor(commonDir: string): RepoFetchState {
    let state = repoStates.get(commonDir);
    if (!state) {
      state = {
        disabledForSession: false,
        failureCount: 0,
        inFlight: false,
        lastAttemptAt: 0,
      };
      repoStates.set(commonDir, state);
    }
    return state;
  }

  async function fetchRepo(
    roots: readonly string[],
    state: RepoFetchState
  ): Promise<void> {
    const cwd = roots[0];
    if (cwd === undefined) {
      return;
    }
    try {
      await execGit(["fetch", "--prune", "--quiet"], {
        cwd,
        env: sshBatchEnv(),
        timeoutMs: FETCH_TIMEOUT_MS,
      });
      state.failureCount = 0;
      for (const root of roots) {
        pulse(root);
      }
    } catch (error) {
      state.failureCount += 1;
      const stderr = error instanceof GitExecError ? error.stderr : "";
      const message = error instanceof Error ? error.message : String(error);
      if (AUTH_FAILURE_RE.test(`${stderr}\n${message}`)) {
        state.disabledForSession = true;
        console.warn(
          `[git-autofetch] 鉴权失败，本会话停用自动 fetch: ${cwd}: ${message}`
        );
      }
    } finally {
      state.inFlight = false;
    }
  }

  async function tick(): Promise<void> {
    const config = getConfig();
    if (!(config.enabled && isFocused())) {
      return;
    }
    const intervalMs = Math.max(1, config.intervalMinutes) * 60_000;
    // 按 common dir 分组：同主仓多 worktree 只 fetch 一次（spec §2）
    const groups = new Map<string, string[]>();
    for (const root of activeRoots()) {
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
    const jobs: Promise<void>[] = [];
    for (const [commonDir, roots] of groups) {
      const state = stateFor(commonDir);
      if (state.disabledForSession || state.inFlight) {
        continue;
      }
      const backoff = Math.min(2 ** state.failureCount, MAX_BACKOFF_MULTIPLIER);
      if (now() - state.lastAttemptAt < intervalMs * backoff) {
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
      if (heartbeat !== null) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
    },
    onFocusGained() {
      tick().catch(() => undefined);
    },
    start() {
      if (heartbeat !== null) {
        return;
      }
      heartbeat = setInterval(() => {
        tick().catch(() => undefined);
      }, heartbeatMs);
    },
    tick,
  };
}

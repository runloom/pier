# Git 状态及时同步 + 合并状态 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 状态栏对纯 ref 操作（fetch/push/prune/stash）≤5s 刷新；后台自动 fetch --prune 感知远端分支删除；新增"已合并"胶囊。

**Architecture:** git-watch-service 从 3 签名扩为 4 签名（新增 refsSig、增强 worktreeSig）；新建 git-autofetch-service 只执行 `git fetch --prune` 不产出状态（变化经既有签名→广播管道流向 renderer）；getStatus 增加 `mergedIntoDefault` 检测。Spec：`docs/superpowers/specs/2026-07-02-git-status-timely-sync-design.md`。

**Tech Stack:** Electron main (Node) + zod contracts + Vitest。真实 git 临时仓库测试用 `node:fs/promises` mkdtemp。

## Global Constraints

- **AGENTS.md git 安全边界**：每个 Commit 步骤都必须先 stage 明确路径、展示 `git diff --staged` 与 message、**获得用户确认后**才执行。用户未确认时跳过 commit 步骤继续下一任务（改动留在工作区）。
- 禁止 `@ts-ignore` / `@ts-expect-error` / `as any`。
- Biome 规则：正则字面量放模块顶层常量；Tailwind class 顺序由 `pnpm lint:fix` 修正。
- 每个任务结束跑 `pnpm check`（typecheck + lint + depcruise + file-size）必须通过。
- 单测命令：`pnpm vitest run <file>`；全量 `pnpm test:unit`。
- 数据流约束（spec §4）：autofetch 不得调用任何广播/IPC/状态构造 API，唯一出口是 git 子进程 + `pulse()`。

---

### Task 1: contracts — GitChangeKind 增加 "refs"、GitBranchInfo 增加 mergedIntoDefault

**Files:**
- Modify: `src/shared/contracts/git.ts:17-27`（gitBranchInfoSchema）
- Modify: `src/shared/contracts/git.ts:342`（gitChangeKindSchema）

**Interfaces:**
- Produces: `GitBranchInfo.mergedIntoDefault: boolean | null`（Task 6 后端赋值、Task 7 UI 消费）；`GitChangeKind = "worktree" | "head" | "both" | "refs"`（Task 2 消费）。

- [ ] **Step 1: 修改 schema**

```ts
// gitBranchInfoSchema 中 upstreamGone 之后加：
  /**
   * HEAD 是否已是默认分支 remote-tracking ref 的祖先（merge-base --is-ancestor）。
   * null = 不适用：detached / 无 origin/HEAD / 当前就在默认分支。
   * squash merge 检测不到（commit 被重写），是已知限制。
   */
  mergedIntoDefault: z.boolean().nullable(),
```

```ts
// 变更监听广播事件。changeKind 区分工作区/HEAD/纯 ref/组合变化。
// "refs" 仅在 refs 是唯一变化类别时上报（fetch/push/prune/stash 等纯 ref 操作）；
// 与 worktree/head 同时变化时沿用原有三值。
export const gitChangeKindSchema = z.enum(["worktree", "head", "both", "refs"]);
```

- [ ] **Step 2: 跑 typecheck 找出所有 GitBranchInfo 构造点**

Run: `pnpm typecheck`
Expected: FAIL——`mergedIntoDefault` 缺失的报错至少出现在 `src/main/services/git-service.ts`（getStatus）与 `tests/unit/renderer/git-plugin.test.tsx`（getStatus mock，含 2026-07-02 加的 gone/长分支名两个测试）。记录完整清单。

- [ ] **Step 3: 给所有构造点补字段**

- `git-service.ts` getStatus 的 branch 字面量：临时加 `mergedIntoDefault: null,`（Task 6 换成真实检测）。
- 测试 mock（`vi.mocked(window.pier.git.getStatus).mockResolvedValue` 与 beforeEach 里的 `getStatus: vi.fn(...)`）：加 `mergedIntoDefault: null,`。
- 其他 typecheck 报出的位置一律加 `mergedIntoDefault: null,`。

- [ ] **Step 4: 验证**

Run: `pnpm check && pnpm test:unit`
Expected: 全部通过。

- [ ] **Step 5: Commit（需用户确认）**

```bash
git add src/shared/contracts/git.ts src/main/services/git-service.ts tests/
git commit -m "feat(git): extend contracts with refs change kind and mergedIntoDefault"
```

---

### Task 2: git-watch-service — refsSig 新增 + worktreeSig 增强 + pulse/activeRoots

**Files:**
- Modify: `src/main/services/git-watch-service.ts`
- Test: `tests/unit/main/git-watch-service.test.ts`（先读现有测试的构造模式，新增用例跟随同一风格）

**Interfaces:**
- Consumes: Task 1 的 `GitChangeKind."refs"`。
- Produces: `GitWatchService.pulse(gitRoot: string): void`、`GitWatchService.activeRoots(): string[]`、`CreateGitWatchServiceOptions.computeRefsSignature?: (gitRoot: string) => Promise<string>`（Task 4 消费 pulse/activeRoots）。

- [ ] **Step 1: 写失败测试（refs-only 变化触发 changeKind "refs"）**

在现有测试文件中，按已有的注入式构造模式新增（下面代码是独立可运行版本，若现有文件已有等价 helper 就复用）：

```ts
it("refs 签名单独变化时广播 changeKind refs", async () => {
  let refsSig = "r1";
  const listener = vi.fn();
  const computeRefsSignature = vi.fn(async () => refsSig);
  const service = createGitWatchService({
    computeHeadSignature: async () => "h",
    computeRepoStateSignature: async () => "s",
    computeRefsSignature,
    computeWorktreeSignature: async () => "w",
    fsWatch: () => new EventEmitter() as unknown as FSWatcher,
    pollMs: 60_000,
  });
  const unsubscribe = service.watch("/repo", listener);
  // baseline（首次 force refresh）完成：四签名各被算过一次
  await vi.waitFor(() => {
    expect(computeRefsSignature).toHaveBeenCalledTimes(1);
  });
  refsSig = "r2";
  service.pulse("/repo");
  await vi.waitFor(() => {
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ changeKind: "refs", gitRoot: "/repo" })
    );
  });
  unsubscribe();
  await service.dispose();
});

it("activeRoots 返回有订阅者的 gitRoot", () => {
  const service = createGitWatchService({
    computeHeadSignature: async () => "h",
    computeRepoStateSignature: async () => "s",
    computeRefsSignature: async () => "r",
    computeWorktreeSignature: async () => "w",
    fsWatch: () => new EventEmitter() as unknown as FSWatcher,
    pollMs: 60_000,
  });
  const unsubscribe = service.watch("/repo", () => undefined);
  expect(service.activeRoots()).toEqual(["/repo"]);
  unsubscribe();
  expect(service.activeRoots()).toEqual([]);
});
```

注意：baseline 等待方式以现有测试文件的做法为准（它已有处理 baselineReady 的先例）；`fsWatch` 替身同理。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/unit/main/git-watch-service.test.ts`
Expected: FAIL——`computeRefsSignature` 不在 options 类型上 / `pulse`、`activeRoots` 不存在。

- [ ] **Step 3: 实现**

`git-watch-service.ts` 修改点（保持现有结构）：

```ts
// options 新增：
  /** refs 签名：refs/heads + refs/remotes + refs/stash 的 refname+oid。注入便于测试。 */
  computeRefsSignature?: (gitRoot: string) => Promise<string>;

// WatchEntry 新增字段：
  refsSig: string;

// 默认实现（defaultHeadSignature 旁）：
async function defaultRefsSignature(gitRoot: string): Promise<string> {
  try {
    const output = await execGit(
      [
        "for-each-ref",
        "--format=%(refname)%00%(objectname)",
        "refs/heads",
        "refs/remotes",
        "refs/stash",
      ],
      { cwd: gitRoot }
    );
    return createHash("sha256").update(output).digest("hex");
  } catch {
    return "";
  }
}

// defaultWorktreeSignature 替换为（status 失败仍返回 "" 保持旧语义；
// numstat 失败降级为空段不整体失败）：
async function defaultWorktreeSignature(gitRoot: string): Promise<string> {
  let statusOut: string;
  try {
    statusOut = await execGit(["status", "--porcelain=v2", "-z"], {
      cwd: gitRoot,
    });
  } catch {
    return "";
  }
  const numstat = (args: readonly string[]): Promise<string> =>
    execGit(args, { cwd: gitRoot }).catch(() => "");
  // numstat 折进签名：porcelain v2 不含工作区内容 oid，
  // 已修改文件继续编辑时只有 numstat 会变（spec 缺口③）
  const [unstaged, staged] = await Promise.all([
    numstat(["diff", "--numstat", "-z", "--no-renames"]),
    numstat(["diff", "--cached", "--numstat", "-z", "--no-renames"]),
  ]);
  return createHash("sha256")
    .update(`${statusOut}\u0000${unstaged}\u0000${staged}`)
    .digest("hex");
}

// deriveChangeKind 换签名（refs 仅在唯一变化类别时上报）：
function deriveChangeKind(
  worktreeChanged: boolean,
  headChanged: boolean,
  refsChanged: boolean
): GitChangeKind | null {
  if (worktreeChanged && headChanged) {
    return "both";
  }
  if (worktreeChanged) {
    return "worktree";
  }
  if (headChanged) {
    return "head";
  }
  if (refsChanged) {
    return "refs";
  }
  return null;
}

// refresh() 里：
    const [nextWorktree, nextHead, nextRepoState, nextRefs] = await Promise.all([
      computeWorktreeSignature(gitRoot),
      computeHeadSignature(gitRoot),
      computeRepoStateSignature(gitRoot),
      computeRefsSignature(gitRoot),
    ]);
    const refsChanged = nextRefs !== entry.refsSig;
    entry.refsSig = nextRefs;
    // ...原有三个 changed 判断不动，deriveChangeKind 传三参：
    const changeKind = deriveChangeKind(
      worktreeChanged || repoStateChanged,
      headChanged,
      refsChanged
    );

// createGitWatchService 解构默认值加 computeRefsSignature = defaultRefsSignature；
// watch() 里 entry 初始化加 refsSig: "";
// 返回对象加：
    activeRoots: () => Array.from(entries.keys()),
    pulse: (gitRoot: string) => {
      const entry = entries.get(gitRoot);
      if (!entry?.baselineReady) {
        return;
      }
      refresh(gitRoot, false).catch(() => undefined);
    },

// GitWatchService 接口加：
  /** 有订阅者的 gitRoot 列表（autofetch 用作活跃仓库注册表）。 */
  activeRoots(): string[];
  /** 立即重算签名走既有广播（autofetch fetch 完成后调用，免等 poll）。 */
  pulse(gitRoot: string): void;
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run tests/unit/main/git-watch-service.test.ts`
Expected: PASS（新旧用例全绿）。

- [ ] **Step 5: 真实仓库验证 refsSig 默认实现（新增用例）**

```ts
it("defaultRefsSignature 对 fetch/prune 类 ref 变化敏感（真实仓库）", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pier-refs-sig-"));
  const run = (args: string[], cwd: string) =>
    execGit(args, { cwd });
  await run(["init", "-q", "-b", "main"], dir);
  await run(["commit", "-q", "--allow-empty", "-m", "init"], dir);
  const computeWorktreeSignature = vi.fn(async () => "w");
  const service = createGitWatchService({
    computeHeadSignature: async () => "h",
    computeRepoStateSignature: async () => "s",
    computeWorktreeSignature,
    fsWatch: () => new EventEmitter() as unknown as FSWatcher,
    pollMs: 60_000,
  });
  const listener = vi.fn();
  const unsubscribe = service.watch(dir, listener);
  // baseline（首次 force refresh）完成后，制造一次纯 ref 变化：新建分支（refs/heads 多一条）
  await vi.waitFor(() => {
    expect(computeWorktreeSignature).toHaveBeenCalledTimes(1);
  });
  await run(["branch", "feature/x"], dir);
  service.pulse(dir);
  await vi.waitFor(() => {
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ changeKind: "refs" })
    );
  });
  unsubscribe();
  await service.dispose();
  await rm(dir, { recursive: true, force: true });
});
```

（execGit 从 `@/../main/services/git-exec.ts` 按现有测试的 import 路径引入；getStatus 未注入所以广播不带 status，符合预期。）

Run: `pnpm vitest run tests/unit/main/git-watch-service.test.ts`
Expected: PASS。

- [ ] **Step 6: 全量检查**

Run: `pnpm check && pnpm test:unit`
Expected: 全部通过。特别注意 `tests/integration/git-ipc-e2e.test.ts` / `git-service-e2e.test.ts` 若有对 changeKind 的断言需按新语义核对。

- [ ] **Step 7: Commit（需用户确认）**

```bash
git add src/main/services/git-watch-service.ts tests/unit/main/git-watch-service.test.ts
git commit -m "feat(git): refs signature + numstat-aware worktree signature + pulse/activeRoots"
```

---

### Task 3: preferences — gitAutoFetch 键

**Files:**
- Modify: `src/shared/contracts/preferences.ts`（schema + defaults 常量）
- Modify: `src/main/services/preferences-service.ts:29-84`（stripUndefinedPatch）
- Test: `tests/unit/` 下现有 preferences 相关测试文件（`grep -rl projectPreferencesSchema tests/` 定位；没有就新建 `tests/unit/shared/preferences-git-autofetch.test.ts`）

**Interfaces:**
- Produces: `ProjectPreferences.gitAutoFetchEnabled: boolean`（默认 true）、`ProjectPreferences.gitAutoFetchIntervalMinutes: number`（默认 5，1–120）。Task 5 消费。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from "vitest";
import { projectPreferencesSchema } from "@shared/contracts/preferences.ts";

describe("git autofetch preferences", () => {
  it("空对象解析出默认值：开启、5 分钟", () => {
    const prefs = projectPreferencesSchema.parse({});
    expect(prefs.gitAutoFetchEnabled).toBe(true);
    expect(prefs.gitAutoFetchIntervalMinutes).toBe(5);
  });

  it("间隔下限 1 上限 120", () => {
    expect(() =>
      projectPreferencesSchema.parse({ gitAutoFetchIntervalMinutes: 0 })
    ).toThrow();
    expect(() =>
      projectPreferencesSchema.parse({ gitAutoFetchIntervalMinutes: 121 })
    ).toThrow();
  });
});
```

- [ ] **Step 2: 确认失败**

Run: `pnpm vitest run <测试文件>`
Expected: FAIL——字段不存在（undefined ≠ true）。

- [ ] **Step 3: 实现**

`preferences.ts` defaults 区加：

```ts
export const DEFAULT_GIT_AUTO_FETCH_ENABLED = true;
export const DEFAULT_GIT_AUTO_FETCH_INTERVAL_MINUTES = 5;
```

schema（agentCommandOverrides 之后）加：

```ts
  gitAutoFetchEnabled: z.boolean().default(DEFAULT_GIT_AUTO_FETCH_ENABLED),
  gitAutoFetchIntervalMinutes: z
    .number()
    .int()
    .min(1)
    .max(120)
    .default(DEFAULT_GIT_AUTO_FETCH_INTERVAL_MINUTES),
```

`preferences-service.ts` stripUndefinedPatch 加（保持字母序位置无所谓，跟随现有排序风格）：

```ts
    ...(patch.gitAutoFetchEnabled !== undefined && {
      gitAutoFetchEnabled: patch.gitAutoFetchEnabled,
    }),
    ...(patch.gitAutoFetchIntervalMinutes !== undefined && {
      gitAutoFetchIntervalMinutes: patch.gitAutoFetchIntervalMinutes,
    }),
```

（`ProjectPreferencesPatch` 是 `projectPreferencesSchema.partial()` 自动派生，`PreferenceChangedKey = keyof ProjectPreferences` 自动扩展，无需另改。）

- [ ] **Step 4: 验证**

Run: `pnpm vitest run <测试文件> && pnpm check`
Expected: PASS。

- [ ] **Step 5: Commit（需用户确认）**

```bash
git add src/shared/contracts/preferences.ts src/main/services/preferences-service.ts tests/
git commit -m "feat(preferences): git auto-fetch enabled/interval keys"
```

---

### Task 4: git-autofetch-service（新文件，全 DI，核心任务）

**Files:**
- Create: `src/main/services/git-autofetch-service.ts`
- Test: `tests/unit/main/git-autofetch-service.test.ts`（新建）

**Interfaces:**
- Consumes: Task 2 的 `activeRoots()` / `pulse()`（经 options 注入，本任务不 import watch service）。
- Produces:

```ts
export interface GitAutofetchConfig {
  enabled: boolean;
  intervalMinutes: number;
}
export interface GitAutofetchService {
  dispose(): void;
  onFocusGained(): void;
  start(): void;
  /** 执行一轮检查+fetch。生产由 start() 心跳驱动；测试直接 await。 */
  tick(): Promise<void>;
}
export function createGitAutofetchService(
  options: CreateGitAutofetchServiceOptions
): GitAutofetchService;
```

- [ ] **Step 1: 写失败测试（完整行为矩阵）**

```ts
import { describe, expect, it, vi } from "vitest";
import { GitExecError } from "@/../main/services/git-exec.ts"; // 按现有 main 单测的 import 别名调整
import { createGitAutofetchService } from "@/../main/services/git-autofetch-service.ts";

function makeHarness(overrides: Record<string, unknown> = {}) {
  let nowMs = 0;
  const fetched: string[] = [];
  const pulsed: string[] = [];
  const execGit = vi.fn(async (args: readonly string[], opts: { cwd: string }) => {
    fetched.push(opts.cwd);
    return "";
  });
  const service = createGitAutofetchService({
    activeRoots: () => ["/repo/wt-a", "/repo/wt-b"],
    execGit: execGit as never,
    getConfig: () => ({ enabled: true, intervalMinutes: 5 }),
    isFocused: () => true,
    now: () => nowMs,
    pulse: (root: string) => pulsed.push(root),
    resolveCommonDir: async () => "/repo/.git",
    ...overrides,
  });
  return {
    advance: (ms: number) => {
      nowMs += ms;
    },
    execGit,
    fetched,
    pulsed,
    service,
  };
}

describe("git-autofetch-service", () => {
  it("同一 common dir 的多个 worktree 每轮只 fetch 一次，成功后 pulse 全部活跃 root", async () => {
    const h = makeHarness();
    h.advance(5 * 60_000);
    await h.service.tick();
    expect(h.fetched).toHaveLength(1);
    expect(h.execGit).toHaveBeenCalledWith(
      ["fetch", "--prune", "--quiet"],
      expect.objectContaining({ cwd: "/repo/wt-a", timeoutMs: 30_000 })
    );
    expect(h.pulsed).toEqual(["/repo/wt-a", "/repo/wt-b"]);
  });

  it("间隔未到不 fetch；到点才 fetch", async () => {
    const h = makeHarness();
    h.advance(4 * 60_000);
    await h.service.tick();
    expect(h.fetched).toHaveLength(0);
    h.advance(60_000);
    await h.service.tick();
    expect(h.fetched).toHaveLength(1);
  });

  it("未聚焦不 fetch", async () => {
    const h = makeHarness({ isFocused: () => false });
    h.advance(10 * 60_000);
    await h.service.tick();
    expect(h.fetched).toHaveLength(0);
  });

  it("preferences 关闭时不 fetch", async () => {
    const h = makeHarness({
      getConfig: () => ({ enabled: false, intervalMinutes: 5 }),
    });
    h.advance(10 * 60_000);
    await h.service.tick();
    expect(h.fetched).toHaveLength(0);
  });

  it("失败后指数退避：2 倍间隔内不重试，上限 8 倍", async () => {
    let fail = true;
    const h = makeHarness({
      execGit: vi.fn(async () => {
        if (fail) {
          throw new GitExecError({
            args: ["fetch"],
            cwd: "/repo/wt-a",
            exitCode: 1,
            message: "network down",
            stderr: "could not resolve host",
            stdout: "",
          });
        }
        return "";
      }),
    });
    h.advance(5 * 60_000);
    await h.service.tick(); // 失败 #1
    h.advance(5 * 60_000);
    await h.service.tick(); // 2 倍退避窗口内，跳过
    expect(h.pulsed).toHaveLength(0);
    fail = false;
    h.advance(5 * 60_000); // 距上次尝试 10min = 2 倍间隔
    await h.service.tick();
    expect(h.pulsed).toEqual(["/repo/wt-a", "/repo/wt-b"]);
  });

  it("鉴权类失败本会话停用该仓库", async () => {
    const h = makeHarness({
      execGit: vi.fn(async () => {
        throw new GitExecError({
          args: ["fetch"],
          cwd: "/repo/wt-a",
          exitCode: 128,
          message: "auth",
          stderr: "fatal: could not read Username for 'https://github.com'",
          stdout: "",
        });
      }),
    });
    h.advance(5 * 60_000);
    await h.service.tick();
    h.advance(100 * 60_000);
    await h.service.tick();
    expect(h.pulsed).toHaveLength(0);
    // execGit 只被调过一次（停用后不再尝试）
  });

  it("onFocusGained 触发到期补跑", async () => {
    let focused = false;
    const h = makeHarness({ isFocused: () => focused });
    h.advance(10 * 60_000);
    await h.service.tick();
    expect(h.fetched).toHaveLength(0);
    focused = true;
    h.service.onFocusGained();
    await vi.waitFor(() => {
      expect(h.fetched).toHaveLength(1);
    });
  });
});
```

- [ ] **Step 2: 确认失败**

Run: `pnpm vitest run tests/unit/main/git-autofetch-service.test.ts`
Expected: FAIL——模块不存在。

- [ ] **Step 3: 实现**

```ts
import {
  execGit as defaultExecGit,
  GitExecError,
} from "./git-exec.ts";

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
```

- [ ] **Step 4: 确认通过**

Run: `pnpm vitest run tests/unit/main/git-autofetch-service.test.ts`
Expected: PASS（7 用例全绿）。

- [ ] **Step 5: 全量检查**

Run: `pnpm check && pnpm test:unit`
Expected: 通过（注意 depcruise：git-autofetch-service 只依赖 git-exec，属 L 层内合法依赖）。

- [ ] **Step 6: Commit（需用户确认）**

```bash
git add src/main/services/git-autofetch-service.ts tests/unit/main/git-autofetch-service.test.ts
git commit -m "feat(git): auto-fetch service with prune, dedupe, backoff and focus gating"
```

---

### Task 5: 装配 — index.ts 启动 autofetch

**Files:**
- Modify: `src/main/index.ts`（`app.whenReady().then(async () => {...})`，位于 :173 附近）

**Interfaces:**
- Consumes: Task 2 `gitWatch.activeRoots/pulse`、Task 3 preferences 键、Task 4 `createGitAutofetchService`。
- Produces: 无新接口（纯 wiring）。

- [ ] **Step 1: 实现 wiring**

在 whenReady 回调内（现有 preferences 读取/eventBus 订阅代码附近）加：

```ts
// git autofetch：只写 git、经 watch 签名广播进入既有数据流（spec §4）
const initialPrefs = await appCore.services.preferences.read();
let autofetchConfig = {
  enabled: initialPrefs.gitAutoFetchEnabled,
  intervalMinutes: initialPrefs.gitAutoFetchIntervalMinutes,
};
appCore.eventBus.subscribe((event) => {
  if (event.type === "preferences.changed") {
    autofetchConfig = {
      enabled: event.snapshot.gitAutoFetchEnabled,
      intervalMinutes: event.snapshot.gitAutoFetchIntervalMinutes,
    };
  }
});
const gitAutofetch = createGitAutofetchService({
  activeRoots: () => appCore.services.gitWatch.activeRoots(),
  getConfig: () => autofetchConfig,
  isFocused: () => windowManager.getFocused() !== null,
  pulse: (gitRoot) => {
    appCore.services.gitWatch.pulse(gitRoot);
  },
});
gitAutofetch.start();
app.on("browser-window-focus", () => {
  gitAutofetch.onFocusGained();
});
app.on("will-quit", () => {
  gitAutofetch.dispose();
});
```

import 补 `createGitAutofetchService`；`windowManager` 若未在 index.ts 引入则从 `./windows/window-manager.ts` 引入；`appCore.services.gitWatch` 的类型在 `command-router.ts` 的 `PierCoreServices`——若那里对 gitWatch 的类型声明窄于新接口，同步更新。

- [ ] **Step 2: 验证**

Run: `pnpm check && pnpm test:unit`
Expected: 通过。

Run: `pnpm dev` 手动验证——打开一个有 upstream 的 repo 面板，观察 main 进程 console 无 autofetch 报错；在外部终端删远端分支后 ≤5 分钟（或切走再切回窗口）状态栏出现红色"远端已删"胶囊。

- [ ] **Step 3: Commit（需用户确认）**

```bash
git add src/main/index.ts src/main/app-core/command-router.ts
git commit -m "feat(git): wire auto-fetch service into app lifecycle"
```

---

### Task 6: mergedIntoDefault 后端检测

**Files:**
- Modify: `src/main/services/git-status-detectors.ts`（新增 resolveDefaultBranchRef / detectMergedIntoDefault）
- Modify: `src/main/services/git-service.ts:359-393`（getStatus）
- Test: `tests/unit/main/git-status-detectors.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `mergedIntoDefault` 字段。
- Produces:

```ts
export function resolveDefaultBranchRef(
  execGit: ExecGitFn, cwd: string, gitCommonDir: string
): Promise<string | null>;
export function detectMergedIntoDefault(
  execGit: ExecGitFn, cwd: string, branch: string | null, gitCommonDir: string
): Promise<boolean | null>;
export function clearDefaultBranchRefCacheForTests(): void;
```

- [ ] **Step 1: 写失败测试（真实临时仓库）**

跟随该测试文件现有的真实仓库/fake execGit 风格；独立可运行版本：

```ts
// helper：本地裸仓 + clone，制造真实 origin/HEAD
async function makeClonePair(prefix: string): Promise<{ dir: string; run: (args: string[]) => Promise<string> }> {
  const base = await mkdtemp(join(tmpdir(), prefix));
  const bare = join(base, "remote.git");
  const clone = join(base, "local");
  const raw = (args: string[], cwd: string) => execGitRaw(args, { cwd });
  await raw(["init", "-q", "--bare", "-b", "main", bare], base);
  await raw(["clone", "-q", bare, clone], base);
  const run = (args: string[]) => raw(args, clone);
  await run(["commit", "-q", "--allow-empty", "-m", "init"]);
  await run(["push", "-q", "-u", "origin", "main"]);
  // clone 自带 origin/HEAD → main
  return { dir: clone, run };
}

describe("detectMergedIntoDefault", () => {
  beforeEach(() => {
    clearDefaultBranchRefCacheForTests();
  });

  it("merge 合入默认分支后为 true", async () => {
    const { dir, run } = await makeClonePair("pier-merged-");
    await run(["checkout", "-q", "-b", "feature/a"]);
    await run(["commit", "-q", "--allow-empty", "-m", "work"]);
    await run(["checkout", "-q", "main"]);
    await run(["merge", "-q", "--no-ff", "feature/a", "-m", "merge"]);
    await run(["push", "-q", "origin", "main"]);
    await run(["checkout", "-q", "feature/a"]);
    const result = await detectMergedIntoDefault(execGit, dir, "feature/a", await commonDirOf(dir));
    expect(result).toBe(true);
  });

  it("未合入时为 false", async () => {
    const { dir, run } = await makeClonePair("pier-unmerged-");
    await run(["checkout", "-q", "-b", "feature/b"]);
    await run(["commit", "-q", "--allow-empty", "-m", "wip"]);
    const result = await detectMergedIntoDefault(execGit, dir, "feature/b", await commonDirOf(dir));
    expect(result).toBe(false);
  });

  it("squash 合入检测不到（已知限制，记 false）", async () => {
    const { dir, run } = await makeClonePair("pier-squash-");
    await run(["checkout", "-q", "-b", "feature/c"]);
    await writeFile(join(dir, "f.txt"), "x");
    await run(["add", "f.txt"]);
    await run(["commit", "-q", "-m", "work"]);
    await run(["checkout", "-q", "main"]);
    await run(["merge", "-q", "--squash", "feature/c"]);
    await run(["commit", "-q", "-m", "squashed"]);
    await run(["push", "-q", "origin", "main"]);
    await run(["checkout", "-q", "feature/c"]);
    const result = await detectMergedIntoDefault(execGit, dir, "feature/c", await commonDirOf(dir));
    expect(result).toBe(false);
  });

  it("无 origin/HEAD（本地 init 仓库）为 null", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-noremote-"));
    await execGitRaw(["init", "-q", "-b", "main"], { cwd: dir });
    await execGitRaw(["commit", "-q", "--allow-empty", "-m", "init"], { cwd: dir });
    const result = await detectMergedIntoDefault(execGit, dir, "main", await commonDirOf(dir));
    expect(result).toBe(null);
  });

  it("当前就在默认分支上为 null", async () => {
    const { dir } = await makeClonePair("pier-ondefault-");
    const result = await detectMergedIntoDefault(execGit, dir, "main", await commonDirOf(dir));
    expect(result).toBe(null);
  });

  it("detached（branch 为 null）为 null", async () => {
    const { dir } = await makeClonePair("pier-detached-");
    const result = await detectMergedIntoDefault(execGit, dir, null, await commonDirOf(dir));
    expect(result).toBe(null);
  });
});
```

（`execGit` 为该测试文件已有的 ExecGitFn 适配；`execGitRaw` 为 git-exec 的原始 execGit；`commonDirOf` = `(dir) => execGitRaw(["rev-parse","--path-format=absolute","--git-common-dir"], { cwd: dir }).then(s => s.trim())`。若测试文件已有等价 helper 直接复用。）

- [ ] **Step 2: 确认失败**

Run: `pnpm vitest run tests/unit/main/git-status-detectors.test.ts`
Expected: FAIL——detectMergedIntoDefault 未导出。

- [ ] **Step 3: 实现 detectors**

`git-status-detectors.ts` 追加（文件顶部补 `import { GitExecError } from "./git-exec.ts";`）：

```ts
/**
 * 默认分支 remote-tracking ref 缓存（key: gitCommonDir，session 生命周期）。
 * origin/HEAD 不存在（手工 remote / 无远端）记 null，短路后续查询。
 */
const defaultBranchRefCache = new Map<string, string | null>();

export function clearDefaultBranchRefCacheForTests(): void {
  defaultBranchRefCache.clear();
}

export async function resolveDefaultBranchRef(
  execGit: ExecGitFn,
  cwd: string,
  gitCommonDir: string
): Promise<string | null> {
  const cached = defaultBranchRefCache.get(gitCommonDir);
  if (cached !== undefined) {
    return cached;
  }
  let ref: string | null = null;
  try {
    const out = await execGit(
      ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"],
      cwd
    );
    const trimmed = out.trim();
    ref = trimmed.startsWith("refs/remotes/") ? trimmed : null;
  } catch {
    ref = null;
  }
  defaultBranchRefCache.set(gitCommonDir, ref);
  return ref;
}

/**
 * HEAD 是否已是默认分支 remote-tracking ref 的祖先。
 * merge-base --is-ancestor: exit 0 = 是，exit 1 = 否，其余（如 ref 不存在）= null。
 * squash merge 检测不到（commit 被重写）——spec 已知限制。
 */
export async function detectMergedIntoDefault(
  execGit: ExecGitFn,
  cwd: string,
  branch: string | null,
  gitCommonDir: string
): Promise<boolean | null> {
  if (branch === null || branch.length === 0) {
    return null;
  }
  const defaultRef = await resolveDefaultBranchRef(execGit, cwd, gitCommonDir);
  if (defaultRef === null) {
    return null;
  }
  if (defaultRef === `refs/remotes/origin/${branch}`) {
    return null;
  }
  try {
    await execGit(["merge-base", "--is-ancestor", "HEAD", defaultRef], cwd);
    return true;
  } catch (error) {
    if (error instanceof GitExecError && error.exitCode === 1) {
      return false;
    }
    return null;
  }
}
```

- [ ] **Step 4: getStatus 接线**

`git-service.ts` getStatus：wave 1 的 rev-parse 增加 `--git-common-dir`；wave 2 并发加 detectMergedIntoDefault；branch 字面量把 Task 1 的 `mergedIntoDefault: null` 换成真值：

```ts
      const [statusOut, delta, stashCount, gitDirOut] = await Promise.all([
        execGit(["status", "--porcelain=v2", "--branch", "-z"], cwd),
        getLineDelta(execGit, cwd),
        getStashCount(execGit, cwd),
        execGit(
          [
            "rev-parse",
            "--path-format=absolute",
            "--absolute-git-dir",
            "--git-common-dir",
          ],
          cwd
        ),
      ]);
      const parsed = parseGitStatus(statusOut);
      const counts = deriveCounts(parsed.files);
      const dirLines = gitDirOut
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      const gitDir = dirLines[0] ?? "";
      const gitCommonDir = dirLines[1] ?? gitDir;
      const [repoState, upstreamGone, mergedIntoDefault] = await Promise.all([
        detectRepoState(gitDir, counts.conflict),
        detectUpstreamGone(execGit, cwd, parsed.branch.branch),
        detectMergedIntoDefault(execGit, cwd, parsed.branch.branch, gitCommonDir),
      ]);
      return {
        branch: {
          ahead: parsed.branch.ahead,
          behind: parsed.branch.behind,
          branch: parsed.branch.branch,
          mergedIntoDefault,
          oid: parsed.branch.oid,
          upstream: parsed.branch.upstream,
          upstreamGone,
        },
        // counts / delta / files / repoState / stashCount 不变
```

import 区补 `detectMergedIntoDefault`。

- [ ] **Step 5: 验证**

Run: `pnpm vitest run tests/unit/main/git-status-detectors.test.ts tests/unit/main/git-service.test.ts && pnpm check && pnpm test:unit`
Expected: 全部通过（git-service.test.ts 若断言了 rev-parse 精确参数需同步更新）。

- [ ] **Step 6: Commit（需用户确认）**

```bash
git add src/main/services/git-status-detectors.ts src/main/services/git-service.ts tests/unit/main/git-status-detectors.test.ts
git commit -m "feat(git): detect branch merged into default via merge-base ancestry"
```

---

### Task 7: "已合并"胶囊 UI

**Files:**
- Modify: `src/plugins/builtin/git/renderer/git-status-parts.tsx`（PILL_VARIANT + MergedPill）
- Modify: `src/plugins/builtin/git/renderer/git-status-item.tsx`（StatusBody）
- Modify: `src/plugins/builtin/git/locales/en.json` / `zh-CN.json`
- Test: `tests/unit/renderer/git-plugin.test.tsx`

**Interfaces:**
- Consumes: Task 1/6 的 `branch.mergedIntoDefault`；现有 `Pill`（已支持 `testId`，2026-07-02 加）。
- Produces: `MergedPill({ merged, pluginContext })`，`data-testid="merged-pill"`。

- [ ] **Step 1: 写失败测试**

在 git-plugin.test.tsx 的状态栏用例区（gone 胶囊测试旁）加，mock 结构复制该文件现有 getStatus mock 全量字段：

```tsx
it("分支已合入默认分支时展示 merged 胶囊，可与 gone 胶囊共存", async () => {
  vi.mocked(window.pier.git.getStatus).mockResolvedValue({
    branch: {
      ahead: 0,
      behind: 0,
      branch: "feature/done",
      mergedIntoDefault: true,
      oid: "abc123",
      upstream: "origin/feature/done",
      upstreamGone: true,
    },
    counts: { conflict: 0, modified: 0, staged: 0, untracked: 0 },
    delta: null,
    files: [],
    repoState: { kind: "clean" as const },
    stashCount: 0,
  });
  dispose = activateWorktreePlugin();
  const statusItem = terminalStatusItemRegistry
    .list()
    .find((item) => item.id === "pier.worktree.status");
  if (!statusItem) {
    throw new Error("expected worktree status item");
  }

  render(
    statusItem.render({
      context: { ...context, branch: "feature/done" },
      cwd: context.cwd ?? null,
      panelId: "terminal-1",
      title: null,
    })
  );

  const merged = await screen.findByTestId("merged-pill");
  expect(merged).toHaveTextContent("merged");
  expect(screen.getByTestId("upstream-gone-pill")).toBeInTheDocument();
});
```

- [ ] **Step 2: 确认失败**

Run: `pnpm vitest run tests/unit/renderer/git-plugin.test.tsx`
Expected: FAIL——`merged-pill` 找不到。

- [ ] **Step 3: 实现**

`git-status-parts.tsx`：

```ts
// PILL_VARIANT 加：
  success:
    "border-status-success-border bg-status-success-bg text-status-success-fg",
```

（`--color-status-success-*` 已在 `src/renderer/app/globals.css` 的 `@theme inline` 映射，无需改 CSS。）

```tsx
/** 已合入默认分支。与 UpstreamPill(gone) 共存时即"可清理 worktree"的完整信号。 */
export function MergedPill({
  merged,
  pluginContext,
}: {
  merged: boolean | null;
  pluginContext: RendererPluginContext;
}): React.ReactElement | null {
  if (merged !== true) {
    return null;
  }
  return (
    <Pill icon={Check} testId="merged-pill" variant="success">
      {pluginText(pluginContext, "mergedIntoDefault", "merged")}
    </Pill>
  );
}
```

（`Check` 已在该文件 lucide 导入里。）

`git-status-item.tsx` StatusBody，`<UpstreamPill ... />` 之后加：

```tsx
      <MergedPill
        merged={branch?.mergedIntoDefault ?? null}
        pluginContext={pluginContext}
      />
```

import 区补 `MergedPill`。

locales `en.json` 的 `ui.upstreamGone` 旁加：

```json
    "ui.mergedIntoDefault": "merged",
```

`zh-CN.json`：

```json
    "ui.mergedIntoDefault": "已合并",
```

- [ ] **Step 4: 确认通过 + 全量**

Run: `pnpm vitest run tests/unit/renderer/git-plugin.test.tsx && pnpm check && pnpm test:unit`
Expected: 全部通过。

- [ ] **Step 5: Commit（需用户确认）**

```bash
git add src/plugins/builtin/git/renderer/git-status-parts.tsx src/plugins/builtin/git/renderer/git-status-item.tsx src/plugins/builtin/git/locales/en.json src/plugins/builtin/git/locales/zh-CN.json tests/unit/renderer/git-plugin.test.tsx
git commit -m "feat(git): merged-into-default pill in terminal status bar"
```

---

### Task 8: 端到端验证

**Files:** 无新改动（验证任务）。

- [ ] **Step 1: 全量检查**

Run: `pnpm check && pnpm test:unit && pnpm test:e2e`
Expected: 全部通过（e2e 失败先判断是否为本变更引入）。

- [ ] **Step 2: 真机验证（pnpm dev）**

1. 打开一个 clone 仓库的 worktree 面板，checkout 一个已推送分支。
2. 外部终端：向该分支 upstream push 一个新 commit（另一台 clone 或直接 update-ref 模拟）→ 状态栏 behind ↓ 数字 ≤5s 出现（refsSig 生效）。
3. 外部终端删远端分支 + 本地 `git fetch --prune` → 红色"远端已删"胶囊 ≤5s 出现。
4. 分支 merge 进 main 并 push 后 → 绿色"已合并"胶囊出现。
5. 编辑一个已 modified 文件多次保存 → +N/-N 随保存更新（worktreeSig numstat 生效）。
6. 不手动 fetch，等 autofetch 周期（或切窗口焦点触发）→ gone 胶囊自动出现。

Expected: 六项全部符合；main 进程 console 无 autofetch 报错刷屏。

- [ ] **Step 3: 汇报**

向用户汇报验证结果（含未通过项与原因）。

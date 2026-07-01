# Git 状态栏 v2 设计

更新时间：2026-07-01

## 背景与问题

现状：git 状态栏只有 `WorktreeStatusItem`（[git-status-item.tsx:119-166](../../../src/plugins/builtin/git/renderer/git-status-item.tsx)）一块，显示 **分支名 + ahead/behind + 脏文件聚合数**，label 靠字符串拼接（`↑2↓1 ·5`）。

问题：

- **聚合失真**：脏文件数不分 staged / unstaged / untracked / conflict，用户不知道能不能直接 commit。
- **仓库特殊状态完全缺**：MERGE / REBASE / CHERRY-PICK / REVERT / BISECT 都不显示，而这些恰恰最容易出错。
- **AI 场景关键信号缺**：一次改百文件、多 worktree 并行等 Pier 独有场景的预警缺失。
- **信息孤岛**：`GitStatus.branch` 已有 upstream 字段但未用；`worktreeRoot` 已在 `PanelContext`（[panel.ts:21-36](../../../src/shared/contracts/panel.ts)）但状态栏无引用。
- **组件单块难扩展**：`WorktreeStatusItem` 内部把 label 拼成一个字符串，加新元素只能继续拼字符串。

UI 已经过 5 轮迭代 + 2 轮业界对标（VSCode / JetBrains / GitHub Desktop / magit / lazygit）收敛到 v7 稿，本 spec 落地 v7。

## 目标与非目标

目标：

- 覆盖 v7 UI 稿的 15 个直接可行状态 + 7 个需实现状态，分 3 期上。
- Backend `GitStatus` schema 扩展，支持仓库特殊态、行级增删、Pier 差异化字段。
- `git-watch-service` 补 `.git/*_HEAD` 变化捕获，不留状态回流盲区。
- Frontend 拆 `WorktreeStatusItem` 单块 → 可组合的 6 个 status 组件。
- 修复实时同步现存 bug（renderer 竞态 · debounce 饥饿 · broadcast 无 payload · watcher 崩溃不恢复），详见 [实时同步与竞态](#实时同步与竞态)。

非目标（本 spec 明确不做）：

- **fetch / push / pull IPC wrapper**：需另立独立 feature 决策；本 spec 状态栏不显 sync 进度（与 magit / lazygit / Sublime Merge 一致）。
- **pre-commit hook / submodule / LFS pill**：业界主流 IDE / git 客户端均不在状态栏做，本 spec 不做；如需，走 changes panel。
- **"已合并" 3s 常驻 pill**：业界无对标，改走 shadcn `Toast` 一次性反馈，不占状态栏。
- **chokidar 迁移**：现有 `fs.watch` + 签名扩展方案够用；chokidar 是独立性能决策。
- **git-changes panel 内容**：属 P0 另一 spec（[2026-06-30-git-plugin-consolidation-design.md](2026-06-30-git-plugin-consolidation-design.md) 二期）。

## 现状

### Backend

- **git 库**：Pier spawn `git` binary，非 simple-git / nodegit。所有命令走 `execGit()` ([git-exec.ts:62-234](../../../src/main/services/git-exec.ts))，默认 10s 超时、16MB 输出上限、写操作 60s（`WRITE_TIMEOUT_MS`）。
- **`GitStatus` 字段**（[git.ts:26-30](../../../src/shared/contracts/git.ts)）：
  - `branch`：`{ head, upstream, ahead, behind }`
  - `files`：`[{ index, worktree, path, origPath }]`
  - 无仓库特殊态、无行级增删、无 stash 数、无 worktree 身份、无 upstream-gone 标记。
- **IPC wrapper**：`src/main/ipc/command.ts:10-44` 有 21 个 git 命令（commit / stage / unstage / branch / worktree 等），**没有** push / fetch / pull。
- **变更监听**（[git-watch-service.ts:114-237](../../../src/main/services/git-watch-service.ts)）：
  - `fs.watch(gitRoot, { recursive: true })`（Linux 降级到 `.git`）
  - `computeWorktreeSignature` = `sha256(git status --porcelain=v2 -z)` + `computeHeadSignature` = `sha256(HEAD oid + symbolic-ref)`
  - Debounce 400ms，30s 轮询兜底
  - **盲区**：`.git/MERGE_HEAD` / `.git/rebase-merge/` / `.git/CHERRY_PICK_HEAD` 等文件的**创建/删除不会引起 `git status --porcelain` 输出变化**（这些是操作状态标志，不是工作区文件），签名 hash 相同 → 广播不触发。

### Frontend

- `WorktreeStatusItem`（[git-status-item.tsx:119-166](../../../src/plugins/builtin/git/renderer/git-status-item.tsx)）：一个 `<Button>` 包 `<GitBranch />` + 拼字符串 label。
- 数据源：`useGitStatus(pluginContext, gitRoot)` 用 `getStatus` + `watch` 广播刷新。
- 点击行为：`openWorktreeListQuickPick(pluginContext, worktreePath)` —— 弹 worktree 列表，仅一个 target。

## 目标：v7 状态清单

| # | 状态 | 等级 | 说明 |
|---|---|---|---|
| 1 | staged / modified / untracked / conflict 分项 | ✅ | 由 `files` 已有字段聚合 |
| 2 | +N / -N 行级增删 | ✅ | 需并发跑 2 次 `git diff --numstat` |
| 3 | branch / no upstream / ahead-behind | ✅ | 已有 |
| 4 | Detached HEAD + 短 sha | ✅ | 已有 |
| 5 | Worktree 身份显示 | ✅ | 已有（`GitRepoInfo.isWorktree`） |
| 6 | 长分支名截断（UI） | ✅ | 纯前端 |
| 7 | 大规模变更预警（heuristic） | ✅ | 客户端 |
| 8 | Stash 数量 | ⚠ | 需 `git stash list` 计数 |
| 9 | upstream gone | ⚠ | 需 `git branch -vv` 解析 `[gone]` |
| 10 | MERGING · N 冲突 | ⚠ | `.git/MERGE_HEAD` + `files` 里 unmerged 数 |
| 11 | REBASING M/N · N 冲突 | ⚠ | `.git/rebase-merge/msgnum` + `end` |
| 12 | CHERRY-PICK · N 冲突 | ⚠ | `.git/CHERRY_PICK_HEAD` |
| 13 | REVERT · N 冲突 | ⚠ | `.git/REVERT_HEAD` |
| 14 | BISECT · g / b 数 | ⚠ | `.git/BISECT_START` + parse `.git/BISECT_LOG` |

明确不做（业界均不放常驻位）：`pre-commit hook` / `submodule dirty` / `LFS missing` / `fetch/push/pull` 进度 / `push 被拒` / `已合并` 常驻 pill。

## Backend 设计

### GitStatus schema 扩展

新增字段全部可选（backend 逐步补齐时 renderer 已能渲染部分）。

```ts
// 新增：文件类别聚合计数（避免 renderer 遍历 files 数组）
export const gitCountsSchema = z.object({
  staged: z.number(),      // index 非 '.' 且非 '?'
  modified: z.number(),    // worktree 非 '.' 且非 '?'
  untracked: z.number(),   // index === '?' && worktree === '?'
  conflict: z.number(),    // index/worktree 含 'u'（unmerged）
});

// 新增：行级增删（staged + unstaged 汇总）
export const gitDeltaSchema = z.object({
  insertions: z.number(),
  deletions: z.number(),
});

// 新增：仓库特殊状态（tagged union）
export const gitRepoStateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("clean") }),
  z.object({ kind: z.literal("merging"), conflictCount: z.number() }),
  z.object({ kind: z.literal("rebasing"), current: z.number(), total: z.number(), conflictCount: z.number() }),
  z.object({ kind: z.literal("cherry-picking"), conflictCount: z.number() }),
  z.object({ kind: z.literal("reverting"), conflictCount: z.number() }),
  z.object({ kind: z.literal("bisecting"), good: z.number(), bad: z.number() }),
]);
export type GitRepoState = z.infer<typeof gitRepoStateSchema>;

// GitBranchInfo 扩展
export const gitBranchInfoSchema = z.object({
  ahead: z.number(),
  behind: z.number(),
  branch: z.string().nullable(),
  upstream: z.string().nullable(),
  upstreamGone: z.boolean(),  // NEW: upstream 配置了但已删
});

// GitStatus 扩展
export const gitStatusSchema = z.object({
  branch: gitBranchInfoSchema,
  files: z.array(gitFileStatusSchema),
  counts: gitCountsSchema,          // NEW
  delta: gitDeltaSchema.nullable(), // NEW，null = 未计算或非常规变更
  repoState: gitRepoStateSchema,    // NEW
  stashCount: z.number(),           // NEW
});
```

Worktree 身份**不进 `GitStatus`**（已在 `GitRepoInfo` 里，renderer 单独获取），避免每次 status 广播都携带不变的元信息。

### git-exec 新增函数

新函数全部放 `src/main/services/git-exec.ts`（保持"所有 git 命令都过 `execGit`"约束）。

- `detectRepoState(gitCommonDir: string): Promise<GitRepoState>`
  - **不用 execGit**，直接 `fs.access` 检查 `.git/{MERGE_HEAD, rebase-merge/, rebase-apply/, CHERRY_PICK_HEAD, REVERT_HEAD, BISECT_START}` 存在性
  - Rebase 步进：`fs.readFile('rebase-merge/msgnum')` + `rebase-merge/end`；读失败视为 `{ current: 0, total: 0 }` 不 throw
  - Bisect 数：`fs.readFile('.git/BISECT_LOG')` 逐行数 `good ` / `bad ` 前缀（`git bisect log` 输出格式）
  - Conflict count 从 `files.filter(f => f.index === 'u' || f.worktree === 'u').length` 传入，不重复算
  - 命中优先级：`bisecting > rebasing > merging > cherry-picking > reverting > clean`（Git 保证互斥）

- `getLineDelta(gitRoot: string): Promise<{ insertions: number; deletions: number } | null>`
  - 并发 `execGit(['diff', '--numstat', '-z'])` + `execGit(['diff', '--cached', '--numstat', '-z'])`
  - Parse `--numstat` 输出（`<insertions>\t<deletions>\t<path>` per line；binary 为 `-\t-\t<path>`，binary 记 0）
  - 任一失败返回 `null`（非致命）

- `getStashCount(gitRoot: string): Promise<number>`
  - `execGit(['rev-list', '--walk-reflogs', '--count', 'refs/stash'])`，无 stash 返回 `0`（stderr `unknown revision 'refs/stash'` swallow）
  - 比 `git stash list | wc -l` 快、无 fork bash

- `detectUpstreamGone(gitRoot: string, branch: string | null): Promise<boolean>`
  - branch 为 null 直接返回 `false`
  - `execGit(['for-each-ref', "--format=%(upstream:track)", `refs/heads/${branch}`])`
  - 输出含 `[gone]` → true
  - 比 `git branch -vv` 精准（不解析全表）

### git-watch-service 补丁

关键：现有签名 `sha256(git status --porcelain=v2 -z)` 抓不到 `.git/*_HEAD` 变化（这些文件的存在与否不改 status 输出）。

方案：**签名扩展**，把仓库特殊态"存在性位图"折进 worktree signature。

```ts
async function defaultWorktreeSignature(gitRoot: string, gitCommonDir: string): Promise<string> {
  const [statusOutput, mergeExists, rebaseFile, cherryExists, revertExists, bisectExists] = await Promise.all([
    execGit(['status', '--porcelain=v2', '-z'], { cwd: gitRoot }).catch(() => ''),
    fs.access(`${gitCommonDir}/MERGE_HEAD`).then(() => '1', () => '0'),
    fs.readFile(`${gitCommonDir}/rebase-merge/msgnum`, 'utf8').catch(() => ''),  // 内容也进签名，rebase 步进变化能触发
    fs.access(`${gitCommonDir}/CHERRY_PICK_HEAD`).then(() => '1', () => '0'),
    fs.access(`${gitCommonDir}/REVERT_HEAD`).then(() => '1', () => '0'),
    fs.access(`${gitCommonDir}/BISECT_START`).then(() => '1', () => '0'),
  ]);
  return createHash('sha256')
    .update(`${statusOutput}|${mergeExists}${rebaseFile}${cherryExists}${revertExists}${bisectExists}`)
    .digest('hex');
}
```

- 签名不同 → 已有 `deriveChangeKind` 会产 `changeKind='worktree'` → renderer 收广播拉最新 status。
- 文件创建/删除都进签名 → 可靠触发。
- 计算成本：6 个 `fs.access` + 1 个 `fs.readFile` + 原 `execGit` = 并发下 ~5-15ms（本地 SSD），与现有单个 status 调用同数量级。

需改动 `CreateGitWatchServiceOptions.computeWorktreeSignature` 签名多传一个 `gitCommonDir`（首次 `watch(gitRoot)` 时 `getRepoInfo(gitRoot)` 取到并缓存到 `WatchEntry`）。

### IPC 契约

不新增 IPC channel。`window.pier.git.getStatus` 返回结构扩了字段（可选新字段，向后兼容），`git.watch` 广播事件保持 `GitChangeEvent { changeKind, gitRoot }` 不变。

### 单测

- `detectRepoState` fixture：手动布置 `.git/MERGE_HEAD` 等文件，断言 kind + counts / step。
- `getLineDelta`：`initial commit → modify → stage part` 三态断言。
- `detectUpstreamGone`：mock `for-each-ref` 输出含 `[gone]` / 不含。
- 签名扩展：mock `fs.access` 模拟 MERGE_HEAD 出现/消失，断言 sig 变化。

## 实时同步与竞态

现有链路：main watcher → 400ms trailing debounce → 签名比对 → `GIT_CHANGED` 广播 → renderer 每个订阅者独立 `getStatus`。7 个已知 bug，v7 UI 的信息密度会把它们放大——所以本 spec 与前述"字段扩展"是一体两面，必须一起改。

### 现存 bug

**Bug 1 · Renderer 竞态**（[git-status-item.tsx:79-88](../../../src/plugins/builtin/git/renderer/git-status-item.tsx)）

`watch` 快速触发 N 次 → N 个 `getStatus` 并发 → 若响应乱序，旧结果的 `setState` 覆盖新结果，UI 停留在过时状态。现有的 `cancelled` 只覆盖 unmount 场景，救不了 in-flight 竞态。

**Bug 2 · Debounce 饥饿**（[git-watch-service.ts:154-166](../../../src/main/services/git-watch-service.ts)）

纯 trailing 400ms + 每事件 `clearTimeout` 重排。AI 一次写 100+ 文件、跨 500ms+ 的持续 fs event → refresh 只在 burst 结束后 400ms 才跑；用户体验到 1-5s 的 stale 期。若 burst 里末尾 event 因 Bug 4 被丢，只剩 30s poll 兜底。

**Bug 3 · `.git/*_HEAD` 盲区**

`sha256(git status --porcelain=v2 -z)` 不含 `.git/MERGE_HEAD` / `rebase-merge/` 等标志文件。这些文件的出现/消失不改签名 → 广播不触发 → MERGING pill 不显。前述 [Backend 设计](#backend-设计) 的签名扩展修此项，此处只是关联提及。

**Bug 4 · fs.watch 掉事件**

Node `fs.watch` recursive on macOS 在 event rate 超阈值时开始丢事件（Node.js issue #12233 类问题，FSEvents 队列上限）。当前只有 30s poll 兜底。

**Bug 5 · 多 panel 重复 fetch**

每个 `useGitStatus` 独立订阅 + 独立 `getStatus`。3 panel × 1 broadcast → 3 次 spawn git status。既浪费也放大 Bug 1 的竞态窗口。

**Bug 6 · Broadcast 无 payload**（[git-watch.ts:88](../../../src/main/ipc/git-watch.ts)）

`GitChangeEvent = {changeKind, gitRoot}` 不带 status。main 端签名计算里读过的 porcelain 输出只用来算 hash，不下发；renderer 只能自己 refetch。

**Bug 7 · Watcher 崩溃不恢复**（[git-watch-service.ts:183-185](../../../src/main/services/git-watch-service.ts)）

`watcher.on("error")` 只 swallow。watcher 挂了不重建，剩 30s poll 硬撑。

### 修复设计

**Fix 1 · Seq 化 renderer 拉取**

新 `useGitStatus`：monotonic seq，只接受最新 seq 的响应；broadcast 若携带 status 走 fast path 免 refetch。

```ts
function useGitStatus(pluginContext, gitRoot) {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    if (!gitRoot) { setStatus(null); return; }
    let seq = 0;
    let alive = true;
    const apply = (next) => { if (alive) setStatus(next); };
    const refetch = () => {
      const mySeq = ++seq;
      pluginContext.git.getStatus(gitRoot)
        .then(next => { if (mySeq === seq) apply(next); })
        .catch(() => undefined);
    };
    refetch();
    const unsub = pluginContext.git.watch(gitRoot, (event) => {
      if (event.status) { ++seq; apply(event.status); }
      else refetch();
    });
    return () => { alive = false; unsub(); };
  }, [pluginContext, gitRoot]);
  return status;
}
```

**Fix 2 · Max-wait debounce**

`WatchEntry` 加 `firstEventAt: number | null`。`scheduleRefresh` 每次算 `delay = min(400ms, maxWait - elapsed)`。

- 单事件 / 抖动：仍 400ms trailing，不劣化
- 持续 burst：从首事件起最长 1500ms 一定 refresh；burst 结束后 400ms 再补一次

```ts
const DEFAULT_MAX_WAIT_MS = 1500;

function scheduleRefresh(gitRoot: string) {
  const entry = entries.get(gitRoot);
  if (!entry?.baselineReady) return;
  const now = Date.now();
  if (entry.firstEventAt === null) entry.firstEventAt = now;
  const elapsed = now - entry.firstEventAt;
  const delay = Math.max(0, Math.min(debounceMs, maxWaitMs - elapsed));
  if (entry.debounceTimer !== null) clearTimeout(entry.debounceTimer);
  entry.debounceTimer = setTimeout(() => {
    entry.firstEventAt = null;
    entry.debounceTimer = null;
    refresh(gitRoot, false).catch(() => undefined);
  }, delay);
}
```

`firstEventAt` 必须挂 `WatchEntry` 而不是模块全局——多个 gitRoot 各自独立 burst。

**Fix 3 · Broadcast 携带 status**

`GitChangeEvent` schema 加可选 `status`。`refresh()` 命中变化时一并算完整 `GitStatus`，随广播下发；多订阅者共享同一 snapshot。

```ts
export const gitChangeEventSchema = z.object({
  changeKind: gitChangeKindSchema,
  gitRoot: z.string(),
  status: gitStatusSchema.optional(),  // NEW
});

async function refresh(gitRoot, force) {
  const [nextWorktree, nextHead, freshStatus] = await Promise.all([
    computeWorktreeSignature(gitRoot, gitCommonDir),
    computeHeadSignature(gitRoot),
    computeFullStatus(gitRoot),  // NEW: 变化时一并算完整 status
  ]);
  // signature 比对不变...
  if (!changeKind) return;
  for (const listener of entry.listeners) {
    listener({ changeKind, gitRoot, status: freshStatus });
  }
}
```

- N 订阅者 × 1 broadcast → 1 次 spawn git status（vs 之前 N 次）
- Renderer fast path 免 refetch → 减 N-1 次 IPC 往返
- 首次订阅（无广播时）仍走 `getStatus` IPC 拉初值

**Fix 4 · Watcher 5s 冷却重建**

error/close → 5s 冷却窗内不重复重建；冷却期靠 poll 兜底。

```ts
let recreateCoolingUntil = 0;
function safeRecreateWatcher(entry: WatchEntry, gitRoot: string) {
  if (Date.now() < recreateCoolingUntil) return;
  recreateCoolingUntil = Date.now() + 5000;
  try { entry.watcher.close(); } catch { /* already dead */ }
  entry.watcher = fsWatch(gitRoot, {recursive: true});
  entry.watcher.on("change", () => scheduleRefresh(gitRoot));
  entry.watcher.on("error", () => safeRecreateWatcher(entry, gitRoot));
}
```

**Fix 5 · 轮询 30s → 5s**

`DEFAULT_POLL_MS = 5_000`。成本：每 5s 一次签名（6 fs.access + 1 execGit status），本地 SSD ~15-30ms → CPU 占用 <1%。对静默期 gitRoot 是可接受兜底。用户报电池问题再退回 15-30s adaptive。

**Fix 6 · 关联签名扩展**

前述 Backend 设计里 `.git/*_HEAD` 折进 signature 是 Bug 3 修复；与本节 Fix 2/5 一起构成特殊态可靠捕获。

### 决策与取舍

- **Payload broadcast vs main 端 cache**：payload 方式 IPC 契约小改（`status` 可选，向后兼容），renderer 逻辑简单；cache 需 invalidate + TTL 调优 + 每次 hit 判断。选 payload。
- **Max-wait 1500ms**：小于 5s poll 一个档；大于典型 AI burst（<1s）。既不饥饿也不打断合理 debounce。
- **Poll 30s → 5s 而不是迁 chokidar**：先做低成本修复实测 CPU/latency；若线上仍 miss 事件再迁 chokidar。不预防式换库。
- **不做跨 window IPC 聚合**：单 window 3 订阅 = 3 IPC 是可接受成本（fast path 就是内存传参）；跨 window 是另一个话题。
- **`GitStatus` 走 broadcast 的字节量**：v7 schema 下典型 30-100 files ≈ 3-10 KB JSON，Electron IPC handle 上限远大于此，可忽略。极端 5000+ files 场景（大型 monorepo 全 untracked）另议。

### 与 v7 UI 的关系

- AI burst：latency 上界从 30s（现状）→ 1.5s（maxWait）；一般场景 <400ms
- 快速 commit / 分支切换：`RepoStatePill` 不再显示过期状态
- Detached HEAD + 快速 checkout：不会短暂显示错误 sha
- 多 panel 同 gitRoot：同一 broadcast 携带同一 status snapshot，UI 各处一致

## Frontend 设计

### 组件拆分

拆 `WorktreeStatusItem` 单块 → 6 个 pure function 组件 + 1 个协调根：

```
<GitStatusItem>                          // renderer 侧 status item 注册的入口
  useGitStatus(gitRoot) → status         // 现有 hook 保留
  useRepoInfo(gitRoot) → repoInfo        // 新增，取 worktree.isWorktree
  
  <WorktreeBadge isWorktree name />      // 非主仓 + 有 name 才渲染
  <SdDivider />                          // 组间竖线，纯样式
  <BranchLabel branch upstreamGone />    // detached: <DetachedBadge sha />
  <RepoStatePill state />                // repoState.kind !== 'clean' 才渲染
  <SyncCounts ahead behind />            // 有一个>0 才渲染
  <SdDivider />
  <WorkingTreeCounts counts />           // staged/modified/untracked/conflict icon+num
  <LineDelta delta />                    // delta 非 null 才渲染
  <SdDivider />                          // 只在有 stash 时
  <StashBadge count />                   // count > 0 才渲染
  <LargeChangeWarning counts delta />    // 达阈值才渲染
</GitStatusItem>
```

每个子组件都 branch on props、独立可 truncate、独立可 hover。根组件不做数据整形，只 orchestrate 渲染顺序 + 优先级。

### 样式（shadcn + Tailwind）

Pill 用 CVA + `Badge` 变体：

```tsx
const pillVariants = cva(
  "inline-flex items-center gap-1 px-1.5 py-0 rounded text-[11px] leading-6 border",
  {
    variants: {
      variant: {
        progress: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800",
        danger:   "bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800",
        warning:  "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800",
        special:  "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950 dark:text-purple-300 dark:border-purple-800",
        neutral:  "bg-muted text-muted-foreground border-border",
      },
    },
  }
);
```

映射 `repoState.kind` → variant：
- `merging|rebasing|cherry-picking|reverting` + `conflictCount === 0` → `progress`
- 上述 + `conflictCount > 0` → `danger`
- `bisecting` → `special`
- （无 `success` 变体：v7 已确认"准备好提交"pill 冗余、"已合并"改 toast）

工作区 4 色（用 tailwind semantic tokens）：
- staged: `text-emerald-600 dark:text-emerald-400`（对 `text-success`）
- modified: `text-amber-600 dark:text-amber-400`
- untracked: `text-muted-foreground`
- conflict: `text-destructive`

图标沿用 lucide-react（现有 `GitBranch` 用的就是 lucide）：`GitCommit / Pencil / FilePlus / AlertTriangle / GitFork / GitMerge / GitPullRequest / Cherry / Undo2 / Binary / LinkOff / CloudOff / Archive`。

sd 竖线：`w-px h-3 bg-border mx-1`。

### 交互

用 shadcn primitives：

| 元素 | 组件 | 行为 |
|---|---|---|
| 分支名 | `<Popover>` + `<Command>` | branch quick-switcher（checkout / new / rename），reuse 现有 `openWorktreeListQuickPick` 风格 |
| RepoStatePill | `onClick` | `useWorkspaceStore().addPanel({ component: 'gitChanges', title })` 打开 changes panel |
| SyncCounts | `<DropdownMenu>` | Fetch / Pull / Push 三 item；因无 IPC wrapper，先全 disabled + tooltip "需要 fetch/push wrapper（另立 spec）" |
| WorkingTreeCounts icons | `onClick` per icon | 打开 changes panel 时 URL / props 带 `filter=staged\|modified\|untracked\|conflict` |
| LineDelta | `<Tooltip>` | Hover 显 top 5 变化文件（`git diff --stat -n5`） |
| StashBadge | `<Popover>` | stash 列表，逐项 apply / pop / drop |
| Detached / 无 upstream | `<Popover>` | 处理向导（checkout / set-upstream） |

hover 视觉：给可点元素加 `cursor-pointer` + `hover:underline decoration-current underline-offset-2`（v5 review 结论：无 layout shift，色盲友好）。

### 大规模变更预警

客户端 heuristic：

```ts
function isLargeChange(counts: GitCounts, delta: GitDelta | null): boolean {
  const totalFiles = counts.staged + counts.modified + counts.untracked;
  if (totalFiles > 100) return true;
  if (delta && (delta.insertions + delta.deletions) > 2000) return true;
  return false;
}
```

阈值 v1 硬编码（100 files / 2000 lines）；未来若需要走 preferences 见 Phase C。

`<LargeChangeWarning />` 达阈值时渲染 red pill `<AlertTriangle /> 变更过大`，点击开 changes panel。

### "已合并" toast

- 挂在 renderer `git.commit` IPC 成功回调（`src/plugins/builtin/git/renderer/` 内某个 hook 或 action）。
- Commit 发起前 snapshot 当前 `repoState.kind`；成功后如 pre 是 `'merging'` → shadcn `<Toast>` `已合并 ← ${MERGE_HEAD 追溯到的分支名}`。
- MERGE_HEAD 追溯：commit 成功前读一次 `.git/MERGE_MSG` 或 `git log MERGE_HEAD --oneline -1` 拿被合并方名。
- 无 pre-commit 场景（用户手动 terminal 里 commit）不会触发—— **这个限制符合业界**（VSCode / JetBrains 同款：只在自家 UI 里触发的操作才有 toast）。

## 关键决策与取舍

- **签名扩展 vs chokidar**：签名扩展在计算成本可控（并发 fs.access ~5-15ms）且不引第三方依赖的前提下能解决盲区。chokidar 是独立性能决策——若真跑起来看到 status 广播卡顿或 CPU 高再迁移，不预防式做。

- **`repoState` 用 tagged union 而不是 flat fields**：让 renderer `switch (state.kind)` 强制处理所有分支（TypeScript exhaustive check）；避免 `rebaseCurrentStep` 类字段在 non-rebasing 时为 `null` 的三态判断。

- **`stashCount` 用 `rev-list --walk-reflogs` 而不是 `stash list`**：不 fork bash / 无输出解析，同一命令返回数字，快 3-5×。

- **`upstreamGone` 用 `for-each-ref` 而不是 `git branch -vv`**：只跑当前分支不解析全表，大仓库（几百分支）快 10×。

- **组件拆散而非 label 拼串**：现在的字符串拼接对新增元素严重不友好；拆散后每个组件独立可 hover、独立可 truncate、独立可 disable。

- **不做 fetch/push/pull wrapper**：Pier 本就是 AI 工作台，用户跑 sync 都在 terminal 里；加 wrapper 需要 credential handling / progress / cancel / SSH agent 等一系列基础设施，是独立 feature。本 spec 状态栏与业界惯例一致（无 wrapper → 不显进度）。

- **不做 hook / submodule / LFS pill**：业界（VSCode / JetBrains / GitHub Desktop / magit / lazygit）**均不放常驻位**。如果 Pier 未来做 commit UI，pre-commit hook 属于 commit dialog 范畴；submodule / LFS 属于 changes panel 树。

- **"已合并"改 toast 而非 pill**：业界无对标（无产品做常驻反馈），JetBrains 用 bottom-right 通知；改用 shadcn `Toast` 一次性反馈，状态栏空间给更高频信息。

- **大规模变更阈值硬编码 v1**：默认 100 / 2000 覆盖 90% 场景；先落 default，用户抱怨或有明确诉求再走 preferences。避免过度设计。

- **v7 UI 稿术语沿用**：staged / modified / untracked / conflict 用英文（与 git status 一致），中文出现在 label / tooltip；避免"暂存 / 已改 / 未跟踪"这类翻译歧义。

## 风险与影响面

- **`fs.access(.git/*_HEAD)` 并发下的 fs 压力**：单次 6 个 access + 1 个 readFile，local SSD 下测试 < 15ms；如线上大仓库慢，缓存 gitCommonDir 拼接串复用。
- **`.git/rebase-merge/msgnum` 读文件竞态**：rebase 进行中该文件会被 git 改写，读到部分内容可能 parse 失败。视为 rebasing but step 未知（`current: 0, total: 0`）不 throw，UI 显 `REBASING`（无步进）。
- **签名 6 个 fs.access 里任一 rejection 返回 '0' 而不是 throw**：确保签名总能算出来；不至于因单个文件系统临时错误让整个 watch 停摆。
- **旧 renderer 代码引用 `status.files.length`**：新 `status.counts` 字段引入前，`WorktreeStatusItem` 现有的 `${status.files.length}` 继续可算。Phase A 转到 `counts` 时逐点迁移。
- **`GitStatus` schema 加字段引起序列化字节增加**：counts / delta / repoState / stashCount 加起来 ~50 字节 JSON，广播频率 400ms debounce 后可忽略。
- **`repoState.kind` 未来加成员时的兼容**：discriminated union，renderer 里 `switch` 加 default → 显 fallback pill；无缝加新态。
- **Phase B 交互层依赖 changes panel**：目前 changes panel 是空占位（`git-changes-panel.tsx:10-23`），点击后落地页面还需要另一 spec 落。Phase B tooltip 里说明"面板功能建设中"。
- **架构边界**：`git-status-item.tsx` 属 `src/plugins/builtin/git/renderer/`，插件 renderer 边界不 import renderer 业务代码（走 `RendererPluginContext` 或 shared）。CVA / lucide 是外部依赖，OK。dockview 类型不 import。

## 验证方式

- `pnpm typecheck` / `pnpm lint` / `pnpm check`（含 depcruise + file-size）。
- 因动 shared contracts + 插件 catalog，额外跑 `pnpm test` 兜底（参照 [pier-check-skips-vitest](../../.claude/projects/-Users-xyz-ABC-pier/memory/pier-check-skips-vitest.md)）。
- Backend 单测：`detectRepoState` × 5 fixture、`getLineDelta` × 3 case、`getStashCount` × 2 case、`detectUpstreamGone` × 2 case、`defaultWorktreeSignature` 扩展 × 3 case。
- `pnpm dev` 手动：
  - `git merge --no-ff feature-x` → 状态栏 `MERGING` + staged count 出；resolve → `MERGING · N 冲突`；conflict fix + stage → `MERGING`（无冲突）；commit → toast "已合并"，pill 消失。
  - `git rebase -i HEAD~3` → 每步 `REBASING M/N`；`edit` 停下时 pill 保持；`--continue` → 步进递增。
  - `git bisect start && bisect bad HEAD && bisect good HEAD~5` → `BISECT · g0·b1`；每 bisect good/bad 后计数更新。
  - `git worktree add ../foo main` → 新 worktree 里 status 栏显 worktree 名。
  - 制造 100+ untracked 文件 → 出"变更过大"红 pill。
- Playwright E2E（新增）：`e2e/git-status-bar.spec.ts` 模拟 merge conflict → 断言 pill 出现 + 冲突数正确 + toast 触发。
- **实时同步压力测试**：
  - 3 个 terminal panel 挂同 gitRoot；`for i in {1..200}; do touch x_$i.tmp; done` → 状态栏 latency ≤ 1.5s，无中间旧态闪现，CPU ≤ 5%
  - `git rebase -i HEAD~5` 快速多次 continue/edit → `REBASING M/N` pill 步进跟随 <500ms
  - Kill watcher fd（process signal）→ 5s poll 内自动恢复，`git touch` 触发新 refresh

## 分期落地

按 3 期上，每期独立可 review、可回滚。

### Phase A：Backend schema + detection + 静态渲染（本 spec 目标 · 1 PR）

- `src/shared/contracts/git.ts` 加字段（`counts / delta / repoState / stashCount / upstreamGone`）。
- `src/main/services/git-exec.ts` 加 `detectRepoState / getLineDelta / getStashCount / detectUpstreamGone`。
- `src/main/services/git-watch-service.ts` 扩 `defaultWorktreeSignature`。
- `src/main/services/git-service.ts`（获取 status 的地方）汇总新字段。
- `git-status-item.tsx` 拆 6 个组件 + 渲染 v7 稿视觉（**只静态显示，无交互**）；`useGitStatus` seq 化 + 走 broadcast payload fast path。
- **实时同步修复**：`GitChangeEvent` schema 加可选 `status`；`refresh()` 变化路径一并算完整 status 随广播下发；`WatchEntry` 加 `firstEventAt` + max-wait 1500ms debounce；`DEFAULT_POLL_MS` 30s → 5s；`watcher.on("error")` 走 5s 冷却重建。
- 单测 + 手动跑 5 种 repoState + 3 panel × 200 文件 burst 压测。

### Phase B：交互层（1 PR）

- Popover / DropdownMenu / Tooltip / Toast 挂上。
- Fetch/Pull/Push 三 item disabled + tooltip 说明。
- 点击 pill / 图标 → 开 changes panel（依赖 changes panel spec 二期落）。
- "已合并" toast 挂在 `git.commit` 成功回调。

### Phase C：Pier 差异化 & 后续（分多 PR）

- 大规模变更阈值走 preferences（`workspace.store` 加两个 setting）。
- Detached / 无 upstream 处理向导（Popover 里的 quick actions）。
- upstream gone → 弹通知问是否 delete local branch。
- Playwright E2E 覆盖增补。

## 后续（不在本 spec）

- **Fetch/push/pull IPC wrapper**：独立 feature spec，含 credential handling / SSH agent / cancel / progress event stream。
- **git-changes panel 内容**：属 [2026-06-30-git-plugin-consolidation-design.md](2026-06-30-git-plugin-consolidation-design.md) 二期。
- **多 agent 触碰同文件冲突预警**：属 agent management 域（[pier-agent-management](../../.claude/projects/-Users-xyz-ABC-pier/memory/pier-agent-management.md)），非 git 域。
- **chokidar 迁移**：视 Phase A 上线后 signature 计算的实测性能定；无实测数据前不预防式做。
- **视频 / 二进制 diff 阈值**：`+N/-N` 对 binary 记 0，未来可加"binary 文件数"字段。

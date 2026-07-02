# Git 状态及时同步 + 合并状态设计

2026-07-02。承接 2026-07-01 状态栏 v2（#43）。

## 背景与问题

状态栏 v2 的广播管道（fs.watch + 5s poll → 3 签名比对 → 携快照广播）对三类状态存在系统性滞后：

1. **纯 ref 操作不触发广播**。三个签名（worktreeSig / headSig / repoStateSig）都不覆盖
   remote-tracking refs、upstream 配置和 refs/stash。外部终端里 `git fetch` / `git push` /
   `git fetch --prune` 之后，ahead/behind 和 upstreamGone 停留在旧值，直到下一次无关变化"搭车"刷新。
2. **upstream gone 依赖网络**。不发起 fetch，git 本地永远不知道远端分支已删。GitHub 合并 PR
   后自动删分支是 Pier 多 worktree 工作流的日常，用户希望状态栏及时反映"这个 worktree 可以清理了"。
3. **行增删 +N/-N 滞后**。worktreeSig 只 hash porcelain v2 输出，其中不含工作区内容 oid——
   已修改文件继续编辑时 porcelain 输出不变 → 签名不变 → 不广播，+N/-N 停在旧值。
4. **没有"已合入主干"状态**。

## 目标与非目标

目标：

- 本地任何 git 操作（含纯 ref 操作）后，状态栏 ≤5s 刷新（主 worktree fs 事件路径 0.4–1.5s）。
- 自动感知远端分支删除（可配置的后台 fetch --prune）。
- 分支已合入默认分支时展示"已合并"胶囊。
- **数据流保持单向唯一**：状态唯一来源 `getStatus`，唯一推送通道 watch 广播。任何新机制
  （autofetch 等）只能通过"改动仓库 → 签名变化"进入管道，禁止直接向 renderer 发状态。

非目标：

- squash merge 的精确检测（`git cherry` patch-id 在大仓库太贵；GitHub API 引入外部依赖）。
  v1 靠"远端已删 + 工作区 clean + autofetch 及时性"的组合信号覆盖日常 squash 场景。
- fetch 失败的 UI 提示（toast/状态图标）。v1 只记日志。
- 按仓库粒度的 autofetch 开关。v1 全局 preference。

## 设计

### 1. 签名补全（git-watch-service）

3 签名扩为 4 签名，管道结构不动：

- **新增 `refsSig`**：
  `git for-each-ref --format='%(refname)%00%(objectname)%00%(upstream)%00%(symref)' refs/heads refs/remotes refs/stash`
  （`%(upstream:track)` 同步时为空串抓不到 set-upstream，`%(upstream)` 直接携带配置；gone 场景由
  remote-tracking ref 删除本身覆盖；`%(symref)` 捕捉 `refs/remotes/*/HEAD` 符号指向变化，
  如 `remote set-head` 改默认分支时 oid 不变但 symref target 变）输出取 sha256。覆盖
  fetch / push / prune / stash ref 操作、分支增删、upstream 配置变化、默认分支符号指向变化。
- **增强 `worktreeSig`**：hash 输入从 porcelain v2 输出扩为
  `porcelain v2 + diff --numstat -z --no-renames + diff --cached --numstat -z --no-renames`
  三段拼接。修复 +N/-N 滞后；与 getStatus 里 getLineDelta 的数据源一致。
- **`GitChangeKind` 增加 `"refs"`**：`deriveChangeKind` 从二元布尔改为类别集合，命中 ≥2 类
  归 `"both"`。实施时逐一核对 changeKind 消费者（useGitStatus 本身 kind 无关）。

成本：每次 refresh 多 1 个 git 进程（for-each-ref），worktreeSig 多 2 个 numstat 进程；
均在既有 debounce（400ms/1.5s max-wait）节流之内。worktreeSig 采到的 status(--branch) +
两段 numstat 原始输出会随本轮缓存，getStatus 复用后跳过自身的 status 与两条 numstat spawn，
一次变化的重复 spawn 从 3 条降为 0 条。

poll 门控与聚焦补课：5s 兜底 poll 仅在应用窗口聚焦时执行（后台不做无谓轮询）；
fs 事件与 pulse 不受门控影响。窗口重新聚焦瞬间对所有活跃仓库各 pulse 一次，全量重算签名，
弥补后台错过的 poll——仍走同一 watch 广播管道。

每 root refresh 串行化：同一 gitRoot 同时只有一轮 refresh 在跑；执行期间到来的
pulse/poll/debounce 触发合并为一轮 trailing refresh，消除并发导致的乱序广播。

### 2. git-autofetch-service（main 新服务）

职责单一：定期对活跃仓库执行 `git fetch --prune`，**不产出、不推送任何状态数据**。

```
autofetch ──(只写 git refs)──→ 仓库 ──→ refsSig 变化 ──→ 既有 watch 广播 ──→ renderer
```

- **活跃仓库来源**：watch service 的 entries（有订阅者的 gitRoot），不另建注册表。
  watch service 暴露只读的 `activeRoots(): string[]`。
- **common dir 去重**：fetch 前解析 `git rev-parse --git-common-dir`，同一主仓的多个
  worktree 每周期只 fetch 一次（复用/参照 gitDirCache 的缓存策略）。
- **节奏**：默认开启；间隔 5 分钟；仅应用窗口聚焦时执行；重新聚焦且距上次成功 fetch
  超过间隔时立即补一次。
- **护栏**：
  - 禁止一切凭据交互：`GIT_TERMINAL_PROMPT=0`（HTTP）+ `GIT_SSH_COMMAND="ssh -oBatchMode=yes"`
    （SSH，passphrase/known_hosts 询问直接失败而不是挂起）；
  - 单次超时 30s，超时杀进程；
  - 每仓库串行（上一次未结束不叠加）；
  - 连续失败指数退避（5min → 10min → 20min，上限 40min）；鉴权类失败（exit code +
    stderr 判别）该 common dir 本会话内停用，仅 console 记日志。
- **收尾提速**：fetch 成功后对该 common dir 下**所有**活跃 gitRoot 逐一调用 watch service
  新暴露的窄接口 `pulse(gitRoot)`（内部即 `refresh(gitRoot, false)`），立即重算签名走既有
  广播，免等 5s poll。仍是同一管道；共享 refs 的多个 worktree 都会刷新。
- **preferences**：userData JSON 层新增 `git.autoFetch.enabled: boolean`（默认 true）、
  `git.autoFetch.intervalMinutes: number`（默认 5，下限 1）。设置 UI 归 Phase C 偏好页。

### 3. "已合并"状态

- **contracts**：`GitBranchInfo` 增加 `mergedIntoDefault: boolean | null`（zod 同步）。
  `null` = 不适用（无远端默认分支 / 当前就在默认分支 / detached）。
- **检测**（git-service.getStatus wave 2）：
  1. 默认分支解析：`git for-each-ref --format=%(refname)%00%(symref) refs/remotes/*/HEAD`
     枚举各远端的 HEAD 符号指向，取 symref 非空者，多远端时 **origin 优先**否则取第一条，
     返回完整 remote-tracking ref（如 `refs/remotes/upstream/main`）。按 common dir 缓存，
     TTL 5 分钟；解析为 null 时不缓存（新建 origin/HEAD 后可立即生效）。远端名不硬编码 origin；
  2. `git merge-base --is-ancestor HEAD <default 的 remote-tracking ref>` → exit 0 为 true；
  3. 当前分支即默认分支或解析失败 → null。
- **UI**（git-status-parts）：`mergedIntoDefault === true` 时分支名后显示 success 色胶囊
  "已合并"（Check 图标 + 文字；locale key `ui.mergedIntoDefault`，en "merged"）。与
  upstream gone 胶囊可同时出现（gone 在前，merged 在后），此组合即"PR 已合并、远端已删、
  worktree 可清理"的完整信号。
- Pill 组件补 `success` variant（`border-status-success-* / bg-* / fg-*`，与现有
  danger/progress/neutral 同表驱动）。

### 4. 数据流一致性约束（长期有效）

- 状态唯一来源：`git-service.getStatus`；唯一推送通道：git-watch-service 广播（携快照）。
- autofetch 与未来任何 git 写路径（branch 操作、stash 操作等已有先例）一律通过
  "仓库变化 → 签名比对"进入管道；**禁止**新增 main → renderer 的旁路状态推送。
- 进程/分层边界不变：autofetch 位于 main/services，依赖 git-exec 与 watch service 的窄接口，
  不触 L1 持久化（preferences 读取走既有 preferences service）。

## 测试

- **签名触发矩阵**（git-watch-service 单测，真实临时仓库或注入 fake 签名函数）：
  fetch / push（模拟为 update-ref）/ prune（delete remote-tracking ref）/ stash /
  已修改文件再编辑 × 4 签名，各自触发且只触发预期 changeKind。
- **autofetch 单测**（fake timer + 注入 execGit）：间隔调度、聚焦门控、common dir 去重、
  串行、退避、鉴权失败停用；断言它从不直接调用广播/IPC（只调 pulse）。
- **merged 检测**：真实临时仓库 fixture——merge 合入 → true；squash 合入 → false（记录
  为已知限制）；无远端 → null；在默认分支上 → null。
- **renderer**：merged 胶囊渲染/不渲染、与 gone 胶囊共存（沿用 2026-07-02 gone 胶囊
  测试模式）。

## 决策与取舍

- autofetch 默认开启：Pier 是个人本地工作台，及时性是用户明确诉求；护栏（禁交互、退避、
  聚焦门控）把副作用压到可接受。与 VS Code 默认关闭的取舍不同点在于目标用户和凭据环境可控。
- `--prune` 直接挂在 fetch 上而不是单独 `remote prune`：一个进程完成，且 prune 结果
  （删 remote-tracking ref）恰好由 refsSig 捕获。
- 不用 `git ls-remote` 方案：零副作用但只能判"分支存不存在"，不更新 ahead/behind，
  且同样有网络成本；fetch --prune 一次解决两类数据。
- worktreeSig 拼 numstat 而不是引入 mtime/内容 hash：与 UI 展示的数据源（getLineDelta）
  完全一致，语义上"UI 显示什么就对什么做签名"。

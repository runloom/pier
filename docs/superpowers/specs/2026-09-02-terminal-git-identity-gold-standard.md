# 终端面板 git 身份金标准

日期：2026-09-02
状态：现行权威
范围：终端 OSC 7 cwd → `PanelContext` 的 git 身份生命周期；状态栏 git 芯片的可见性门控。
不包含：git 状态/refs 刷新（`GitWatchService`）；Files 项目芯片；tab 标题 OSC 0/2。

背景缺陷：shell 每个提示符重发同一 OSC 7。为避免底栏闪烁，转发层按「cwd 未变」跳过解析。第一次解析若没有 `gitRoot`（目录当时还不是仓库、restore 缺字段、瞬时 probe 失败），之后 `git init` 即使写出 `.git`，芯片也永远不出现。补洞若用 cwd 下 `stat(.git)` + 魔法节流，会变成第二套身份判定，子目录仓库与 resolver 的 `rev-parse --show-toplevel` 不一致。

## 一句话终态

cwd 变了就解析；cwd 没变则只在 git 身份失效时再解析；解析只走 `resolvePanelContextForPath`；广播只在身份摘要变化时发出；git 芯片只认 `gitRoot`。`.git` 的创建/删除是失效信号，不是身份。

## 身份真源

| 事实 | 所有者 | 禁止 |
|---|---|---|
| 是不是 git 仓库 | `PanelContext.gitRoot`，只由 `resolvePanelContextForPath`（`git rev-parse --show-toplevel`）写入 | cwd 下 `stat(.git)`、祖先手写 walk、`worktreeRoot` 充当「有仓库」 |
| 独立工作树徽章 | `gitRoot` 与 `worktreeRoot` 都在且不相等 | 用 `worktreeRoot` 单独点亮分支/变更/同步芯片 |
| 分支名/脏状态 | git status 订阅（已有 `GitWatchService`） | 为了刷新分支而每个提示符重跑 panel context |

`worktreeRoot` 不是 git 身份。resolver 在普通仓会把它写成与 `gitRoot` 相同；芯片不得靠它兜底。

## 决策树

1. **cwd 变了** → 调用 `resolvePanelContextForPath(cwd, { source: "panel" })`。
2. **cwd 没变且本会话已解析过且未失效** → 不解析、不广播（避免每个 Enter 闪底栏）。
3. **cwd 没变但身份已失效**（发现监视看到 `.git` 创建/删除）→ 再解析。
4. 解析完成后比较身份摘要；**摘要未变**（允许 `updatedAt` / `contextId` 不同）→ 不广播、不写 session。
5. 摘要变了 → 记录、更新 terminal panel context、广播 `TERMINAL_CWD_CHANGED`；**成功发出之后**才把该摘要标为已结算。写 session / 广播失败必须留下 dirty / needs-emit，后续 OSC 7 不得因 peek 已是新摘要而静默结算。

本会话「已解析」以转发层 **成功发出的 digest** 为准，不是磁盘 restore。restore 出来只有 cwd、没有 `gitRoot` 时，第一次 OSC 7 必须解析。restore 已带相同身份摘要时可静默结算，避免再闪一次底栏。

## 身份摘要

单一实现：`panelGitIdentityDigest`。字段只有：

`cwd` · `gitRoot` · `worktreeRoot` · `branch` · `head`

禁止把 `updatedAt`、`contextId`、`projectRootPath`、`source` 算进「是否闪底栏」。同 cwd 再解析若只是时钟前进，必须静默。

## 发现监视（失效，不是身份）

目的：目录**变成**或**不再是**仓库时，不必等下一次提示符。

- 监视器是 `fs.watch` 非递归，只认直接子项名 `.git`（含 `.git/...` 前缀；**排除** `.github`）。
- 命中后立刻把该终端 scope **标失效**（`onDirty`），再去抖调用 resolver（`onInvalidate`）。去抖只合并 resolver，**不得**挡住 OSC 7 看见 dirty 位。
- `filename == null`（部分平台目录事件不带名字）视为失效；`.github` 仍排除。失效仍只触发 resolver，不自填 `gitRoot`。
- 目录集合（`gitIdentityWatchDirectories`）：
  - **永远**监视当前 `cwd`（覆盖「就在这里 `git init` / `rm -rf .git`」以及已有父仓时在子目录再 `git init`）。
  - **没有 `gitRoot`** 时沿祖先向上监视，直到家目录（不含）或文件系统根（不含），覆盖「人在子目录、父目录后来才 `git init`」。
  - **有 `gitRoot`** 时额外监视 `gitRoot`（覆盖工作树根上的 `.git` 文件/目录被删）。
- 同一目录多终端共享一个 watcher（引用计数）。面板关闭 / reconcile 释放。
- 事件可合并：`GIT_IDENTITY_DISCOVERY_DEBOUNCE_MS`（100ms）只是 resolver burst 合并，**不是**身份 TTL。`sync()` 在监视目录未变时**不得**清掉已排队的 refresh timer；每个提示符的 OSC 7 `sync` 不得把「`.git` 刚出现」吞掉。
- `fs.watch` 必须监听 `'error'`（关 watcher 并标失效）；`watch()` 同步失败打日志并标 dirty，不假装已经在监视。下一次 `sync` 会再尝试挂上 watcher。
- 已有 `.git` 但 resolver 仍给不出 `gitRoot`（git 不在 PATH 等）：视为已结算的非 git，直到 `.git` **再次**出现 fs 事件或 cwd 变化。禁止为这种情况写第二套 `stat` 重试钟。
- 跨窗转移：源窗 `acknowledgeSourceClose` **必须** `releaseTerminalCwdForwarding`。lease retain 不得让源窗继续替已搬走的 panel 监视 `.git`。
- relaunch（同 panel 换 pty）**不**释放身份：监视与 last-emitted 跟着 panel 走，等新 pty 的 OSC 7。

禁止：

1. 每个提示符 `stat(join(cwd, ".git"))` 当身份。
2. 魔法间隔（2s 节流）决定要不要 `rev-parse`。
3. 发现监视自己填 `gitRoot`。
4. 只等 OSC 7 才升级（`git init` 后不按回车也必须能亮芯片）。
5. 已有 `gitRoot` 时因为 `.git` 仍在就永远不降级。
6. `sync()` 清掉未完成的 `.git` 去抖、或等 OSC 7 才把 dirty 位立起来。

## 状态栏芯片

`pier.worktree.status` / `pier.git.status.changes` / `pier.git.status.sync` 的 `isVisible` 与渲染门控：`Boolean(panelContext.gitRoot)`。

干净工作区仍显示分支芯片；变更/同步芯片在无 ahead/behind/脏文件时整项隐藏（既有产品行为，本文不改）。

## 并发

同 scope 进行中的解析用代际号：只应用**最后一次启动**的结果。过期解析不得把已经升级的 `gitRoot` 写回去。`forgetScope`（关闭 / 转移源 / reconcile 丢掉）必须 **bump 代际并标死**，不得删掉代际让旧 `rev-parse` 用 generation 1 写进新会话。invalidate 读 scope 上最新的 `{ cwd, window, panelId }`，禁止闭包钉死某一次 handle 的栈变量。retain/GC 扫描全部 live scope（含尚无 emitted digest 的 in-flight），不是只扫已经广播过的 key。

## 检查点

- `tests/unit/main/terminal/cwd-identity/governance.test.ts`
- `tests/unit/main/terminal/cwd-forwarding.test.ts`
- `tests/unit/main/git/identity-discovery.test.ts`
- `tests/unit/main/panel/context-identity.test.ts`
- `tests/unit/renderer/git/status-item-config.test.tsx`
- `tests/unit/renderer/git/plugin.test.tsx`

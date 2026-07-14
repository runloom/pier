# T4 文件审阅文档验收记录

**验证日期：** 2026-07-15

**对应计划：** [Git 差异审阅能力完善实施计划](../plans/2026-07-14-git-diff-review-polish.md)
**范围：** T4 只实现 main 内的 patch-first 文件文档、路径围栏、调度复用和固定提交缓存；IPC、权限、完整文本补全和写动作仍分别属于 T5/T6。

## 所有权划分

- `GitReviewService` 负责一次 document 请求的入口预算、规范化、调度、重试、条件返回和固定提交缓存编排。
- `GitReviewIndexReader.resolve()` 负责同一 revision 下的公共索引与 main-only group 路径事实；document 不从公共 `oldPaths` 顺序反推范围。
- `git-review-document-patch.ts` 负责固定 Git 范围、单文件 pathspec、untracked 临时 index/ODB 和正文命令。
- `git-review-document-envelope.ts` 负责 raw envelope 协议、按索引事实选择唯一文件、Buffer 级内容分类、renderer 准入和 hunk 统计。
- `git-review-path-guard.ts` 负责仓库内路径、符号链接、普通文件、同一 fd 读取和流式摘要围栏；`git-review-path-operation.ts` 独占 signal 竞态、迟到 open 句柄回收和后台 close 结算。
- T2 调度器负责 operationId、owner lease、并发、in-flight 合并、取消、聚合预算和终态观测；document 服务不自建第二套并发状态机。
- shared 只持请求、结果、section、revision 和稳定失败原因，不接触文件系统、Git 进程或缓存。

## 完整控制路径

```text
getFileDocument(request)
  → shared schema 校验
  → 创建一次公开请求唯一 GitReviewBudget（15 秒 / 64 MiB / 2,000 文件）
  → raceGitReviewIdentityBoundary(realpath gitRoot, budget, caller signal)
  → 生成 canonical source + contentRequirement(full | conditional)
  → T2 scheduler.schedule(document key, operationId, owner lease)
      → 调度执行函数内真实查询 commit LRU
          ├─ hit → full document 或 notModified
          └─ miss
              → index resolve（before revision）
              → source.path 定位 main-only resolved group facts
              → 按 unstaged → staged → conflict/commit/branch 顺序构建 section
              → index resolve（after revision）
              → revision 一致才发布；否则最多重试 2 次
              → commit 成功结果写入 32 MiB 加权 LRU
              → ifRevision 命中时只返回 notModified
  → 终态观测记录调度执行函数的真实 cacheHit
  → scheduler 释放 lease、预算和活动 operationId
```

`full` 与 `conditional` 是不同调度 key，不会把需要正文的请求合并成 `notModified`。相同 key 的 100 个并发 full 请求共享同一个底层 document；每个调用仍有独立 operationId、owner 和预算 lease。

## 正文命令 DAG

### tracked

```text
resolved group fact(oldPath, targetPath, status)
  → unstaged 且目标仍存在：同一 fd 流式 fingerprint（before）
  → 单条固定范围 Git 命令
      unstaged: index → worktree
      staged: fixed HEAD/unborn → index
      commit: first parent/empty tree → fixed commit OID
      branch: fixed merge-base → request-start HEAD OID
  → 固定机器参数：
      --literal-pathspecs
      --no-ext-diff --no-textconv --no-color --unified=20
      --ignore-submodules=none --find-renames=50% --find-copies=50% -l2000
      --binary --full-index --no-abbrev --patch-with-raw -z
      -- <oldPath?> <targetPath>
  → raw envelope 按 oldPath/targetPath/status 选择唯一目标 patch
  → unstaged：同一 fd 流式 fingerprint（after）
  → staged target blob OID 必须等于 unstaged source blob OID
```

所有正文命令显式把 `GIT_DIFF_OPTS` 置空，`--unified=20` 与 section 的 `contextLines` 使用同一常量，用户环境和 Git 配置不能改变文档语义。copy 源文件在同一范围也有修改时，Git 可以合法返回“copy + source modification”两个 envelope；解析层按索引中的 movement、oldPath 和 targetPath 只选择 copy 条目，不把额外源文件 patch 误报成多文件协议错误。

### untracked

```text
受保护的同一 fd snapshot(bytes + digest + executable mode)
  → main 创建 0700 临时根
  → 独立 GIT_OBJECT_DIRECTORY + GIT_INDEX_FILE
  → 真实 common ODB 只作为 alternate
  → hash-object -w --stdin（空 tree + 文件 blob，写入临时 ODB）
  → update-index -z --index-info（100644 / 100755 + literal path）
  → diff --cached emptyTree → temporary index
  → strict raw/patch envelope
  → 同一目标的流式 fingerprint（after）
  → finally 删除临时根
```

成功、Git 失败和取消都会清理临时 index/ODB；清理错误不会覆盖原始执行错误。真实 index、真实 object 数量和 worktree 均有真实仓库回归证明不变。

## 路径与竞态围栏

```text
canonical root
  → path.relative 词法包含
  → root 到 parent 每一级 lstat + realpath + dev/ino/ctimeNs token
  → macOS open(O_NOFOLLOW_ANY | O_NONBLOCK)
     其它平台 open(O_NOFOLLOW | O_NONBLOCK)
  → fstat：只接受 regular file，读取前检查 8 MiB 上限
  → 同一 fd 读取/64 KiB 分块 SHA-256
  → 同一 fd 再 fstat
  → 全部祖先重新 lstat + realpath + token 比对
```

macOS 的 `O_NOFOLLOW_ANY=0x20000000` 与系统 SDK 一致，在内核打开路径时拒绝任意层级符号链接；测试真实模拟了打开瞬间把祖先替换为外部 symlink，结果只能是 `changed/symlink`，不能返回外部正文。FIFO 使用 `O_NONBLOCK` 后由 `fstat` 拒绝，socket/device/目录同样不会进入正文读取。调用方 signal 覆盖 realpath、lstat、open、流式读取、fstat 和祖先复核；无法由 Node 直接取消的 open 若在终态后返回，其句柄会立即后台关闭，不再占用 scheduler permit。

Git 的机器路径只把 `/` 当分隔符。POSIX 上的 `\\notes.txt`、`dir\\..\\file` 中反斜杠按文件名字面字符处理，不会被误判成绝对路径或父级穿越；主进程仍以索引精确命中、平台路径包含检查和打开期防符号链接保护实际读取。

## 内容与内存围栏

- 传输层单 section 最多收集 8 MiB patch 加 64 KiB 诊断尾部。
- raw Buffer 先完成 SHA-256、UTF-8 合法性、行数、单行长度、binary 协议行和 768 KiB renderer admission；只有准入后才生成 UTF-16 字符串。
- binary 只识别完整协议行 `GIT binary patch` 或同一行 `Binary files ... differ`，源码中的同名字样不会误判。
- renderer section 最多 768 KiB、20,000 行、单行 64 KiB；越界返回 `tooLarge`，不截断 patch。
- tracked 前后围栏和 untracked 后置围栏只保留 64 KiB 分块与摘要；只有 untracked 首次读取保留写入临时 blob 所必需的正文。
- hunk 进入 `@@` 后按行首 `+/-` 计数；真实 `--old` → `++new` 回归为 1 增 1 删，不把源码误当 `+++`/`---` 文件头。

## 缓存、取消与观测

- 只有完整 OID 的 commit source 写入 32 MiB 加权 LRU；uncommitted 和 branch settled 后不缓存。
- 缓存查询位于 scheduler 调度执行函数内，缓存命中同样遵守重复 operationId、owner 释放、截止时间、取消和预算释放。
- `cacheHit` 随共享 job 的真实 lookup 结果进入终态观测，不在排队前猜测。测试覆盖排队期间 miss→hit 与 hit→evict，终态值分别为 `true/false`，底层 patch 次数分别为 `0/1`。
- caller signal 与预算同时覆盖 canonicalize、排队、Git 执行和受保护文件读取；永不完成的 canonicalizer 或卡住的文件 open 都能及时释放请求等待。
- document 的 before/after 两次索引探测各有 2,000 文件局部门，同时把已接受文件计入同一个请求预算；不再用私有计数器绕过共享 late-lease 计费。
- `GitReviewDocumentStaleError` 只表示索引、路径、文件或 blob 围栏变化，并最多执行初始尝试加 2 次重试；raw 语法、多文件、非法 OID 和内部不变量属于不可重试协议/内部错误。

## 需求到证据

| 要求 | 实现证据 | 测试证据 |
| --- | --- | --- |
| group 路径不猜测 | `GitReviewIndexResolution.resolvedEntries` | 真实 `a→b→c` 的 staged `a→b`、unstaged `b→c` |
| 固定、可复现 patch | 固定 OID/index/worktree 范围和机器参数 | root commit、branch、`GIT_DIFF_OPTS=--unified=0`、特殊 pathspec |
| 单文件协议 | strict raw score/OID/path/status + 按事实唯一选择 | multi raw、错误路径、第二个 `diff --git`、rename 精确匹配、copy 源同时修改 |
| 类型化状态 | binary、invalidEncoding、submodule、symlink、tooLarge、conflict | 文本/二进制/非法 UTF-8/子模块/冲突/超大真实仓库 |
| worktree 安全读取 | `O_NOFOLLOW_ANY`、同 fd、全祖先复核、signal 竞态 | 父目录变化、外部 symlink swap、FIFO/socket/目录、读取上限、卡住的 open 取消 |
| Git 路径语义 | 只以 `/` 分段，反斜杠保持字面值 | POSIX `\\notes.txt` 与 `dir\\..\\file` 真实文档 |
| untracked 零污染 | 临时 index/ODB + alternate | 特殊文件名、执行位、真实 index/object/worktree 不变、失败/取消清理 |
| 有限竞态处理 | before/after index revision + fd/blob fence | 一次变化后成功、持续变化后 stale、canonicalize 取消/超时 |
| 调度复用 | T2 scheduler + contentRequirement | 100 并发一次 patch、full/conditional 不合并、重复 operationId |
| 聚合文件预算 | before/after probe 同时扣共享请求预算 | 单文件两次探测累计计为 2 |
| 缓存策略 | commit-only 32 MiB LRU | commit conditional 零 Git；uncommitted/branch 二次请求重新执行 |
| 准确观测 | 调度执行函数的实际结果携带 cacheHit | 排队期间 miss→hit / hit→evict 两向回归 |
| patch 统计 | hunk 状态机 | CRLF、无末尾换行、binary 标记文本反例、`++/--` 源码 |

## 验证结果

```bash
pnpm exec vitest run \
  tests/unit/main/git-exec-raw.test.ts \
  tests/unit/main/git-review-budget.test.ts \
  tests/unit/main/git-review-scheduler.test.ts \
  tests/unit/main/git-review-scheduler-raw.test.ts \
  tests/unit/main/git-review-observer.test.ts \
  tests/unit/main/git-review-identity.test.ts \
  tests/unit/main/git-review-commit-lru.test.ts \
  tests/unit/main/git-review-index-parser.test.ts \
  tests/unit/main/git-review-index.test.ts \
  tests/unit/shared/git-review-contract.test.ts \
  tests/unit/main/git-review-path-guard.test.ts \
  tests/unit/main/git-review-document-envelope.test.ts \
  tests/unit/main/git-review-document.test.ts \
  tests/unit/main/git-review-service.test.ts \
  tests/unit/main/git-review-service-reuse.test.ts \
  tests/unit/main/git-review-service-cache-observation.test.ts \
  tests/unit/main/git-review-document-cleanup.test.ts \
  --no-file-parallelism
# 17 files / 247 tests passed

pnpm typecheck:host
pnpm lint
pnpm depcruise
pnpm check:file-size
git diff --check
# 全部通过
```

## 禁止的反模式与后续边界

- 未使用逐文件 N+1 Git 命令、文本模式 `git diff` 解析、`<ref>:<path>` 拼接、shell、真实 index 写入或真实 ODB 写入。
- 未在普通 document 同时返回 patch 与 old/new 全文；全文补全和按需复制 8 MiB patch 仍由 T5 独立 operation/预算实现。
- 未把 commit cache 放在 scheduler 外，也未给 uncommitted/branch 增加 settled 缓存。
- 未把协议缺陷误报为可重试 stale，也未让观测异常反向改变调度结果。
- T4 不开放 IPC 或写动作。T6 必须从可信 `PanelContext` 重建 canonical scope、绑定真实窗口 owner，并接入权限和 IPC 契约。

## 终审状态

主会话按轮次修复了祖先路径 ABA、正文峰值、协议错误重试、固定上下文、binary 文本误判、hunk `++/--` 统计、canonicalize deadline、缓存绕过 lease、真实 cacheHit 观测、copy 多 envelope、POSIX 反斜杠路径、probe 聚合计费、文件读取取消和文件大小硬门。T4 完成并准入 T5。

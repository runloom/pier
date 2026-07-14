# T3 Git 变更索引验收记录

**验证日期：** 2026-07-15

**对应计划：** [Git 差异审阅能力完善实施计划](../plans/2026-07-14-git-diff-review-polish.md)
**范围：** T3 只负责轻量变更索引，不读取文件正文，不接入 IPC、插件门面或 renderer。

## 所有权与命令路径

- `GitReviewIndexReader` 独占查询解析后的索引读取与组装。
- `GitReviewIdentityResolver` 独占仓库根、对象格式、请求开始时 HEAD、commit、branch target 和 merge-base 身份。
- 三个字节解析器分别处理 porcelain v2、raw diff 和 numstat；secondary numstat 只补充主事实中的统计，不创建新条目。
- `GitReviewBudget` 或调度器提供的共享执行预算覆盖整次请求；子命令不得重置截止时间、输出字节或文件数量。
- shared 只持有五类 `GitReviewGroup`、查询、结果和警告契约，不依赖 main 或 `@pierre/diffs`。

```text
uncommitted
  → resolve repository identity
  → status --porcelain=v2 -z（主事实）
  → 按请求组依次执行 0..2 条 diff --numstat -z（统计补充）
  → 按 UTF-8 路径排序、合并 group、扣除文件预算
  → resolved query(headOid + 纯 indexToken) + revision

commit
  → resolve repository identity
  → revision^{commit} → fixed commit OID + first parent/empty tree
  → diff --raw -z → diff --numstat -z
  → 唯一 commit group

branch
  → resolve repository identity
  → exact ref → fixed target OID
  → merge-base(fixed request-start HEAD, target OID)
  → diff --raw -z → diff --numstat -z
  → 唯一 branch group
```

所有 status、raw 和 numstat 命令都显式使用 `--literal-pathspecs` 与 `--ignore-submodules=none`。diff 还固定 `--no-ext-diff`、`--no-textconv`、`--no-color`、`--find-renames=50%`、`--find-copies=50%` 和 `-l2000`。

## 需求到证据

| 要求 | 实现证据 | 测试证据 |
| --- | --- | --- |
| 常数命令，无逐文件 N+1 | `git-review-index.ts` 按查询最多执行 3 条索引命令 | 精确命令次数与参数断言 |
| NUL 安全与特殊路径 | raw runner + 三个 Buffer 解析器 | porcelain 8,002 与 raw/numstat 6,003 records 门；换行、制表符、`:(glob)`、前导短横线 |
| 严格 UTF-8 | `isUtf8` 后才生成相对路径 | 非 UTF-8 rename 整项跳过；2,000 条非法路径压力 |
| 2,000 个最终逻辑文件上限 | primary 最多保留 4,000 个事实，assembler 按最终文件合并并裁切 | 2,000/2,001 条排序不相邻的 rename 链；primary 与 secondary 截断 |
| staged/unstaged 合并 | 五类 group 共享顺序，assembler 按 path 合并 | 双 group、deleted、conflict、rename/copy/typechange |
| 链式重命名 | group fact 保留独立 target path；只合并一对一 unstaged rename 边 | 真实 `a→b→c` 合并；copy 边保持两个条目；两组统计按各自 target path 关联 |
| T4 路径交接 | `GitReviewIndexReader.resolve()` 同时返回公共 result 与 main-only resolved entries | 真实 `a→b→c` 断言 staged target=`b`、unstaged target=`c`，两者绑定同一 result revision |
| 纯索引围栏 | `indexToken` 只由 index-side digest 派生；HEAD 由 resolved query 单独持有 | 纯 worktree 变化不改变 token；HEAD 变化只改变完整 revision；staged 变化改变 token |
| 固定 commit/branch 身份 | commit、target、HEAD 和 merge-base 均在 diff 前解析为 OID | root commit、固定 branch 范围、精确 argv 与次数 |
| SHA-1/SHA-256 与未产生首个提交的仓库 | 动态对象格式、OID 长度和空树 | SHA-256 staged index、unborn HEAD、root commit |
| 子模块不被用户配置隐藏 | 全部机器命令强制 `--ignore-submodules=none` | 真实子模块在两类 ignore 配置为 `all` 后仍返回，统计为 `null` |
| 聚合预算与取消 | reader 接受结构化共享预算，最终结果校验后仍检查终态 | 调度器 → 索引组合、组装与结果阶段超时、主动取消、下调文件上限 |
| 类型化失败 | 身份阶段与索引阶段分别映射稳定 reason | `notRepository`、非法 commit、非法输入、4 KiB UTF-8 技术诊断 |

## 验证结果

```bash
pnpm exec vitest run tests/unit/main/git-exec-raw.test.ts tests/unit/main/git-review-budget.test.ts tests/unit/main/git-review-scheduler.test.ts tests/unit/main/git-review-identity.test.ts tests/unit/main/git-review-index-parser.test.ts tests/unit/main/git-review-index.test.ts tests/unit/shared/git-review-contract.test.ts
# 7 files / 175 tests passed

pnpm test:unit
# T3 相关测试通过；默认全量运行另有 1 个既有终端状态用例超过 5 秒

pnpm exec vitest run tests/unit/main/terminal-state-consistency.test.ts -t "does not count a restored agent session as a new user launch" --testTimeout=15000
# 1 test passed，实际耗时约 6.5 秒；该文件未被 T3 修改

pnpm typecheck:host
pnpm lint
pnpm depcruise
pnpm check:file-size
git diff --check
# 全部通过
```

## 已知限制与后续所有者

- Git 只通过 C locale 的成功 stderr 提示 rename 检测达到上限；实现只窄匹配官方提示。请求已因第 2,001 项截断时不会继续 drain 或重跑昂贵 diff。
- 主事实与 numstat 串行执行，因此工作区可在两条命令之间变化。secondary 只按主事实路径与 rename oldPath 补充统计，错配时返回 `entryStatsUnavailable`，不会创造幽灵条目；T4/T5 的文件正文和动作仍须使用各自的内容围栏与重试规则。
- T3 不做授权。T6 必须通过 `PanelContextService` 重新解析 scope 后，才能把 reader 暴露到命令与 IPC 边界。
- T3 不读取文件正文，也不提供 diff UI。正文、补全、动作和官方 `CodeView` 分别由 T4/T5/T8/T10 所有。
- 默认 `pnpm test:unit` 当前会在未被本批修改的 `terminal-state-consistency` 恢复会话用例触发 5 秒超时；同一用例放宽测试超时到 15 秒后通过。T3 定向集与全部静态门不受影响，本批不借机修改终端测试或生产代码。

## 审查状态

主会话已逐轮修复文件拆分、共享预算、截止时间误报、子模块配置、纯索引摘要、错误分类、链式重命名路径所有权、传输门和事实计数问题。最终实现按完整元组原子计入最多 4,000 个事实，status 与 range 分别使用 8,002/6,003 条 NUL 记录传输门；摘要原子性、非法 UTF-8 计费和仅 staged / 仅 unstaged 的链式路径均有自动回归证据。架构、执行/冗余、性能/健壮性三路终审均无 P0/P1，T3 已完成并准入 T4。

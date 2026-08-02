# Git Review：持续更新与失败面契约

日期：2026-08-02  
状态：**产品已确认（2026-08-02）** — 补全金标准中「失败面 / watch 兼容」的可执行契约；**不**改 stage/hunk 语义、stable-ledger 几何或 bodyClass 成员资格。  
范围：全局 toast 通道、背景刷新静默、last-good 保留、行内失败、渲染层回滚、验收钉子。

### 文档层级（冲突时）

| 文档 | 角色 | 与本文关系 |
|------|------|------------|
| `2026-07-31-git-review-gold-standard-endstate-design.md` | SCM Review **终态唯一权威**（体感/加载/导航/骨架） | 冲突时以金标准为准；本文 **收紧** 失败与 live-update 反馈 |
| `2026-07-25-git-review-codeview-endstate-design.md` | soft-retain、stage 零 toast、settled-only | **§7–§8 失败面由本文 supersede 为可执行规则** |
| `2026-07-27-git-review-stable-ledger-design.md` | content 槽几何 / LRU | 不改；失败态仍用 `error` / `ready-notice` 槽 |
| `2026-07-27-diff-view-lifecycle-design.md` | remount / apply 生命周期 | 渲染回滚规则与本文 §6 对齐 |
| **本文** | **背景刷新零打断 + 失败分级 + 反馈通道** | live-update / failure UX 的契约源 |

**实现禁令：** 未对照本文时，禁止再合「扩 transient 名单挡 toast」「同 mode 只 toast 一次」类症状补丁充当结案。

---

## 0. 一句话契约

> **Git Review 是持续同步的只读缓存视图：后台怎么失败都可以；用户看见的永远是 last-good 或行内说明；全局 error 只服务「我点了按钮却没做成」的因果。背景路径全局 error toast 配额 = 0。**

---

## 1. 背景与病理

### 1.1 现象（2026-08 观测）

活跃编辑 / watch / agent 写盘期间，审查面板顶栏可连续弹出：

1. **渲染差异失败**（`ui.reviewRenderFailed`）— 整页 `runtimeError`
2. **无法显示 \<file\> 的差异**（`ui.reviewAdditionalIssuesSingle`）— document / 聚合失败

二者可同屏出现；用户未点任何按钮。

### 1.2 根因（产品模型，非「去重不够」）

| 错误假设 | 正确模型 |
|----------|----------|
| 背景 materialize / parse / apply 失败 = 用户错误 | 背景失败 = 工程新鲜度问题 |
| 过滤部分 reason 后「少弹」即可 | 背景路径 **关闭** 全局 error 通道 |
| 同失败周期只 toast 一次 | 换代清空集合 → 去重重置 → 仍刷屏 |
| soft-retain 失败用 info 解释 | 有 last-good 时 **无需解释** |
| document toast + render toast 可并存 | **单一失败表面** |

实现侧现状（契约对照用，非实现说明全文）：

- `ReviewFeedback` 对非 transient document 失败发 hard `notifications.error`
- soft-retain 仍可能 info toast（「仍显示旧内容」）
- `runtimeError` 一律 error toast，且正文可被整页 Empty 替换
- `TRANSIENT_REVIEW_FAILURE_REASONS` 只覆盖竞态子集；`timeout` / 临时 `commandFailed` 仍可抬全局
- generation reset 清空 failures → toast 模式位重置

### 1.3 业界对照（设计锚点）

| 产品 | 背景刷新 | 单文件失败 | 用户动作失败 |
|------|----------|------------|--------------|
| VS Code multi-diff / SCM | 就地更新；视图内 progress；**不**因 auto-refresh 弹 error | 编辑器/条目上下文 | commit / 命令结果 |
| GitHub Desktop | store 合并刷新；diff 区独立加载 | **diff pane 内** | commit / push dialog |
| JetBrains Commit | 状态缓存 + 静默刷新 | 列表/diff 内 | 写操作 dialog |
| Pier 金标准已有方向 | soft-retain、stage 成功零 toast、settled-only | 条目级 | mutation 一次 |

本文把「方向」钉成 **硬契约**。

---

## 2. 目标与非目标

### 2.1 目标

1. **背景路径全局 error toast = 0**（watch、index 换代、自动 materialize、worker 降级、apply 瞬时失败）
2. **有 last-good 时永不 blank、永不说「无法显示」**
3. **无 last-good 的单文件失败只在该文件槽内呈现**
4. **整页 Empty 仅当面板完全无可展示 last-good**
5. **用户意图失败：恰好一次、可带详情**
6. **渲染 apply 失败：回滚上一帧，不抬 runtime 全局 toast**
7. 契约可测：治理单测 + 组件/e2e 探针可钉死

### 2.2 非目标

- 不改 stage/hunk 写路径语义、双槽 `sectionKey`、bodyClass 成员资格
- 不改 Pierre 引擎选型；不引入第二套 diff 渲染器
- 不在本文规定具体退避毫秒的最终调参（给默认建议，实现可微调）
- 不解决「git 本身损坏」的修复；只规定 UI 如何对待
- 不把 index 全挂时的 Empty 改成假成功

---

## 3. 决策摘要

| # | 决策 | 理由 |
|---|------|------|
| **K1** | 反馈分 **背景路径** 与 **用户意图路径**；背景路径禁止 `notifications.error` | 业界 SCM 共识；对齐操作反馈规范 |
| **K2** | 显示层只 commit **成功帧**；Working 失败默认不订阅 toast | SWR / last-good |
| **K3** | soft-retain / 上一帧 items = last-good；失败时继续展示 | 「无法显示」语义错误 |
| **K4** | 删除 soft-retain 的全局 info toast | 有内容不必解释 |
| **K5** | 无 last-good 的 entry 失败 → **行内** error/notice 槽；禁止抬全局 | item-scoped |
| **K6** | `runtimeError` 不再驱动全局 toast；apply 失败 **rollback** 上一帧 | 消灭双 toast 与空白风暴 |
| **K7** | 仅 `userIntentId` 绑定的操作结果可 error toast/alert | 因果绑定 |
| **K8** | 用户可见失败须 `generation === head` 且 `settled` 且过 **minDwell** | 禁中间态闪错 |
| **K9** | 背景失败静默重试（有界）；成功无感替换 | 兼容持续更新 |
| **K10** | 治理测试锁定 K1–K7；症状扩名单不算结案 | 防回归 |

---

## 4. 三层状态模型

```
┌──────────────────────────────────────────────┐
│ Presentation（用户看见）                        │
│  · lastGood items / 树                         │
│  · per-entry 行内 notice（无 last-good 时）     │
│  · 整页 Empty（仅全无 last-good 的终态）         │
│  · 可选 discreet「更新中」（>T_progress，非 error）│
└──────────────────────────────────────────────┘
                 ▲ 仅 committed 成功帧写入
┌──────────────────────────────────────────────┐
│ Working（当前 generation 进行中）               │
│  · loading / soft-retain map                   │
│  · 失败只记在 working；默认可丢弃、不 toast      │
└──────────────────────────────────────────────┘
                 ▲ latest-wins / abort 旧代
┌──────────────────────────────────────────────┐
│ Source（watch / index / document / parse）     │
│  · 可失败、可 abort、可静默重试                 │
└──────────────────────────────────────────────┘
```

### 4.1 写入规则

| 事件 | Presentation | Working | Toast |
|------|--------------|---------|-------|
| index 换代开始 | 保留 lastGood | 新 generation 启动 | 无 |
| entry loading | 保留该 entry lastGood 或 estimate | loading | 无 |
| entry loaded 成功 | 替换为新正文 | 清除该 entry 失败 | 无 |
| entry 失败 + 有 lastGood | **不变** | 记 refresh 失败（内部） | **无** |
| entry 失败 + 无 lastGood + settled + dwell | 该槽 error/notice | 记 document 失败 | **无** |
| 全仓无 last-good + index/render 终态失败 | 整页 Empty + 重试 | — | **无**（Empty 即反馈） |
| userIntent 写失败 | 回滚乐观态 | — | **一次** error |
| userIntent 写成功 | 自然 UI | reconcile | **无** error toast |

### 4.2 Generation 规则

1. 仅 `generation === head` 的结果可进入 Working 终态。  
2. 旧代 error **永不** 写入 Presentation，**永不** 打开任何用户失败通道。  
3. `resetGenerationFailures` **不得** 作为「重新允许 toast」的开关——背景路径本就无 toast。

---

## 5. 反馈决策树（实现必按此执行）

```
failure 发生：
  │
  ├─ 绑定 userIntentId？  （stage / unstage / discard / hunk / 手动刷新 / 显式重试）
  │     YES → 允许一次动作结果反馈（error toast 或 alert+详情）
  │     NO  → 背景路径 ↓
  │
  ├─ 存在 lastGood（该 entry 或整页上一帧 items）？
  │     YES → 静默保留；可选 discreet 进度；禁止一切 toast
  │     NO  → ↓
  │
  ├─ generation === head 且 settled 且 elapsed ≥ minDwell？
  │     NO  → 保持 estimate/loading；禁止失败面
  │     YES → ↓
  │
  ├─ 仅影响单 entry / section？
  │     YES → 行内 error 槽 + 可选行内重试；禁止全局 toast
  │     NO  → 整页 Empty + 重试；禁止全局 toast（Empty 即内容）
  │
  └─ 禁止：document toast + render toast 双开
```

### 5.1 minDwell 与 discreet 进度（默认建议）

| 常量 | 建议默认 | 含义 |
|------|----------|------|
| `minDwellMs` | 800–1500 | 背景失败进 **行内/Empty** 前最短停留（防闪） |
| `progressRevealMs` | 300–500 | 超过后可显示 discreet「更新中」（非 error） |
| `silentRetryMax` | 3–5 | 背景 timeout/busy 类静默重试上限 |
| `renderRollbackMax` | 连续 3 次 apply 失败 | 仍无 last-good 才允许整页 Empty |

具体数值可调；**契约不变量** 是通道选择，不是毫秒。

### 5.2 userIntent 白名单

| 意图 | 成功 | 失败 |
|------|------|------|
| file/hunk stage · unstage | 自然 UI（搬家/按钮态）；**零** error toast | 一次 error；可 alert 详情 |
| discard / restore | 自然 UI | 一次 error |
| 面板「刷新」/ 命令面板刷新 | 自然更新 | 一次面板级反馈（Empty 或单次 toast，二选一，禁止每文件一条） |
| 行内/Empty「重试」 | 静默成功 | 仍行内/Empty；**不**额外全局 toast 风暴 |
| 纯 watch / 自动 index / 自动 materialize | — | **永不** `notifications.error` |

---

## 6. 渲染层契约（PierDiffView）

### 6.1 硬规则

1. **membership / item apply 失败**  
   - 回滚到 `previousOrdered`（或上一成功 `appliedItems`）  
   - **禁止** 将「Pierre did not accept…」提升为全局 `runtimeError` toast  
   - 记内部 `renderDegraded`；下一帧/下一代自动再试  

2. **worker 不可用 / 初始化失败**  
   - 静默降级 inline  
   - **禁止** 因此 error toast  

3. **inline 渲染确认超时**  
   - 有 last-good → 保留 last-good，内部重试  
   - 无 last-good 且连续失败过阈值 → 整页 Empty（面板内），**无** 全局 toast  

4. **单 item `processFile` 失败**  
   - 该 item 进入 error/notice 几何（已有）  
   - **禁止** 经 `onItemError` 抬全局「无法显示」toast  

5. **React ErrorBoundary**  
   - 优先恢复共享 View / 上一帧  
   - 仅连续崩溃且无 last-good → 面板内 Empty + 重试  
   - **禁止** 与 document 失败叠双 toast  

### 6.2 与 `ReviewFeedback` 的关系

| 现状输入 | 契约后 |
|----------|--------|
| `runtimeError` → error toast | **删除**该 toast 通道 |
| `failures` hard → error toast | **删除**背景 hard toast |
| `failures` soft → info toast | **删除** |
| `indexFailure` + 用户无意图 | 有 last-good 树/正文则静默；全无则面板 Empty |
| `indexFailure` + 手动刷新意图 | 一次动作结果反馈 |

`ReviewFeedback` 可降级为：仅处理 **userIntent 绑定** 的 index/mutation 结果；或删除全局 document/runtime 订阅，改由 mutation 调用点直接反馈。

---

## 7. Document / soft-retain 契约

### 7.1 soft-retain 是默认，不是兜底

| Working 态 | Presentation |
|------------|--------------|
| loaded → loading | 继续旧 loaded |
| loaded → error(refresh) | 继续旧 loaded |
| loaded → unchanged | 继续旧 loaded（身份可复用） |
| 无 previous + loading | estimate 槽 |
| 无 previous + error settled+dwell | **行内** error 槽 |

**禁止** 在「旧正文仍在」时使用文案「无法显示 … 的差异」。

### 7.2 原因分级（用户面）

| 类别 | 例 | 背景路径用户面 |
|------|-----|----------------|
| **瞬态 / 可重试** | aborted, busy, staleRevision, changeNotFound, duplicateOperation, 临时 timeout, 临时 commandFailed | 静默 + 有界重试；有 last-good 则保留 |
| **终态说明** | outputLimit, binary/symlink/submodule 等 state | 行内 ready-notice / state（非 error toast） |
| **终态错误** | 持续 timeout/commandFailed 且无 last-good | 行内 error + 重试 |
| **仓库级** | notRepository, invalidSource，且无任何 last-good | 整页 Empty |

**注意：** 「扩 transient 集合挡 toast」**不够**；背景路径应 **整通道关闭**，与 reason 列表解耦。reason 列表只服务 **行内文案 / 是否 retryable**。

### 7.3 Stage / watch reconcile

继承金标准：

- 成功路径 **零** `toast.error` / failure banner  
- write 进行中：忽略同源 path 的瞬态 document/render 失败进用户面  
- reconcile **禁止** 以「整代拆 CodeView 再全量灌」作为主路径  
- 乐观与真相冲突：**单点纠正**，不整图闪  

本文追加：

- watch 触发的 index 换代 **不得** 打开 document/runtime 全局 toast  
- stage 成功后的 document 竞态 **不得** 表现为「无法显示」

---

## 8. 用户可见文案约束

| 场景 | 允许 | 禁止 |
|------|------|------|
| 有 last-good 的刷新失败 | 无文案，或 discreet「更新中」 | 「无法显示」「渲染差异失败」 |
| 无 last-good 单文件 | 行内：「无法加载此变更」+ 重试 | 全局 toast 同文案 |
| 用户 stage 失败 | 短 error + 可选详情 | 与 watch 失败合并轰炸 |
| 整页无内容 | Empty 标题/说明 + 重试 | 顶栏再叠一条同义 toast |

文案仍走 i18n；**删除或停用** 背景路径对下列 key 的 toast 调用：

- `ui.reviewRenderFailed`（仅可作 Empty 标题，不作 toast）
- `ui.reviewAdditionalIssuesSingle` / `Count`（仅可作行内/汇总条，不作背景 toast）
- `ui.reviewRefreshSoftRetained`（整 key 退役推荐）

---

## 9. 通道矩阵（验收用）

| 场景 | 全局 error toast | 行内/Empty | discreet 进度 |
|------|------------------|------------|---------------|
| 编辑中 watch 刷新成功 | 0 | — | 可选 |
| watch 刷新 + 单文件 timeout + 有旧 diff | **0** | 无（保留旧） | 可选 |
| watch 刷新 + 单文件 timeout + 无旧 diff + dwell | **0** | 行内 error | — |
| Pierre apply 瞬时失败 + 有上一帧 | **0** | 无（rollback） | — |
| Worker 挂 → inline | **0** | — | — |
| stage 成功 + staleRevision 竞态 | **0** | 无 | — |
| stage 写失败 | **1** | 回滚乐观 | — |
| 用户点「刷新」且 index 全失败 | **0 或 1**（与 Empty 互斥，不得双开） | Empty 优先 | — |
| 连续 20 次 status 模拟 | **0** | 允许行内稳定态 | — |

**硬验收句：**

> 连续 `git status` / 文件保存 / agent 写盘 ≥ 30s，审查面板在 **无用户 mutation** 时：`notifications.error` 调用次数 **= 0**。

---

## 10. 与现有实现的映射（迁移方向）

| 模块 | 现状风险 | 目标 |
|------|----------|------|
| `review/feedback.tsx` | document/runtime → toast | 背景订阅删除；仅 userIntent |
| `review/failure-state.ts` | 聚合供 toast | 聚合供 **行内/Empty**；`softRetainedOnly` 不再驱动 toast |
| `review/code-view.tsx` | runtimeError → 整页 Empty + toast | rollback 优先；Empty 仅无 last-good |
| `packages/ui/diff-view/*` | onError 抬整页 | apply 失败返回 false 时宿主 rollback，不 blank |
| `document/generation.ts` | soft-retain 已有 | 保持；失败不进 hard toast |
| mutation 调用点 | 部分已有反馈 | 统一挂 `userIntentId` |

**禁止的症状 PR：**

- 只往 `TRANSIENT_REVIEW_FAILURE_REASONS` 加 reason  
- 只加 toast 签名去重 / 防抖  
- 只改文案不改通道  

---

## 11. 测试与治理钉子

### 11.1 单元 / 组件

| 钉子 | 断言 |
|------|------|
| 背景 document timeout + soft-retain | `notifications.error` 未调用；旧 items 仍在 |
| 背景 document timeout + 无 retain | 行内 error；`notifications.error` 未调用 |
| 连续 5 次 generation reset + 同一失败 | `notifications.error` 仍为 0 |
| apply reject | 上一帧 items 保留；无 renderFailed toast |
| stage 成功路径 | `notifications.error` 为 0（继承金标准） |
| stage 写失败 | `notifications.error` 恰好 1 次 |
| 双失败同帧（document + apply） | toast 总数 0（背景） |

### 11.2 治理文件建议

- 扩展或新增：`tests/unit/renderer/git/review/live-update-failure-governance.test.ts`  
  - 锁定本文标题与 K1/K6/K7 关键词  
  - 扫描 `ReviewFeedback`：背景路径不得对 `failures`/`runtimeError` 调 `notifications.error`（实现收敛后）  
- 更新 `feedback.test.tsx`：删除「背景失败必 toast」期望，改为「背景零 toast」

### 11.3 e2e（可选但推荐）

- 打开 Review → 外部改文件 10 次 → 断言无「渲染差异失败」「无法显示」文案  
- stage 成功 → 零 error toast（已有方向加强）

---

## 12. 实现切片（建议）

| 切片 | 交付 | 完成定义 |
|------|------|----------|
| **F0** | 本文合入；金标准文档层级增加「失败/live-update 以本文为准」指针 | 文档权威 |
| **F1** | 背景路径关闭 document/runtime 全局 toast；退役 soft info toast | 30s watch 探针 toast=0 |
| **F2** | apply/worker 失败 rollback；runtimeError 不再 toast/不轻率 blank | 双 toast 消失 |
| **F3** | 无 last-good 失败只行内；error 槽 `onRetryItem` → `loader.retry`；Empty 与 toast 互斥 | 矩阵 §9 绿；行内 Retry 可恢复 |
| **F4** | userIntent 统一挂载；mutation 失败一次 | stage 失败恰好 1 |
| **F5** | 治理测 + 更新 feedback 单测 | 防回归 |

**约束：** F1 前禁止再合「扩 transient / 加防抖」当结案。F0 可先合文档。

---

## 13. 开放细节（不挡 F0/F1）

1. discreet「更新中」落点：面板标题旁 vs 状态栏（默认建议面板内非阻挡指示）  
2. 手动刷新失败：Empty **或** 单次 toast，产品二选一并写死  
3. `silentRetryMax` / `minDwellMs` 最终数值  
4. `ReviewFeedback` 删除 vs 瘦身为 intent-only 门面  

---

## 14. 确认记录

- 2026-08-02：分析确认「背景路径一次也不应弹全局 error toast」；业界 SWR + 动作绑定反馈。  
- 2026-08-02：产品确认 K1–K10 与 §9 验收句；进入 **F1** 实现。

---

## 附录 A. 与金标准原文的关系

| 金标准 / endstate 原句 | 本文 |
|------------------------|------|
| stage 成功零 toast.error | 保持，并扩展为 **一切背景路径** 零 error toast |
| soft-retain | 强化为 last-good 默认；失败不解释 |
| failure settled-only | 保持，并加 minDwell + generation===head |
| materialize 失败行内 | 钉死；**禁止**抬全局 |
| parse 水合中不抬全局横条 | 扩展为 parse/apply/worker 均不抬全局 toast |
| 删除「render error 微任务闪一下」 | 删除整类全局 render toast |

---

## 附录 B. 决策树伪代码（实现备忘）

```ts
type FailureSurface =
  | { kind: "silent" }
  | { kind: "inline"; entryKey: string }
  | { kind: "panel-empty" }
  | { kind: "action-error"; intentId: string };

function surfaceFor(failure: ReviewFailureEvent): FailureSurface {
  if (failure.userIntentId) {
    return { kind: "action-error", intentId: failure.userIntentId };
  }
  if (failure.hasLastGood) {
    return { kind: "silent" };
  }
  if (!failure.isHead || !failure.settled || failure.elapsedMs < minDwellMs) {
    return { kind: "silent" }; // 仍可显示 estimate/loading
  }
  if (failure.scope === "entry") {
    return { kind: "inline", entryKey: failure.entryKey };
  }
  return { kind: "panel-empty" };
}

// 不变量：surface.kind !== "action-error" ⇒ 禁止 notifications.error
```

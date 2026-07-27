# DiffsHub 全量对齐方案（含 Pier 增量能力）

日期：2026-07-27  
状态：**部分 supersede（同日 stable-ledger）** — **显示 id 集 / 点树是否可滚 / 裁 id 保滚动** 以  
`2026-07-27-git-review-stable-ledger-design.md` **为准**。  
本文仍管辖：demand **调度形状**、scroll **单写者意图**、updateItemId、stage 与导航交叉锁。  
实现：禁止在未对照 **stable-ledger + 本文 demand/scroll** 的情况下继续症状补丁。

### 文档层级（canonical）

| 文档 | 角色 |
|---|---|
| `2026-07-27-git-review-stable-ledger-design.md` | **显示几何权威**：全量账本、estimate、正文 LRU、点树 instant |
| `2026-07-25-git-review-codeview-endstate-design.md` | 真正文、禁**假** placeholder、soft-retain、stage、failure |
| `2026-07-27-diff-view-lifecycle-design.md` | remount；常量数字以 stable-ledger §4.4 改写 members 语义 |
| **本文** | demand 调度、scroll 单写者；**§4.3 稀疏 members 公式作废** |

冲突时：**显示 id / 能否 scroll / 卸正文** → **stable-ledger**；demand 组合与 scroll 双意图禁令 → **本文**；soft-retain/stage → **07-25**。

> **历史警告：** 下文 §1.3 / §2 架构图 / §3.2 / **§4.3 全文** / §7 中「members 裁 id」「未 materialize 不滚」「firstLayout/smooth」「成员 cap 验收」均为 **历史叙述，禁止实现**。  
> 显示与点树：**只读** `2026-07-27-git-review-stable-ledger-design.md`。  
> 树导航 behavior：**一律 instant**（stable-ledger K6）。

---

## 0. Key Decisions

| # | 决策 | 理由 |
|---|---|---|
| K1 | 对标分层：生命周期+树导航体感 → DiffsHub/CodeView；stage/hunk 语义 → Codex；**禁止**用「DiffsHub 无 stage」为导航偏差开脱 | 引擎支持变更；缺的是 SCM 产品不是列表架构 |
| K2 | 同 Review 会话 CodeView 单实例；成员变更只 `addItems` / `updateItem` / `updateItemId` / `setItems→reconcile`；禁止 id 列表 remount | 对齐 viewerKey 语义 |
| K3 | **demand 只调度读（优先级/cancel loading）**；**不定义显示集合、不 pin-first 重排成员** | 修正 exclusive 根因归因 |
| K4 | 树导航：**应用层 ≤1 次 scrollTo**（+ 可选 1 次 expand 的 updateItem）；settle 归 CodeView；verify **默认不重发 scrollTo** | 对齐 DiffsHub fire-and-forget + 引擎 pendingScrollTarget |
| K5 | 有导航目标时：**禁止** membership sync 写 `container.scrollTop` 与 scrollTo 并行 | 消除双意图「先沉底再跳」 |
| K6 | Pier 增量不得删减，且**叠在** K2–K5 上（见 §4 引用表 + 扩展契约） | 用户要求增量不少 |
| K7 | 内存有界：LRU + 成员 cap；**成员输出序 = 稳定 index/投影序**；tree-nav 期间 **sticky 单调不减**（fill 仍截断）；settled 后 sticky-only 可裁回 cap | 防 set-swap 与无界 sticky |
| K8 | 验收：scrollTo 次数探针 + 成员相对序 + sticky/retention pin，不以单测绿代替 | 防补丁回归 |

---

## 1. 问题与边界

### 1.1 必须消除的体感

1. 树点击：内容/滚动条先错位或沉底再跳（≠ DiffsHub）。  
2. 列表因导航 **换集/重排** 导致高度与视口崩。  
3. 交付呈补丁叠层（demand/cap/scrollTop/verify 互殴）。

### 1.2 根因（可证伪，非「pin-only 清空」）

| 机制 | 说明 |
|---|---|
| **R1 成员 set-swap** | exclusive 后 pin 变少，`rest` 按 index **前缀重填** cap → 视口附近已 loaded 被换出 |
| **R2 双意图滚动** | membership 后 `scrollTop=old` 再 `scrollTo(target)` / verify 再滚 |
| **R3 retention pin 过窄** | nav 时 pin≈selected → LRU 可 idle 掉 sticky loaded |
| **R4 过早 tryPendingNavigation** | item 尚未 apply 进 CodeView 就 scrollTo |
| **R5（次要）** pin-first 数组序若写进 CodeView | 会整表 reconcile 重排（必须禁止） |

### 1.3 DiffsHub 实际 vs Pier 必要增量（禁止混写）

| | DiffsHub 实际 | Pier 必要增量（本地 Git） |
|---|---|---|
| 树集合 | ≈ 已解析 diff 文件 | **全量 index** ⊇ CodeView 成员 |
| 点树 | 一次 `scrollTo`（item 可尚不在列表则引擎失败/warn） | 未 materialize：**不滚**；就绪后一次 scrollTo |
| 列表 | append-only 在场 | demand 读盘 + **有界** members；**显示≠demand** |
| 25–96 | **stream publish batch** | seed **读**批量灵感；**不是** DiffsHub 成员模型 |
| stage | 无 | 叠 updateItem / updateItemId / reconcile |

### 1.4 范围

**本文交付（实现 PR）：** 导航主路径、成员序/sticky/set-swap、滚动单意图、retention pin 与 demand 插队、回归测。  

**母约保留、本文不重做（但不得破坏）：** soft-retain 1:1、乐观 stage、failure 三源、session cache、树 delta（P3 若仍开放则本方案只加「不破坏」回归）、hunk/discard 语义。  

**明确 out-of-scope 代码：** DiffsHub 评论、GitHub 拉 patch。

---

## 2. 目标架构

```
L1 Index（全量轻）+ 树（稳定 model + delta）
        │ demand = 读调度 only（priority / cancel loading）
        ▼
L2 Materialize 缓存（字节/行 LRU；并发 cap）
        │ members = f(candidates, pin, sticky, cap, indexOrder)
        ▼
L3 CodeView 单实例 — addItems | updateItem | updateItemId | setItems
        │ 导航：apply 成功后唯一 scrollTo
        ▼
   虚拟滚动绘制（render window ≠ 卸载成员）
```

---

## 3. 导航与滚动契约

### 3.1 DiffsHub 实际（对照索引）

- `apps/diffshub/components/ReviewUI.tsx` — `handleSelectTreeItem`  
- `packages/diffs/.../CodeView.ts` — `scrollTo` / `pendingScrollTarget`（RAF 按 live layout 重解目标）  
- `usePatchLoader` — `viewerKey` 仅换源；流式 `addItems`  

DiffsHub 树点：`getItem` → 可选 `updateItem(expand)` → **一次** `scrollTo({type:'item', align:'start', behavior:'smooth'})`。  
`align:'start'` **不会**因已在视口 no-op（仅 `nearest` 会）。

### 3.2 Pier 近似主路径（硬契约）

```
onTreeSelect(entryKey, sectionKey):
  selected = (entryKey, sectionKey)
  navigationReason = 'tree'          // 与 generation rebind 区分，见 §4.3.1
  navigationPendingRef = true        // ★ MUST，策略闸门（非可选）
  loader.boostPriority(entryKey)     // ★ MUST 插队
  demand: 保留 window∪lookahead      // ★ MUST 禁止 replace 为 pin-only / 仅 selected

  if !codeView.getItem(sectionKey):
    树 row busy；不 scroll
    await materialize(entryKey)
    if fail: settled 失败面；navigationPendingRef=false；return
    成员 apply（addItems 优先；禁止为 nav 清空 sticky）
  // 以下仅在 getItem 存在且 apply 已接受之后：

  if collapsed: updateItem(expand)   // 计 1 次内容变更，非 scroll
  scrollTo({ type:'item', id:sectionKey, align:'start',
             behavior: firstLayout ? 'instant' : 'smooth' })  // 应用层总计 1 次 scrollTo
  // verify：默认 maxRescrollAttempts=0，仅 poll isItemVisible / 超时用户可见失败
  // 禁止：scrollTop 硬恢复、双 rAF 主路径重滚
```

**firstLayout：** 本 item 在本次 apply 中新建（addItems/reconcile 新建）→ `instant`；已在 instance → `smooth`（与 DiffsHub 一致）。仍计 **一次** scrollTo。

### 3.3 滚动单写者状态机

```
idle
  → pendingNav（ref 真源；reason=tree|rebind）
  → layout 子树：membership/content apply
       若 pendingNav：禁止 container.scrollTop 硬写
  → 同帧 layout（子 apply 完成之后，paint 之前）：
       applied && getItem(target) → 恰好 1 次 scrollTo
  → observing（poll isItemVisible；禁止 scroll）
  → settled | failed(用户可见)
  → 仅 settled 且（smooth 时）滚动/布局稳定后：允许 cap 收敛（§4.3）
```

**禁止** paint 后的 `tryPendingNavigation` 作为主路径第一枪；session.sync 在 apply 前不得触发 scrollTo（仅可标 pending）。  
`@pier/ui` 经同步 ref/prop 读 `pendingNav`（layout 可见，非仅 React state 异步）。

### 3.4 会话生命周期（CodeView）

| 事件 | API |
|---|---|
| 换 worktree / target / 关开 Review | 新实例 key |
| 新 materialize | **优先 addItems**（前缀不变时） |
| 正文/折叠/hunk 后 patch | updateItem |
| section 1:1 迁移 | updateItemId |
| 重排 / 多槽增减 / cap 驱逐 | setItems reconcile |
| 布局行高/split | layout key 仅此 |

`setItems`：**非**日常路径默认；流式追加不走全量 setItems。

---

## 4. Pier 增量（引用 + 本文补钉）

### 4.1 不变式引用（不重做实现说明）

| 能力 | 权威 | 本文补钉 |
|---|---|---|
| 真 item、禁 placeholder | 07-25 §4 | — |
| 双组 sectionKey | 07-25 / 契约 | 成员序=index；双槽两 id |
| Soft-retain 1:1 slot-remap | 07-25 + generation | 槽位一致才 remap；否则丢 retain；禁止 resetGeneration 整表清空 |
| 乐观 stage / 成功零 toast | 07-25 §7 | 写失败立即一次反馈；中间态 parse 不进 banner |
| Failure 三源 settled | failure-state | document/refresh/render；unsettled 不抬 refresh 条 |
| Session cache | session-cache | sourceKey=scope JSON；上限 16；hydrate 不破坏 sticky；nav pending 跳过错误 anchor 抢滚 |
| Scope 矩阵 | session | 见 §4.2 |
| 树 delta | 07-25 P3 | 本文 **不交付** P3；DoD：本方案改动不引入整表撕树；P3 仍挂母约 |
| Hunk apply-patch | hunk-stage 设计 | 只 update **当前 group section**；槽增减走 reconcile |
| Discard | discard 模块 | 确认 dialog；成功静默；失败 alert；列表无闪白 |
| 权限 | manifest git:write | 写路径门控不退化 |
| i18n/反馈 | 宿主规范 | 成功静默；失败 alert；禁实现词 |

### 4.2 Scope 身份矩阵

| 变化 | soft-retain | session 桶 | CodeView key |
|---|---|---|---|
| 同 scope 仅 index 代际 | 可 remap | 同 sourceKey 可写 | 不换 |
| 换 target（同 worktree） | **切断**正文复用 | 新 sourceKey | 换实例 |
| 换 worktree/contextId | **切断** | 新 sourceKey | 换实例 |

### 4.3 Demand（Pier only）与成员

**Demand shape（硬）：**

- 正常：seed（仅无 window）∪ window ∪ 双向 lookahead ∪ selection radius  
- **树导航事务（MUST）：**  
  - `boostPriority(selected)`  
  - **保留** window∪lookahead（禁止 replace 为「仅 selected」）  
  - cancel 仅 **loading 且非 required**  
- 25–96：seed **读** batch 上限（灵感来自 DiffsHub publish batch，语义不同）  
- lifecycle 旧文「nav demand 仅为 selected」**作废**，以本条为准（PR0 改正文）

#### 4.3.1 `navigationPending` 原因拆分

| reason | 成员 | retention pin | scroll |
|---|---|---|---|
| **tree**（树点击） | 见下方 members：`pin∪sticky` 可超 cap；fill 仍截断 | pin ⊇ sticky∪selected∪visible | 禁 scrollTop；1× scrollTo |
| **rebind**（generation / stage section 重绑） | sticky 单调即可；勿放全量 fill | protected + soft-retain | resume ≤1 scrollTo（§4.5） |

#### 4.3.2 Members（显示）硬公式

```
candidates = all loaded|error
pin = selected ∪ demand.visible ∪ demand.buffered   // 永不被 cap 截断
sticky = previousMembers ∩ candidates               // set 语义

fill = (candidates - pin - sticky) 按 entryKeysInOrder

if navigationPending && reason == tree:
  // 单调：保留 sticky；禁止 set-swap；禁止 pin∪sticky∪fill 吞掉全体 candidates
  set = pin ∪ sticky ∪ take(fill, max(0, cap - |pin∪sticky|))
  // 若 |pin∪sticky| > cap：保留全部 pin∪sticky（允许暂超 cap），fill 为空
elif navigationPending && reason == rebind:
  set = pin ∪ sticky ∪ take(fill, max(0, cap - |pin∪sticky|))  // 同构，不强制全量
else: // settled
  // sticky 仅作 fill 优先级：先 sticky 后其余 fill，整体截到 cap
  orderedFill = concat(sticky, fill) 按 entryKeysInOrder 去重
  set = pin ∪ take(orderedFill, max(0, cap - |pin|))
  // pin 仍可单独超 cap；sticky-only 可被裁以回到 cap

membersArray = entryKeysInOrder.filter(k ∈ set)   // ★ 稳定序，禁止 pin-first
previousMembers := set  // 本帧输出供下一帧 sticky
```

**Cap 收敛：** 仅在 `!navigationPending` 且滚动状态机 **settled**（含 smooth 布局稳定）后执行 else 分支裁 sticky-only。  
**正文有界**仍只由 retention 字节/行负责；成员 cap 不替代 LRU。

**新 materialize：** 优先 `addItems`；仅当序/删/cap 需要时 `setItems`。  
**Nav 事务内：** 禁止因 cap 删除 **sticky**；不得无条件 `set=candidates`。

### 4.4 Retention pin

```
sticky = previousMembers ∩ candidates
retention.pin ⊇ selected ∪ demand.visible
  ∪ (navigationPending && reason==tree ? sticky : ∅)
```

避免 exclusive 读调度导致 sticky loaded 被 LRU idle，从而 candidates 抽空。

### 4.5 Stage / section 迁移表

| 情况 | API |
|---|---|
| renderSlots 数量与可对齐 1:1 | `updateItemId(old,new)` + 必要 updateItem 正文 |
| 槽位数变化（半暂存 1↔2、conflict） | setItems reconcile；禁止硬 updateItemId |
| 双组并存 | 两 sectionKey 并存；hunk 只动当前 group 槽 |
| stage 后 selectedSectionKey 失效 | `resolveReviewSectionKey` rebind；**至多一次** scrollTo（resume，非树点击主路径） |

### 4.6 Soft-retain（摘要）

- 槽位数一致 + path 可对齐 → remap sectionKey 进 document，保留正文  
- 不一致 → 不 retain 该 entry  
- protectedEntryKey = selected：预算驱逐跳过  
- index 换代禁止对 UI 做「空投影一帧」核爆（对齐 07-25）

---

## 5. 现状偏差 → 代码锚点 → 断言

| 根因 | 代码锚点 | 断言 |
|---|---|---|
| R1 set-swap | `selectCodeViewMemberEntryKeys` | nav 中 `newMembers ⊇ previous ∩ candidates` |
| R2 双意图 | `use-diff-view-item-apply` | pendingNav 时无 `container.scrollTop=` |
| R3 retention | `git-review-document-loader` `#syncPinnedEntries` | nav 中 pin 含 sticky |
| R4 过早 scroll | session.sync / projection-commit | scrollTo 仅 apply 后 |
| R5 重排 | projection 输出序 | 相对序稳定（允许端点增删） |
| 多轮 verify | `scheduleReviewNavigationVerification` | 生产 `maxRescrollAttempts=0` |
| remount | `pierDiffCodeViewKey` | 无 id 列表 |

---

## 6. 模块职责

| 模块 | 拥有 | 禁止 |
|---|---|---|
| `git-review-document-demand` | 读调度组合 | 被当成显示集合 |
| `selectCodeViewMemberEntryKeys` | 显示 set + **index 序** | pin-first 序 |
| `git-review-document-loader` | 并发、cancel loading、retention pin | idle 已 loaded 仅因非 demand |
| `git-review-document-generation` | 代际 soft-retain | reset 整表清空 |
| `git-review-session-cache` | scope 桶 hydrate | 覆盖错误 scroll |
| `use-git-review-navigation` | 一次 scrollTo 状态机 | 主路径多轮 scroll |
| `use-diff-view-item-apply` | 实例 sync | nav 时 scrollTop 硬写 |
| `diff-view-item-sync` | addItems/update/setItems | topology remount |
| projection | 真 item | placeholder |
| hunk/stage/discard/tree actions | SCM 写 | 触发 remount |
| tree model（P3） | delta | 本方案不重写；不破坏 |

---

## 7. DoD

### 7.1 DiffsHub 体感

1. 同会话无 id-list remount。  
2. 已 materialize 树点击：应用层 **≤1** 次 scrollTo（+≤1 expand updateItem）；无沉底再跳。  
3. 未 materialize：就绪前不滚；就绪后 1 次 scrollTo；**members ⊇ previous∩candidates**。  
4. 点击远文件时，视口附近已加载文件不因 set-swap 消失。  

### 7.2 Pier 增量（回归锁，非本方案重做）

5. 双组两 section。  
6. 文件 stage/unstage/discard、hunk apply：无整表闪白；成功静默；写失败一次反馈。  
7. Soft-retain 1:1；换 target/worktree 切断。  
8. Failure settled-only（三源）。  
9. Session 同 sourceKey 可 hydrate。  
10. 内存：字节/行/成员有界；nav 不抽空 retention sticky。  
11. 权限 git:write 不退化。  

### 7.3 测试

**导航主路径（本方案必须新钉/强化）：**

- governance：无 topology id remount  
- member set 单调（tree nav）+ 相对序稳定  
- scrollTo 调用次数 ≤1（+ expand updateItem）  
- pendingNav 无 `container.scrollTop` 赋值  
- demand 形状：nav 时仍含 window（非仅 selected）  

**Pier 增量回归（保持绿，非本方案重写）：**

- soft-retain / slot-remap（generation / loader-utils）  
- failure settled-only  
- 双 section / half-stage 投影  
- session hydrate sourceKey 分桶  
- discard 确认路径  
- manifest `git:write` 写命令  
- hunk 只更新当前 group section  
- 本方案 diff 不引入 tree 全量 rebuild 主路径（P3 不交付）  

---

## 8. PR Plan

### PR0 — 文档（可先合，MUST 改正文）

- 本文 v3  
- **lifecycle**：删除/改写 Demand「nav 仅 selected」与验收条「demand 仅为选中项」→ 指向本文 boost+保留 window；状态头标 supersede  
- 07-25 状态头可交叉引用本文导航补丁  

### PR1a — 成员 set 稳定 + demand 显示解耦

- `selectCodeViewMemberEntryKeys`：§4.3.2 公式（index 序、sticky、fill 截断）  
- loader retention pin ⊇ sticky（tree nav）  
- demand：boost + **保留 window**（删 exclusive replace）  
- 测：set-swap 不发生；nav 时 demand ≠ 仅 selected  

### PR1b — 滚动单写者（**必须在 PR1a 后或同栈；含 scroll 的代码不可先于 PR1b**）

- item-apply：pendingNav 禁 scrollTop  
- navigation：1× scrollTo；verify maxRescroll=0  
- apply 前 tryPending 不得 scroll  
- 测：scrollTo 次数；paint 前单写者  

### PR2 — stage 身份 / rebind（**排在 PR1b 之后** 若含 resume scroll；纯回归测可并行）

- 1:1 updateItemId 表；槽变 reconcile  
- section rebind resume **必须**复用 §3.3 单写者（≤1 scrollTo，maxRescroll=0）  
- soft-retain 回归绿（非重写状态机）  

### PR3 — 清理

- 死代码、冲突注释  

---

## 9. 反补丁清单

1. 只加 pendingScroll 不修 set-swap / 双意图。  
2. exclusive demand 清空显示或 pin-first 重排。  
3. topology remount 回归。  
4. placeholder 进 CodeView 再滚。  
5. 生产 verify 多轮 scrollTo。  
6. sticky 导致无界成员。  
7. 「DiffsHub 无 stage」推迟导航对齐。  
8. 以局部单测绿代替 scrollTo/成员序探针。  

---

## 10. Open Questions（已默认）

| 项 | 默认 |
|---|---|
| scroll behavior | 已在 instance → smooth；本次新建 → instant；均 1 次 |
| cap | 128；nav 可暂超 |
| 树 P3 | 不在本文交付；不破坏 |
| 补偿 scroll | 默认 0；若将来打开，DoD 显式 ≤2 且非主路径 |

---

## 11. 与旧文档

- **07-25**：母约；P3/P4/P5 开放项仍有效，除非后续 PR 关闭。  
- **lifecycle**：remount/常量有效；Demand#4/验收#4 已改写为 boost+保留 window；成员算法指向本文 §4.3。  
- **本文**：导航/成员/滚动/demand-during-nav canonical。  

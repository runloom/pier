# Git Review：Zed 体感同构

日期：2026-07-31  
状态：**部分 supersede（2026-07-31，导航 Commit 2026-08-14）** — **终态唯一权威** 为  
[`2026-07-31-git-review-gold-standard-endstate-design.md`](./2026-07-31-git-review-gold-standard-endstate-design.md)（产品已确认）。  
K4「禁止等 document settle」= 禁止等 **整页**；目标自身离开 estimate 才结束导航，见 [`2026-08-14-git-review-tree-nav-pin-design.md`](./2026-08-14-git-review-tree-nav-pin-design.md)。  
本文保留 **Zed 对照与 bodyClass / pending_scroll 细节**；冲突时以金标准终态文为准。  
体感标杆：**Zed Project Diff**（`GitPanel` + `ProjectDiff` MultiBuffer hunk excerpts），**不是** DiffsHub web patch 阅读器，也 **不是**「per-file document + 并发 2 demand」排队模型。

产品硬约束（继承，不得用本文开脱）：

- **始终多文件** Review 表面（禁止 Codex 式「整页只开一个文件」作为默认）。  
- 保留：hunk/file stage、双槽 `sectionKey`、session cache、soft-retain、failure settled-only、树 delta、index 无文件数产品上限。  
- Pierre CodeView 可作为 **Z1/Z2 过渡渲染引擎**；不得把「每个 index entry 一张假高度 estimate 卡 + 2 路 document 水合」写成终态体验。

### 文档层级（冲突时）

| 文档 | 角色 | 与本文关系 |
|---|---|---|
| `2026-07-31-git-review-gold-standard-endstate-design.md` | **终态唯一权威**（体感+加载+渲染+导航+失败+DoD） | **冲突时以金标准为准** |
| **本文** | Zed 体感与 bodyClass / pending_scroll 细节 | 被金标准吸收；细节补充 |
| `2026-07-27-git-review-stable-ledger-design.md` | 高度账本 / estimate 编码 / LRU 字节闸 | **仍管辖「有资格进正文的槽」的几何与 LRU**；**废止**「凡 index `sectionKey` 必进 CodeView 账本」作为体验模型（见 §0 K2、§3） |
| `2026-07-27-diffshub-full-alignment-design.md` | demand 形状、scroll 单写者 | demand **仅**作重路径读调度；**废止** DiffsHub 为 **SCM 体感** 标杆；导航以金标准 / 本文 §5（Zed）为准 |
| `2026-07-25-git-review-codeview-endstate-design.md` | 真正文、soft-retain、stage、failure | 真正文 / stage / failure 仍有效；「窗口成员」叙述被本文 §3 收紧为 **content-bearing** |
| `2026-07-14-git-diff-review-polish-design.md` | 早期性能闭环 | 「最多 2 并发 document、零正文直到可见」**不得**再当 **首屏主体验**；进程/内存红线改写见 §4、§8 |

**实现禁令：** 在未对照 **金标准终态文** 的情况下，禁止再合「只调 demand 并发 / finishTerminal / empty chevron / 骨架 CSS / 半套 lineDiffType」类症状补丁充当终态。

---

## 0. Key Decisions（产品已确认）

| # | 决策 | 理由 |
|---|---|---|
| **K1** | **体感标杆 = Zed Project Diff**，不是 DiffsHub | 用户要的是 IDE SCM：侧栏即时、正文 hunk 流、海量 rename 不卡 |
| **K2** | **侧栏 ⊥ 正文**：树/列表 = 全量 index；**正文只挂 content-bearing 块** | 对齐 Zed：`GitPanel` 全量 status；`MultiBuffer` 仅 hunk excerpt |
| **K3** | **pure rename / empty text / binary（无文本 hunk）默认不进正文流**，不建假高度 estimate 卡，**不占重 materialize 队列** | Zed：0 hunk → 0 excerpt；Pier rename 海卡顿的主因 |
| **K4** | **点侧栏 = 定位**（`location` 就绪则瞬间 scroll；否则 `pending_scroll`）；**禁止**「navigationPending + 等 document settle + finishTerminal」作主路径 | 对齐 `move_to_path` / `pending_scroll` |
| **K5** | **加载单位终态 = path 级变更摘录（hunk / 轻量元数据）**，不是 N×`getReviewFileDocument` 排队当主路径 | 对齐 `update_excerpts_for_path`；demand 退居例外 |
| **K6** | 落地分 **Z1 → Z2（默认终态）→ Z3（可选）**；Z1 必达体感，Z2 换数据面 | 可交付、可验收，避免一次重写卡死 |
| **K7** | 进程/内存红线保留：禁止 2000 等量 Git 子进程；正文字节/行 LRU 保留 | 防爆与 Zed 体感不冲突——闸门打在重资产，不打在「用户是否看见进度」 |
| **K8** | 验收用 **可机测探针 + 场景用例**（rename 海、瞬时跳、不进重队列），不以「感觉快了」代替 | 防假绿 |
| **K9** | 始终多文件连续表面；**禁止**默认降级为单文件 tab 海 | 产品约束；Zed ProjectDiff 亦是单表面多 path |

---

## 1. 问题

### 1.1 必须消除的体感（产品语言）

1. 打开 Review 后正文 **一个一个** 变真，像排队取号。  
2. 大量 **staged pure rename（+0 −0）** 仍占正文高度 / 仍走 document 加载，整页发粘。  
3. 点树/侧栏文件：要等 materialize / settle 才「算跳完」，不像 Zed 瞬间定位。  
4. 空 / 二进制 / 纯重命名仍像「有大块可展开 diff」。

### 1.2 根因（可证伪）

| ID | 机制 | 证据方向 |
|---|---|---|
| **R1 正文单位错误** | 每 entry 一张 file-level CodeView document（estimate→loaded） | `getReviewFileDocument` + ledger estimate；对照 Zed 仅 excerpt |
| **R2 主路径 = 有界 demand 串行感** | `DEFAULT_MAX_CONCURRENT_DOCUMENTS = 2` 当 **首屏/导航** 水龙头 | `loader-options.ts`；设计 07-14 写死并发 2 |
| **R3 无内容仍进几何** | rename estimate 12 假行；0 hunk 仍可能占槽 | `estimateLinesForFileStatus("renamed")`；emptyReady 仅禁 chevron |
| **R4 点击耦合 materialize 事务** | navigationPending / finishTerminal / loader.settled | 导航钩子与 settle 条件；Zed 无此事务 |
| **R5 标杆错位** | 文档与补丁长期对齐 DiffsHub 滚动/账本，未对齐 SCM 正文模型 | stable-ledger / full-alignment 自述 |

### 1.3 Zed 对照（源码锚点，实施必读）

| Zed | 路径 | Pier 应对齐的语义 |
|---|---|---|
| 侧栏点击 | `git_ui/git_panel.rs` → `open_diff` → `ProjectDiff::deploy_at` | 开/聚焦正文表面 + 定位 path |
| 定位 | `project_diff.rs` → `move_to_path` | 有 `location_for_path` → 立刻选区滚动；否则 `pending_scroll` |
| 注册正文 | `register_buffer` → `update_excerpts_for_path(hunk ranges, context_lines)` | **只挂有 hunk 的范围** |
| 后台灌入 | `branch_diff::load_buffers` + `refresh` 循环 + `yield_now` | 并行轻量任务；register 时让出主线程 |
| 无 hunk | excerpt 列表为空 | **正文不出现该 path**（侧栏仍在） |

DiffsHub（`usePatchLoader` 批 stream）**仅**可作「批 publish / 主线程 work budget」工程灵感，**不得**再定义为 SCM 体感标杆。

---

## 2. 目标架构

### 2.1 逻辑分层（Zed 同构）

```
L1 Index / 侧栏（全量轻）
   path · status · group · sectionKey · oldPath
   additions/deletions/binary? · bodyClass（§3）
        │ 永不阻塞点击
        │
        ├──────────────────────────────────────────┐
        ▼                                          ▼
L2a 正文资格投影                              L2b 重路径（例外）
   content-bearing slots only                  单文件 hydrate /
   序 = index 稳定序                            超大文件 / 显式「查看文件」
        │                                          │
        ▼                                          │
L3 连续多文件表面（Z1/Z2：Pierre 多 item；Z3：可选 MultiBuffer）
   仅 L2a 成员；挂 hunk/真 patch 摘录             │
        │                                          │
        └──────── pending_scroll 解析 ◄────────────┘
```

### 2.2 与旧架构的关系

| 旧 | 新 |
|---|---|
| 全 `sectionKey` → CodeView estimate 账本 | **侧栏**全量；**正文**仅 `bodyClass = content`（及显式 pin） |
| demand 决定「像不像有内容」 | demand **只**服务 content 槽的重读；无内容槽 **永不**进 loader 队列 |
| 导航 = 等 document | 导航 = scroll / pending_scroll |
| 并发 2 = 产品体验 | 并发 cap = 工程闸；Z2 主路径改为 bulk/hunk 管道 |

---

## 3. 正文成员资格（Body Class）

### 3.1 分类（index 可判定则 index 判定；不得等 document）

每个 `renderSlot` 进入下列之一（单一函数，main 与 renderer 同源或 renderer 纯函数消费 index 字段）：

| `bodyClass` | 条件（v1） | 侧栏 | 正文默认 | materialize 默认 |
|---|---|---|---|---|
| **`content`** | 文本变更：非 binary，且 **已知** `(additions+deletions) > 0`，或 status ∈ {modified, added, deleted, conflicted} 且 **未**证明为空 | 有 | **进入**正文流 | 可按 Z1/Z2 策略加载 |
| **`notice`** | binary / submodule / 明确无文本 patch 但需一行说明 | 有 | **可选**：固定矮 notice 行（≤ 1 header 高），或 **默认不进正文**（产品默认：**不进**，侧栏可看状态） | **禁止**走完整 patch document |
| **`meta`** | **pure rename**（status=renamed 且 additions=0 且 deletions=0，或 rename 且无 numstat 行变更）；**empty**（additions=0∧deletions=0 的非 conflict 文本） | 有 | **默认不进正文** | **禁止**进重队列 |
| **`unknown`** | index 缺 numstat、无法证明 empty/content | 有 | **暂不进正文** 或 **极矮 pending 头**（禁止 12 行假 body）；后台分类任务优先 | 仅分类任务，非完整 document 优先 |

**产品默认（已确认）：** `meta` / 默认 `notice` **不出现在正文连续流**。用户在侧栏看到 rename；需要「只看重命名列表」时侧栏已足够。若未来要「正文里一行 rename 摘要」，须显式开关且高度 = header-only（0 假行）。

### 3.2 与 stable-ledger 的精确 supersede

| stable-ledger | 本文 |
|---|---|
| K1：账本 id = 全 `renderSlots[].sectionKey` | **改为**：CodeView/正文表面 id 集 = **`bodyClass=content`（+ 用户显式 pin 的 notice）**；树 id 集仍 = 全 index |
| estimate 12 行 renamed | **废除**对 `meta` 的正文档 estimate；`content` 估高仍可用 numstat / 启发式 |
| 点树：账本有 id 即可 scroll | **改为**：目标在正文有 id → scroll；仅在侧栏 → **不**假 scroll 成功；可展开 solo/说明（Z1 最小：选中侧栏高亮 + 可选 toast/空态「无文本变更」） |
| unload → 同 id estimate | 仅适用于曾是 `content` 的槽 |

### 3.3 Index 字段（Z1 必须够用）

已有（`gitReviewRenderSlotSchema`）：`additions` / `deletions` / `binary` / `status` / `oldPath`。

Z1 要求 main index **尽量填** numstat；rename 必须能区分：

- pure：`status=renamed` ∧ additions=0 ∧ deletions=0（或显式未来字段 `renameKind: pure|changed`）  
- changed：renamed ∧ (additions+deletions)>0  

缺 numstat 时：`unknown`，**禁止**当成 modified 灌 24 行 estimate。

可选 Z2 字段（非 Z1 阻塞）：`renameKind`、`hunkCount`、`bodyClass` 直接由 main 下发（单一来源，避免双端漂移）。

---

## 4. 加载模型

### 4.1 Z1 — 语义同构（P0，必达体感）

**目标：** 不换管道，先去掉「无内容占坑 + 点击等 document」。

| 项 | 行为 |
|---|---|
| 正文初始成员 | 仅 `bodyClass=content`（及策略允许的 notice） |
| Loader 队列 | **过滤** `meta` / 默认 `notice`；永不 `getReviewFileDocument` |
| `content` 加载 | 可暂保留 demand + 并发 cap，但 **seed 首屏**应对 **content 子集** 批量优先；并发下限建议 ≥ 8 或自适应（**废除「2」作为产品常数**；2 仅可作测试夹具） |
| 无 content 的仓库（纯 rename 海） | 正文空态：「N 个文件仅路径变更，见侧栏」；侧栏可点、可 stage |
| 内存 | 仍 32MiB / 20 万行 / `MAX_FULL_BODY_ENTRIES` 作用于 **content body** |

### 4.2 Z2 — 数据面同构（默认终态）

**目标：** 主路径对齐 Zed「为变更 path 算 diff，UI 只挂摘录」。

```
main:
  对 Review scope 产出「变更摘录流」
  （实现选型二选一或组合，RFC 实现时钉死）
  A) 流式 multi-file patch（类 git diff）→ 按 file 边界 parse → 批事件
  B) 每 path 轻量 hunk 列表（不含整文件无关上下文）→ 批事件
renderer:
  按 index 序把 content 块 addItems/updateItem
  主线程 work budget（灵感：DiffsHub 8ms）+ yield
  单文件完整 document 仅：显式 hydrate、超大文件、失败重试
```

约束：

- **一个逻辑刷新世代** 内不得为每个 entry 无界 spawn 子进程；允许 **有界 worker 池** 或 **单 diff 流**。  
- 批 publish 大小：工程默认 16–64 content 文件/帧（可调），**不是**「可见 2 个」。  
- demand/LRU：**卸**已加载重 body；**不**负责「用户第一次能否看到进度」。

### 4.3 Z3 — 渲染同构（可选）

评估将 Review 正文从「N 个 Pierre file item」迁到 **单表面 excerpt 模型**（更贴近 MultiBuffer）。  
仅当 Z2 仍无法满足万级 hunk 编辑性能时启动；**不阻塞** Z1/Z2 验收。

### 4.4 明确拒绝

| 拒绝 | 原因 |
|---|---|
| 保持并发 2 作为主路径并「再抠 settle」 | 无法消除排队体感 |
| 全量 estimate 卡冒充 Zed 列表 | 列表在侧栏；正文假卡制造 rename 海卡顿 |
| 打开 Review 同步 2000×`git show` | 进程爆炸 |
| 默认单文件 Review | 违反始终多文件 |

---

## 5. 导航与滚动（Zed 契约）

### 5.1 侧栏 / 树点击

```
onSelect(entryKey, sectionKey):
  selected = (entryKey, sectionKey)     // 侧栏高亮立刻
  bodyId = sectionKey 对应正文 id（若 bodyClass 允许且已在表面）

  if bodyId 且 surface.hasItem(bodyId):
    可选 expand（若 collapsed）
    scrollTo({ type: "item", id: bodyId, align: "start", behavior: "instant" })
    // 应用层默认 1 次；禁止 verify 循环 rescroll
    return

  if bodyClass 为 meta | 默认 notice:
    // 无正文块：成功完成选择；不假 scroll；不 materialize
    clear pending_scroll
    return

  // content 但尚未挂上表面
  pending_scroll = bodyId | sectionKey
  boost 该 path 的 content 加载（Z1 demand / Z2 流）
  // 禁止 navigationPending 阻塞整页交互；禁止 finishTerminal 大门闩

onBodyItemAttached(id):
  if pending_scroll == id:
    scrollTo once (instant)
    clear pending_scroll
```

### 5.2 与旧导航的废止

| 旧 | 新 |
|---|---|
| navigationPending 期间 demand 缩成仅 selected（或其它互殴变体） | **不**用 pending 改写显示集；最多 boost 优先级 |
| finishTerminal = visible + window ack + loader.settled + viewportLayoutSettled | **废止**为树导航成功条件；至多用于遥测 |
| 未 materialize 不滚 / 或滚 estimate 假大卡 | content 有真块或 pending；meta 不滚正文 |
| DiffsHub smooth 为唯一行为 | 默认 **instant**（IDE 定位）；设置项可后加 |

### 5.3 滚动单写者

保留 full-alignment 精神：**禁止** membership 写 `scrollTop` 与 `scrollTo` 并行双意图。  
正文成员变化时：上方 content 高度变化对 **userScrolling** 做锚点补偿；**pending_scroll 消费**只触发一次应用层 scrollTo。

---

## 6. 折叠 / 空态 / 工具条

| 状态 | Chevron | Hunk 工具条 | 高度 |
|---|---|---|---|
| content · loading | 可按现规则；**禁止** collapsed 冒充 loading | 无 | 估高用 numstat，禁止 rename 默认 12 |
| content · loaded · 有行 | 可折叠 | 有（可写时） | 真几何 |
| content · loaded · 0 行 | **禁用** expand；**强制 collapsed 或降级 notice** | 无 | header-only |
| meta（不在正文） | — | — | — |
| 正文空（全 meta） | — | — | 空态文案，非假列表 |

---

## 7. Stage / 刷新 / soft-retain

| 能力 | 约束 |
|---|---|
| file / hunk stage | **保留**；仅存在于 content（及未来 notice）正文块；侧栏 stage 不依赖正文在场 |
| index 刷新 | 重算 `bodyClass`；meta→content 时 **进入**正文流并挂 pending 若仍选中；content→meta 时 **移出**正文（soft-retain 规则：可短暂保留再卸） |
| soft-retain | 仅 content body；与 07-25 一致 |
| session cache | 可缓存 content body；**禁止**把 meta 缓存成假 loaded 大卡 |

---

## 8. 性能与红线

| 红线 | 要求 |
|---|---|
| 子进程 | 禁止 O(entries) 无界并行 Git；Z2 用流或有界池 |
| 内存 | content body 32MiB / 20 万行 / `MAX_FULL_BODY_ENTRIES` |
| 主线程 | 单帧解析/投影有 work budget；长任务 >100ms 为失败（沿用既有夹具精神） |
| 2001 文件 | 侧栏可滚动；正文仅 content 子集；纯 rename 2001：**正文空态 + 侧栏可用**，**禁止** 2001 次 document |
| 并发常数 | **删除产品语义上的「必须为 2」**；实现默认提高；测试可注入 |

---

## 9. 验收（DoD）

### 9.1 场景（手工 + 自动化）

| ID | 场景 | 通过标准 |
|---|---|---|
| **S1** | 1000 pure rename staged，0 content | 打开 Review < 目标阈值可交互；**零** `getReviewFileDocument`（或探针 materializeCount=0）；正文空态；侧栏 1000 行可滚可 stage |
| **S2** | 混合：50 content + 500 pure rename | 正文 **仅** 50 content 块；rename 不在正文高度累加 |
| **S3** | 点侧栏已加载 content | 应用层 scrollTo ≤1；选中到 header 贴顶；无整页 pending 门闩 |
| **S4** | 点侧栏 content 未附着 | pending_scroll；附着后 ≤1 次 scroll；期间可继续点其它行 |
| **S5** | 点 pure rename | 侧栏选中；**不** enqueue document；**不**假 scroll 成功 |
| **S6** | content 文件 stage hunk | 行为与现网一致；不回归 soft-retain |
| **S7** | binary | 不进重 patch 队列；侧栏可见 |

### 9.2 探针（机测）

| 探针 | 含义 |
|---|---|
| `bodyMemberSectionKeys` | 正文表面 id 集 |
| `bodyClassBySectionKey` | 分类结果 |
| `materializeEnqueueCount` / `documentLoadCount` | 重路径次数 |
| `scrollToCount`（导航事务） | ≤1（+ 禁止 verify 循环） |
| `pendingScrollPath` | 当前 pending |
| `navigationGateBlocked` | 必须恒为 false（废止大门闩后） |

### 9.3 非目标（本设计不验收）

- DiffsHub 评论、GitHub PR 流  
- Z3 MultiBuffer 性能对比  
- 把侧栏改成 Zed 像素级 UI 复制  

---

## 10. PR 切片

| PR | 名称 | 完成定义 |
|---|---|---|
| **Z0** | 本文合入 + 交叉 supersede 指针（stable-ledger / full-alignment / polish 文首） | 文档与治理测锁定 K1–K9、§3 表 |
| **Z1a** | `bodyClass` + 正文成员过滤 + rename/empty/binary 不进队列 | S1/S2/S5/S7 绿 |
| **Z1b** | 导航 pending_scroll；废止 finishTerminal 主路径；提高 content 并发 | S3/S4 绿 |
| **Z1c** | 正文全 meta 空态文案 i18n；chevron/0 行强制 | 文案与治理 |
| **Z2a** | main 变更摘录流 / 批事件契约 | 契约 + unit |
| **Z2b** | renderer 消费批流；demand 降为 LRU/重试 | S1 在「有少量 content」下仍不卡；首屏批灌 |
| **Z3** | （可选）excerpt 表面 RFC | 单独决策 |

**禁止：** Z0 前再合「只改 emptyReady」当完结；Z1 未完成时开 Z3。

---

## 11. 风险与开放点

| 风险 | 缓解 |
|---|---|
| 用户期望「正文里也能扫到 rename」 | 空态说明 + 侧栏为权威；可选后续 header-only 行 |
| numstat 缺失 → unknown 过多 | main 必填 numstat；unknown 矮头 + 优先分类 |
| 半套 stable-ledger 与 body 过滤冲突 | Z0 文首 supersede；投影单测锁 id 集公式 |
| stage 乐观更新 path 在 meta/content 间跳 | index 代际 + bodyClass 重算；测 S6 |
| Z2 选型 A/B | 实现 PR 前 spike：stream patch vs hunk list 延迟/内存 |

开放（不挡 Z1）：

1. Z2 确切 Git 命令与取消/世代围栏形状  
2. notice 是否允许用户设置「显示在正文」  
3. Z3 是否复用编辑器 MultiBuffer 概念或自研  

---

## 12. 确认记录

| 日期 | 结论 |
|---|---|
| 2026-07-31 | 产品确认：体感标杆 **Zed**；**写 design**；Z1 语义同构 → Z2 数据面终态 → Z3 可选 |
| 2026-07-31 | 确认「一个一个 document 加载」非标准；**废止** demand=2 作为主体验模型 |

---

## 13. 一句话

> Pier Git Review = **Zed 式侧栏 + 仅 content 的连续正文 + 点击定位（pending_scroll）**；  
> 重 document 与 demand 只服务 content 例外路径；  
> pure rename 海必须在 **Z1** 即可用、不卡、不进正文假卡。

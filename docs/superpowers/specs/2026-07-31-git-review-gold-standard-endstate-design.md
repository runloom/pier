# Git Review 金标准终态方案（一次性闭环）

日期：2026-07-31  
状态：**产品已确认（2026-07-31）** — **SCM Review 终态唯一权威**。  
体感、加载、渲染、导航、失败态、骨架 UI、验收一体定义；**禁止**症状补丁或「先合半套」当结案。

产品硬约束（继承，不得用本文开脱）：

- **始终多文件** Review 表面（禁止 Codex 式「整页只开一个文件」作为默认）。
- 保留：hunk/file stage、双槽 `sectionKey`、session cache、soft-retain、failure settled-only、树 delta、index 无文件数产品上限。
- Pierre CodeView 为渲染引擎；**禁止**「每个 index entry 一张假高度 estimate 卡 + 低并发 document 排队」写成终态体验。

### 文档层级（冲突时）

| 文档 | 角色 | 与本文关系 |
|------|------|------------|
| **本文** | **终态唯一权威**：体感 + 加载 + 渲染 + 导航 + 失败 + 骨架 + DoD | 权威 |
| `2026-08-02-git-review-live-update-failure-contract-design.md` | **背景刷新零打断 + 失败分级 + 反馈通道** | **live-update / 全局 toast 契约**；与本文冲突时体感仍以本文为准，**失败通道与「背景路径 toast=0」以该文为准** |
| `2026-07-31-git-review-zed-feel-design.md` | Zed 体感与 bodyClass 骨架 | **被本文吸收**；细节冲突以本文为准 |
| `2026-07-27-git-review-stable-ledger-design.md` | content 槽几何 / LRU | **仅**适用于本文允许进入正文的 content 槽 |
| `2026-07-27-diffshub-full-alignment-design.md` | scroll 单写者、CodeView 单实例 | 引擎层保留；**SCM 体感不以 DiffsHub 为准** |
| `2026-07-25-git-review-codeview-endstate-design.md` | 真正文、soft-retain、stage、failure | 仍有效；显示集以本文 bodyClass 为准；失败面细节见 2026-08-02 契约 |
| `docs/superpowers/evidence/diffs-upstream-api-verification.md` | Pierre/DiffsHub 上游 API 冻结 | 引擎集成证据 |

**实现禁令：** 未对照本文时，禁止再合「只调骨架 CSS / 只改 CodeView lineDiffType / 只调 demand 并发 / finishTerminal」类症状补丁充当终态。  
**里程碑：** PR 可切片，但 **G0–G6 全绿前不得宣称 Review 已金标准**。

---

## 0. 一句话终态

> **侧栏 = 全量 index（Zed GitPanel）；正文 = 仅 content-bearing 真变更（Zed MultiBuffer excerpts）；Pierre CodeView = DiffsHub 级虚拟化渲染器；加载永不靠「全量 estimate 假卡」伪装进度；任何失败在 T 秒内变成明确终态，禁止永久 spinner。**

---

## 1. 标杆对照

### 1.1 DiffsHub / Pierre（引擎层）

依据：Pierre《On Rendering Diffs》、DiffsHub Viewer、`diffs-upstream-api-verification.md`。

| 能力 | DiffsHub / CodeView | Pier 终态用法 |
|------|---------------------|---------------|
| 列表身份 | 文件进 CodeView，可估高 | **只对 content 槽**建 item；禁止全 index 假 estimate 海 |
| 虚拟化 | Inverse sticky、估高 + 实测 delta、自管 scroll anchoring | 原样依赖 Pierre；宿主不双写 `scrollTop` |
| 高亮 | **Deferred plain → worker Shiki** | 同构；**plain 必须可独立成功** |
| 配置 | options + Worker renderOptions | **单源** `PierDiffRenderProfile` |
| 流式批 publish | patch stream | Z2 加载灵感，**不是**侧栏模型 |
| stage | 无 | Pier 在 content 块上叠 stage |

DiffsHub 解决 **「任意大 patch 怎么画」**，不是 **「本地 SCM 谁进正文」**。

### 1.2 Zed Project Diff（SCM 体感层）

| 能力 | Zed | Pier 终态 |
|------|-----|-----------|
| 侧栏 | 全量 status，点击不阻塞 | 全量 index 树，选中即时 |
| 正文 | 仅 hunk excerpt；**0 hunk → 0 正文块** | pure rename / empty / binary **默认不进正文** |
| 定位 | 有 location 立刻 scroll；否则 `pending_scroll` | 同构；禁止 settle 大门闩 |
| 加载 | path 级摘录批量进 MultiBuffer | **Z2 批摘录为默认终态**；document 仅例外 |
| 进程 | 非 O(n) 无界 git | 有界池 / 单流 |

### 1.3 标杆分工（钉死）

```
SCM 产品体感  ──►  Zed Project Diff
渲染引擎能力  ──►  DiffsHub / @pierre/diffs CodeView
本地 Git 语义 ──►  Pier（stage / hunk / 双槽 / soft-retain）
```

---

## 2. 病理（为何会出现「永远加载 / 灰条 / 炸栈」）

三类症状是 **同一错误产品模型** 的不同出口：

```
错误模型：
  每个 index slot → CodeView item（estimate 假高）
  → 有界 document 排队
  → 成功才 loaded；失败/投影空常回落 estimate
  → 渲染再 word-alt decorations 可 Shiki 炸

出口：
  A 灰条丑/贴边     = estimate 是主 UI
  B Shiki 栈        = loaded 后高亮死
  C 永久 spinner    = 从未变成 loaded/error/notice，或 meta 不该进正文
```

**半套 DiffsHub 全量 estimate 账本 + 半套 document 水合** 必须一次切齐为本文模型。

---

## 3. 终态架构

```
┌─────────────────────────────────────────────────────────────┐
│ L1 Index（全量轻）                                            │
│ path · status · group · sectionKey · oldPath                 │
│ additions/deletions/binary · bodyClass（main 优先下发）       │
│ 侧栏唯一数据源；点击永不 await document                       │
└───────────────┬─────────────────────────────┬───────────────┘
                │                             │
                ▼                             ▼
┌───────────────────────────┐   ┌─────────────────────────────┐
│ L2a 正文资格（content）    │   │ L2b 重路径（例外）            │
│ bodyClass = content       │   │ 超大 / 显式完整文件 / 重试   │
│ + 可选 pin notice         │   │ 单文件 getReviewFileDocument │
│ 序 = index 稳定序          │   │ 永不服务 meta 默认路径       │
└─────────────┬─────────────┘   └──────────────▲──────────────┘
              │ 批摘录 / 有界 hydrate            │
              ▼                                 │
┌───────────────────────────────────────────────┴─────────────┐
│ L3 连续多文件表面（Pierre CodeView 单实例）                    │
│ 成员 id 集 = L2a 仅 content（非全 index）                     │
│ 槽态：pending | loaded | error | notice                      │
│ plain 先成功 → 可选 highlight；配置单源安全默认                 │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. bodyClass（进入正文的唯一闸门）

| class | 条件（index 可判定） | 侧栏 | 正文 | materialize |
|-------|----------------------|------|------|-------------|
| **content** | 非 binary，且 (add+del)>0；或 modified/added/deleted/conflicted 且未证明 empty | 有 | **进入** | 主路径 |
| **meta** | pure rename（renamed ∧ add=0 ∧ del=0）；empty 文本 | 有 | **不进** | **禁止** |
| **notice** | binary / submodule 等 | 有 | **默认不进** | **禁止** 完整 patch |
| **unknown** | 缺 numstat | 有 | **不进**（可极矮 pending 头，禁止大骨架） | 仅分类 |

**硬规则**

1. 正文 CodeView **id 集 = content（+ 显式 pin）**。
2. pure rename 海：正文空态 + 侧栏可滚可 stage；**对 meta 的 `documentLoadCount` 必须为 0**。
3. `classifyReviewSlotBodyClass` **必须**过滤投影与 loader 队列（废止「只估高不剔除」）。
4. main index **尽量填 numstat**；rename 必须能区分 pure vs changed。

---

## 5. 槽态机（content 槽）

| 态 | UI | 含义 |
|----|-----|------|
| **pending** | 拟真骨架 + 可选轻 spinner | 已在加载管道中 |
| **loaded** | 真 diff | 稳态成功 |
| **error** | 可读失败 + 重试 | 稳态失败 |
| **notice** | 说明卡（非灰条） | 无文本可展示 |

**禁止**

- 用 pending/estimate 表示「不知道错了」
- demand 外永久 pending
- `resource.kind=loaded` 但投影 0 item 时静默回落 pending

**超时（钉死）**

- content 且进入 demand/种子后 **默认 8s** 仍无 loaded/error → **强制 error**（可配置）
- 重试重置计时

**状态迁移**

| 从 → 到 | 触发 |
|---------|------|
| （content 入正文）→ pending | 拓扑出现且需正文 |
| pending → loaded | materialize / 批摘录 ok |
| pending → notice | 证明无文本 patch 但需说明 |
| pending → error | materialize fail 或超时 |
| loaded → pending | body LRU 卸正文（同 content id） |
| loaded → error | 再 materialize 失败且策略替换（默认 settle 前保留旧 loaded） |
| error → loaded | 重试成功 |
| * → 删除 | 仅 index 不再含该 sectionKey（soft-retain remap 除外） |

---

## 6. 加载终态

### 6.1 Z2 = 默认产品终态

```
main：有界变更摘录管道（实现前 spike 钉死主路径）
  A) 分代 multi-file git diff 流 → 按文件边界切 → 批事件
  B) path 级 hunk 列表批事件
renderer：按 index 序批 addItems/updateItem（16–64 content/帧 + work budget）
单文件 document：仅超大 / 失败重试 / 显式「完整文件」
```

约束：

- 一个逻辑刷新世代内禁止 O(entries) 无界 git 子进程
- 批大小默认 16–64，**不是**「可见 2 个」
- demand/LRU 只卸重 body，不负责「第一次能否看见进度」

### 6.2 Z1（仅允许作为合入途中的工程台阶，不得对外称终态）

- 可暂用 `getReviewFileDocument`，但 **队列仅 content**
- 并发默认 **≥ 8**（废除产品语义并发 2；2 仅测试夹具）
- seed 只对 content 子集
- **里程碑完成前必须落地 Z2，或证明 S1–S9 在 Z1 已全部满足且 changelog 写明 Z2 未完成风险** —— 默认要求 **G5 进同一里程碑**

### 6.3 明确拒绝

| 拒绝 | 原因 |
|------|------|
| 全量 estimate 卡当进度条 | 制造 rename 海卡顿 |
| 并发 2 作主体验 | 排队取号体感 |
| 打开 Review 同步 2000× git | 进程爆炸 |
| 默认单文件 Review | 违反始终多文件 |

---

## 7. 导航终态（Zed pending_scroll）

```
onSelect(entryKey, sectionKey):
  侧栏选中立刻
  if bodyClass 为 meta | 默认 notice:
    clear pending_scroll; return   // 不 materialize；不假 scroll
  if content 已在表面:
    可选 expand
    scrollTo({ type: "item", id, align: "start", behavior: "instant" })  // 应用层 1 次
    return
  pending_scroll = id
  boost 该 content 加载
  // 禁止 navigationPending 阻塞整页；禁止 finishTerminal 大门闩

onBodyItemAttached(id):
  if pending_scroll == id:
    scrollTo once (instant)
    clear pending_scroll
```

| 旧 | 新 |
|----|-----|
| navigationPending 缩 demand | 最多 boost 优先级 |
| finishTerminal = 跳转成功 | **废止**；至多遥测 |
| 未 materialize 不滚 / 滚假大卡 | content 有块或 pending；meta 不滚正文 |
| DiffsHub smooth 唯一 | 默认 **instant**（IDE 定位） |

**滚动单写者：** 禁止 membership 写 `scrollTop` 与 `scrollTo` 并行。

---

## 8. 渲染终态（DiffsHub deferred + 安全）

### 8.1 配置单源

```ts
// 概念：PierDiffRenderProfile（实现名可调整）
{
  lineDiffType: "none",  // 安全终态；word 高亮须单独 RFC
  preferredHighlighter: "shiki-wasm",
  theme, themeType, tokenizeMaxLength, ...
}
```

**必须同时写入：**

1. CodeView `options`
2. Worker 构造 `highlighterOptions`
3. 每次 `setRenderOptions`（含 theme 同步；**禁止只传 theme 保留旧 word-alt**）

治理测试锁定三处字符串一致。

### 8.2 行为

| 项 | 终态 |
|----|------|
| 首屏可读 | plain AST 成功即可读 |
| highlight 失败 | **不得**掀翻已成功 plain；该 item → error 或降级 plain 稳态 |
| Shiki `Invalid decoration position` | 目标计数 **0** |
| 整页只露 Pierre error-stack | **禁止**；必须产品 error/notice |

### 8.3 pending 骨架 UI（仅 content·pending）

| 常量 | 值 |
|------|-----|
| 行数 | 5 |
| 条高 | 14px |
| 间距 | 10px |
| 左 padding | 48px（gutter） |
| 右 padding | 20px |
| 宽度错落 | 96% / 72% / 88% / 54% / 78% |
| 实现 | shadow 内真实 DOM + padding（禁止 host `::after` 画条） |
| 外层 `ReviewLoading` | **同几何** |
| 槽高常量 | 单源，与 seed 估高一致 |

meta **不出现** 此骨架。

---

## 9. Stage / 刷新 / soft-retain

| 能力 | 约束 |
|------|------|
| file / hunk stage | **保留**；仅 content（及 pin notice） |
| 侧栏 stage | 不依赖正文在场 |
| index 刷新 | 重算 bodyClass；meta→content 进入正文；content→meta 移出 |
| soft-retain | 仅 content body |
| session cache | 可缓存 content；禁止把 meta 缓存成假 loaded 大卡 |

---

## 10. 性能红线

| 红线 | 要求 |
|------|------|
| 子进程 | 禁止 O(entries) 无界并行 Git |
| 内存 | content body 32MiB / 20 万行 / `MAX_FULL_BODY_ENTRIES` |
| 主线程 | 单帧 work budget；>100ms long task 为失败信号 |
| 2001 pure rename | 正文空态 + 侧栏可用；**禁止** 2001 次 document |
| 并发 | 删除产品「必须为 2」 |

---

## 11. 实现切片（一个终态里程碑）

切片仅为 PR 可合并；**G0–G6 全绿 = 金标准交付**。中间 PR 可合 main，但不得宣称终态完成。

| PR | 内容 | 完成即达 |
|----|------|----------|
| **G0** | 本文合入；交叉 supersede 指针；治理测锁定禁令与 K 决策 | 文档权威 |
| **G1** | bodyClass 过滤正文 + loader；meta/notice 不入队；纯 rename 空态 i18n | S1/S2/S5/S7 |
| **G2** | pending UI 金标准 + 8s 超时→error；禁止失败回落 pending | S9；无永久 spinner |
| **G3** | `PierDiffRenderProfile` 单源 + plain 失败隔离 + decoration 错误 0 | S8 |
| **G4** | pending_scroll 导航；废止 settle 门闩 | S3/S4 |
| **G5** | Z2 批摘录主路径（默认） | 无「逐文件取号」体感 |
| **G6** | e2e 全表 + 探针 | 防回归 |

**禁止：** G1 前再合「只改 emptyReady」；G2 未完成宣称「加载修好了」；G3 未完成打开 word-alt；G5 未完成宣称金标准。

---

## 12. 验收 DoD

### 12.1 场景

| ID | 场景 | 通过标准 |
|----|------|----------|
| **S1** | 1000 pure rename | 交互目标时间内可操作；meta **0** document；正文空态；侧栏可滚可 stage |
| **S2** | 50 content + 500 rename | 正文 **仅** 50 content 块 |
| **S3** | 点已附着 content | 应用层 scrollTo ≤1；header 贴顶 |
| **S4** | 点未附着 content | pending_scroll；附着后 ≤1 scroll；期间可点其它行 |
| **S5** | 点 pure rename | 不 enqueue document；不假 scroll |
| **S6** | content stage hunk | 不回归 soft-retain |
| **S7** | binary | 不进重 patch 队列 |
| **S8** | 曾 Shiki 炸文件 | decoration 错误 0；有正文或 error |
| **S9** | content 加载失败 / 卡住 | ≤8s → error+重试，非永久骨架 |

### 12.2 探针

| 探针 | 含义 |
|------|------|
| `bodyMemberSectionKeys` | 正文表面 id 集 |
| `bodyClassBySectionKey` | 分类 |
| `documentLoadCount` / `materializeEnqueueCount` | 重路径次数；meta 必须 0 |
| `scrollToCount`（导航事务） | ≤1 |
| `pendingScrollPath` | 当前 pending |
| `pendingAgeMs` / `forcedErrorCount` | 超时强制 error |
| `shikiDecorationErrorCount` | ≡ 0 |
| `renderProfileConsistency` | 三处 lineDiffType 一致 |
| `navigationGateBlocked` | 恒 false |

### 12.3 非目标

- DiffsHub 评论、GitHub PR 流
- Z3 MultiBuffer（可选后续 RFC，不阻塞本里程碑）
- 侧栏像素级复制 Zed

---

## 13. 明确拒绝清单

1. 全 index estimate 卡当进度条  
2. 并发 2 当产品体验  
3. 失败静默回落 pending/estimate  
4. 只改 CodeView 不改 Worker 的「半安全」  
5. DiffsHub 当 SCM 体感标杆  
6. 默认单文件 Review  
7. O(entries) 无界 git  
8. 「先发骨架/开关 PR，水合以后再说」当结案  
9. 未做 decoration 安全前恢复 word-alt  

---

## 14. Key Decisions 汇总（已确认）

| # | 决策 |
|---|------|
| K1 | 体感标杆 = Zed；引擎标杆 = DiffsHub/Pierre |
| K2 | 侧栏 ⊥ 正文；正文仅 content-bearing |
| K3 | meta/默认 notice 不进正文、不占重队列 |
| K4 | pending_scroll 定位；禁 settle 门闩 |
| K5 | Z2 批摘录为默认加载终态；document 为例外 |
| K6 | 槽态 pending/loaded/error/notice；8s 超时强制 error |
| K7 | 渲染配置单源；默认 lineDiffType=none |
| K8 | pending 骨架仅 content；真实 DOM 几何单源 |
| K9 | 始终多文件；进程/内存红线保留 |
| K10 | G0–G6 同一里程碑；可机测 DoD |

---

## 15. 风险

| 风险 | 缓解 |
|------|------|
| 用户期望正文扫 rename | 空态说明 + 侧栏权威；可选后续 header-only 须显式开关 |
| numstat 缺失 → unknown 过多 | main 必填 numstat；unknown 不灌大骨架 |
| Z2 选型 A/B | G5 前 spike 钉死一种主路径 |
| 半套 stable-ledger 与 body 过滤冲突 | 投影单测锁 id 集 = content only |
| stage 在 meta/content 间跳 | index 代际 + bodyClass 重算 + S6 |

开放（不挡里程碑主体，但 G5 前须关闭选型）：

1. Z2 确切 Git 命令与取消/世代围栏  
2. notice 是否允许用户设置「显示在正文」  
3. Z3 是否启动（默认否）

---

## 16. 总结

| 问题 | 答案 |
|------|------|
| 架构错了吗？ | **半套模型错了**；零件（CodeView/demand/ledger）可留，组装必须 = Zed 体感 + DiffsHub 引擎 |
| 一次解决？ | bodyClass 闸门 + 槽态三分 + 超时 error + 渲染单源 + pending_scroll + Z2 批加载 + e2e，**同一里程碑 G0–G6** |
| DiffsHub | 虚拟化、plain-first、Worker、单实例 updateItem |
| Zed | 侧栏⊥正文、0 hunk 不进正文、pending_scroll、摘录而非假卡海 |

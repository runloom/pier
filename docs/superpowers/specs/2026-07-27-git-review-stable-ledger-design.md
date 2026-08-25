# Git Review：稳定高度账本（路线 A）

日期：2026-07-27  
状态：**部分 supersede（2026-07-31，导航 Commit 2026-08-14）** — **终态唯一权威** 为  
[`2026-07-31-git-review-gold-standard-endstate-design.md`](./2026-07-31-git-review-gold-standard-endstate-design.md)。  
树跳转钉住见 [`../../archive/superpowers/specs/2026-08-14-git-review-tree-nav-pin-design.md`](../../archive/superpowers/specs/2026-08-14-git-review-tree-nav-pin-design.md)（K6b 第二次 scroll 仅目标自身 estimate→正文）。  
**SCM 体感 / 正文成员资格 / 点击定位 / 加载主路径** 以金标准为准（zed-feel 为细节补充）。  
本文仍管辖：**已进入正文表面的** content 槽之高度编码、pending→loaded 几何、body LRU 字节/行闸。  
**废止作体验模型：**「凡 index `sectionKey` 必进 CodeView 全量 estimate 账本」（见金标准 / zed-feel §0 K2、§3）。  
产品约束：**始终多文件** Review 表面；**禁止** Codex 式大 diff 单文件降级。

### 文档层级（冲突时）

| 文档 | 角色 | 与本文关系 |
|---|---|---|
| `2026-07-31-git-review-gold-standard-endstate-design.md` | **终态唯一权威** | **冲突时以金标准为准**；正文 id 集 = content-bearing |
| `2026-07-31-git-review-zed-feel-design.md` | Zed 体感与 bodyClass 细节 | 被金标准吸收 |
| `2026-07-25-git-review-codeview-endstate-design.md` | 真正文、soft-retain、stage、failure | **§3.1 禁「假 patch 槽」仍成立**；**§4「仅 loaded 进 CodeView」整段作废**，改由本文再经金标准收紧 |
| `2026-07-27-diffshub-full-alignment-design.md` | demand 调度、scroll 单写者 | demand 形状降为重路径；**SCM 导航以金标准为准** |
| `2026-07-27-diff-view-lifecycle-design.md` | remount / 常量 | **`MAX_CODEVIEW_MEMBERS` 作「id 上限」作废**；见本文 §4.4 |
| `2026-07-27-git-review-virtual-scroll-reading-stability-design.md` | pin / ReadingSession | **降为辅助**；禁止 cap 裁 id / collapsed 伪加载作主路径 |
| **本文** | **content 槽高度坐标系 + pending 编码 + 正文 LRU** | 仅适用于金标准允许进入正文的成员 |

**保留且不得破坏：** hunk/file stage、双槽 sectionKey、session cache、soft-retain、failure settled-only、始终多文件。

### 废止对照（实施必删/改职责）

| 旧符号 / 行为 | 新职责 | 删除/改写 PR |
|---|---|---|
| `selectCodeViewMemberEntryKeys` → 投影 id 集 | **禁止**喂投影；可拆为 `selectBodyHydrationPriority`（仅 loader 优先级） | A1 断投影链；A4 删旧名 |
| `isCodeViewMemberResource` 决定「能否进投影」 | 仅「能否挂 **loaded 正文** / annotations」 | A1 |
| `GIT_REVIEW_MAX_CODEVIEW_MEMBERS` 裁 id | **删除该常量名**；正文个数改 `MAX_FULL_BODY_ENTRIES`（退 estimate，不删 id） | A1/A2 |
| 导航「无 loaded 不 scroll」 | 账本有 sectionKey 即可 scrollTo | A3 |
| virtual-scroll「collapsed header-only 骨架」 | **禁止**；改 estimate 槽 | A0/A1 |
| `placeholderFileDiff` / `patch:null` 作未加载 | **禁止**作 estimate；estimate 用独立工厂 | A1 |

---

## 0. 决策摘要（Key Decisions）— 产品已确认

| # | 决策 | 理由 |
|---|---|---|
| K1 | **高度账本 id 集 = index 全部 `renderSlots[].sectionKey`**（公式见 §3.4） | DiffsHub 几何前提 |
| K2 | 槽态：`estimate` \| `loaded` \| `error` \| `ready-notice`；**unload 不删 id** | 坐标系单调 |
| K3 | 禁旧 placeholder 语义（`patch:null` 假折叠 / loading=collapsed / 对空 id scroll 当成功） | 历史 bug；**≠ 禁估高槽** |
| K4 | demand **只调度读**；不决定有没有 id | full-alignment K3 正解 |
| K5 | 正文 **32 MiB / 20 万行** + **`MAX_FULL_BODY_ENTRIES`（必选）** 限制 loaded 个数；超额 → estimate | 内存闸门打在重资产 |
| K6 | 树导航：**恰好 1 次**应用层 `scrollTo`，**一律 smooth**（对齐 DiffsHub ReviewUI；远近耗时一致）；verify **maxRescroll=0**；body 水合不二次硬跳 | 单意图 + 体感 |
| K6b | 导航 pending 禁 membership/`scrollTop` 双写；**目标自身** estimate→loaded 优先 **引擎 preserveAnchor**；若引擎无法保锚，允许 **恰好 1 次** 应用层 corrective `scrollTo`(instant)。**verify 轮询 rescroll 仍为 0**。探针：`scrollToCount` = 首次导航 + 至多 1 次 K6b 校正（事务内 ≤2，且第二次仅因目标自身增高） | 贴顶与增高 |
| K7 | 虚拟化只少画；**不得**少 id 冒充少内存 | — |
| K8 | 验收用可机测探针，不以体感句代替 | 防假绿 |
| K9 | **per-slot 变更行数提示**为估高一等公民（index 能算则必填）；缺省才用默认 k 行 | 累计高误差可控 |
| K10 | 宿主投影层 id **全量**；向 Pierre **允许分帧** `addItems`/增量 reconcile（首帧须含 seed∪selected） | 大 N 不卡死主线程 |
| K11 | v1 **禁止**窗口化账本 / 稀疏回退；超 `LEDGER_SOFT_WARN` 仅提示，须新 RFC 才能改几何模型 | 堵假对齐退路 |

---

## 1. 问题与为何必须是 A

### 1.1 用户体感（产品语言）

1. 点树一次到位，header 贴顶，无沉底再跳。  
2. 滚动连续，无「到位后列表文件集合一直在换」。  
3. 阅读中邻文件 load / 刷新 / stage 不扯垮坐标系。  
4. 始终多文件。

### 1.2 根因

稀疏 **loaded 子集** = 可变高度账本；控制面（sticky/pin/demand）无法等价 DiffsHub。

### 1.3 对照

| | DiffsHub | 错误 Pier（稀疏） | **本文 A** |
|---|---|---|---|
| 列表身份 | 文件进列表 | 仅 loaded 有界 | **全 sectionKey** |
| 未加载 | 有 item/估高 | 无 id | **estimate** |
| 点树 | scrollTo 已有 id | 未 load 不滚 | **scrollTo 已有 id** |
| 内存 | — | 砍 id | **砍正文（LRU）** |

---

## 2. 目标架构

```
L1 Index（path / status / sectionKey / insertions? / deletions? / binary?）
        │
        ▼
L2 稳定高度账本（身份集 = 全 renderSlots）
   状态：estimate | loaded | error | ready-notice
   序：group × path × sectionKey
        │
        ├─→ Pierre：可分帧灌入；虚拟化只画视口
        │
        └─ demand → L3 Body（patch+解析）≤32MiB / 20万行 / MAX_FULL_BODY_ENTRIES
                      超额：同 id → estimate（不 removeItem）
```

### 2.1 ReadingSession / pin

- **不得**决定谁在 CodeView。  
- 仅：刷新 anchor、导航 mode、userScrolling 时 **暂缓** 对视口/selected 的 body LRU。  
- `projectReviewLedger` **禁止**接收 `memberEntryKeys` 过滤参数。

---

## 3. 硬契约：槽、编码、投影

### 3.1 槽状态机（完整）

| 从 → 到 | 触发 |
|---|---|
| （index 新增槽）→ estimate | 拓扑出现 |
| estimate → loaded | materialize ok（文本 patch） |
| estimate → ready-notice | binary/submodule/无文本等 **有说明无 patch**（非 estimate） |
| estimate → error | materialize fail |
| loaded → estimate | body LRU / 代际失效卸正文 |
| loaded → error | 再 materialize 失败且策略为替换（默认 **保留旧 loaded** 直到新结果 settle，避免闪错；settled fail → error） |
| error → loaded | 重试成功 |
| error → estimate | 仅 index 代际整槽重置或显式 clear |
| * → （删除） | **仅** index 不再包含该 sectionKey（soft-retain remap 走 updateItemId，不删后重建若 1:1） |

**ready-notice：** 今日 `stateNotice` + 无文本 patch 的终态内容；**不是** estimate；固定卡高；无 hunk 工具条。

### 3.2 禁止（旧 placeholder）

| 禁止 | 原因 |
|---|---|
| `patch: null` 进 `processFile` / 当未加载 | 假折叠与 parse 污染 |
| loading / estimate 编码为 `collapsed: true` | 用户以为收起 |
| 对不存在的 id scroll 再长 verify | 主路径 id 已在账本 |
| unload 时 removeItem / 抹投影 id | 破坐标系 |
| 用 `placeholderFileDiff` 实现 estimate | 高度≈0 与语义污染 |

### 3.3 estimate → PierDiffViewItem / CodeView 映射表（A1 钉子）

| 槽态 | `PierDiffViewItem`（规范） | `processFile` | 高度来源 | annotations | presentation |
|---|---|---|---|---|---|
| **estimate** | `kind: "estimate"`；`patch` 缺省或禁止使用；`fileDisplay` 必填；**禁止**走 `placeholderFileDiff` | **否** | 见 §3.3.1 | **无** | 非 loading 转圈冒充收起；可弱「待加载」 |
| **loaded** | `kind: "loaded"` 或省略+非空 `patch` | **是** | 实测；写入 session 高度缓存 | 可有（可写 uncommitted） | 正常 diff |
| **error** | `kind: "error"` + 说明 | **否** | `ERROR_CARD_HEIGHT_PX`（钉常量） | 无 | 错误卡 |
| **ready-notice** | `kind: "ready-notice"` + `stateNotice`；无文本 patch | **否** | `NOTICE_CARD_HEIGHT_PX` | 无 | 说明行 |

**独立工厂：** `toEstimateCodeViewItem(...)` — 合成 **确定性** 几何（见下），**禁止** 调用 `placeholderFileDiff`。

#### 3.3.0 estimate → Pierre `CodeViewItem` 唯一编码（A1 硬钉子）

Pierre 高度来自 diff 行几何，无独立 `estimateHeightPx` API 时，estimate **必须**走下列**唯一**合成（禁止其它路径）：

```
estimatedBodyLines = clamp(
  fromIndexRows ?? GIT_REVIEW_DEFAULT_ESTIMATE_LINES,
  0,
  GIT_REVIEW_MAX_ESTIMATE_BODY_LINES
)
// fromIndexRows = insertions+deletions（文本）；binary 不走本工厂 → ready-notice

fileDiff: FileDiffMetadata = {
  name: path,
  type: "change",
  // 几何专用：用「空内容 + 行数」驱动 virtualizer，不进入 processFile/shiki
  additionLines: Array(estimatedBodyLines).fill(""),
  deletionLines: Array(estimatedBodyLines).fill(""),
  hunks: [{
    // 单 hunk，行数 = estimatedBodyLines，内容全 context 空行或引擎允许的最小合法 hunk
    // 实现钉：与 @pierre/diffs 可接受的 FileDiffMetadata 形状一致；单测锁定行高
    additionStart: 1, deletionStart: 1,
    additionCount: estimatedBodyLines, deletionCount: estimatedBodyLines,
    ...
  }],
  unifiedLineCount: estimatedBodyLines,  // 或与引擎字段对齐的等价字段
  splitLineCount: estimatedBodyLines,
  cacheKey: `estimate:${sectionKey}:${estimatedBodyLines}`,
  // 禁止 isPartial 表示 loading；禁止 collapsed 默认 true
}
CodeViewItem = { type: "diff", id: sectionKey, fileDiff, version, annotations: undefined }
```

| 规则 | 要求 |
|---|---|
| 入口 | **仅** `toEstimateCodeViewItem`；`toCodeViewItem` 遇 `kind:"estimate"` 转调之，**不得** `patch===null` 分支 |
| 删除 | 估计路径删除或改名隔离 `placeholderFileDiff`（不得被 estimate 调用） |
| presentation | `kind==="estimate"` → 非 loading 转圈、非 collapsed；可弱文案「待加载」 |
| 高亮 | **不**跑 shiki / worker 高亮 estimate 槽（若引擎强制，则空行 + 禁用昂贵路径） |
| loaded 切换 | `updateItem` 换成真 `processFile` 结果；高度缓存写入实测高 |

#### 3.3.1 估高优先级（钉死）

1. Session **实测高**（key = sectionKey；`updateItemId` 时随 rename 迁移；index 无槽则 drop；generation 硬切断可整表作废）  
2. Index **per-slot** `insertions`/`deletions`（能算必填；binary → ready-notice 固定高，不走行公式）  
   - 文本估高：`header + min(MAX_ESTIMATE_BODY_LINES, insertions+deletions) * lineHeight`，再夹 `ESTIMATE_MIN_PX..ESTIMATE_MAX_PX`  
3. **`PIER_DIFF_DEFAULT_ESTIMATE_LINES = 16`**（中等骨架；行数提示有则用提示。旧「0=仅头」冷启动 Δh 过大已废止）

#### 3.3.2 常量（钉死）

| 常量 | 值 |
|---|---|
| `PIER_DIFF_DEFAULT_ESTIMATE_LINES` | **16**（中等骨架；缩小 estimate→loaded Δh） |
| `GIT_REVIEW_SEED_BATCH_MIN/MAX` | **6–24**（视口优先；旧 25–96 冷启动连环撑高） |
| `GIT_REVIEW_MAX_ESTIMATE_BODY_LINES` | **200**（行数提示夹逼） |
| `GIT_REVIEW_ESTIMATE_MIN_PX` | `DIFF_HEADER_HEIGHT_PX`（仅头） |
| `GIT_REVIEW_ESTIMATE_MAX_PX` | `DIFF_HEADER_HEIGHT_PX + 200 * lineHeight`（与上式一致） |
| `GIT_REVIEW_ERROR_CARD_HEIGHT_PX` | **72**（实现可微调但须单点常量） |
| `GIT_REVIEW_NOTICE_CARD_HEIGHT_PX` | **56** |
| `GIT_REVIEW_MAX_FULL_BODY_ENTRIES` | **128**（替代旧 members 语义） |
| `GIT_REVIEW_MAX_RETAINED_BYTES` | **32 MiB**（保持） |
| `GIT_REVIEW_MAX_RETAINED_LINES` | **200_000**（保持） |
| `GIT_REVIEW_LEDGER_SOFT_WARN` | **5000** slot（dev 警告 + 产品提示 key，**不**自动窗口化） |

### 3.4 投影公式（唯一）

```
ledgerSectionKeys =
  indexEntries.flatMap(e => e.renderSlots.map(s => s.sectionKey))
  // 无树过滤：账本 = index 全槽；半暂存双槽 = 两 id

// body 值类型（键 = sectionKey）
type LedgerBody =
  | { kind: "loaded"; patch: string; revision: string; ... }
  | { kind: "ready-notice"; noticeKey: string; ... }  // binary 等
  | { kind: "error"; message: string; retryable: boolean; ... }

projectReviewLedger(indexEntries, bodyBySectionKey: Map<sectionKey, LedgerBody>) → items[]
  对每个 renderSlot:
    // 1) index 已知非文本（status/flag）且无 body → ready-notice（不经 estimate）
    // 2) body = bodyBySectionKey.get(sectionKey)
    //    无 body → estimate
    //    loaded → loaded item
    //    ready-notice → ready-notice item
    //    error → error item
  排序：group × path × sectionKey（与今日一致）
```

**粒度：** 账本与 LRU 计数均以 **sectionKey** 为单位。同一 entry 双槽可一 loaded 一 estimate。  
若底层 document 按 entry 共享：retain 以 entry 计字节，但 **投影状态仍 per-section**；卸一个 section 的 body 时，另一槽可继续 loaded（实现可复制 section 切片或共享只读 document + per-slot 视图）。

**禁止** `projectReviewLedger(..., memberEntryKeys)` 过滤。

### 3.5 DiffView / Pierre 同步

| 事件 | API |
|---|---|
| index 增删 slot | reconcile / setItems（可分帧：先 seed∪selected∪已有 loaded，再补 estimate） |
| 同 id 正文到/卸 | `updateItem` |
| stage sectionKey 变 | `updateItemId` + 高度缓存迁移 |
| 阅读中 | **禁止**因 cap 删除仍在 index 的 id |

### 3.6 Reflow / 锚点（与 overflow-anchor:none 对齐）

容器已 `overflow-anchor: none`。必须显式策略：

| 模式 | 上方 item 高度变化 | 自身 estimate→loaded |
|---|---|---|
| **navigating** | **禁止**应用层 `scrollTop` 双写；body 更新仍 `updateItem` | 允许 **preserveAnchor（引擎）** 或 **单次** layout 校正贴目标（计入 K6b，非 verify 轮询） |
| **userScrolling** | 视口上方测高变化：**必须** delta 补偿 scrollTop 或引擎 anchor（实现二选一，A2 钉死） | 同左 |
| **idle** | 同 userScrolling | 同左 |

验收探针：上方水合后 **锚行 path+side+line 不变**（允许 1px 级误差）。

---

## 4. Demand 与正文 LRU

### 4.1 Demand 形状

无 window：seed 6–24（按 estimate 槽高估可见条数）；有 window：seed 退出主导；window ∪ 双向 lookahead ∪ 选中邻域；导航 boost selected **保留** window。

### 4.2 水合

`demand → load → bodyBySectionKey.set → updateItem(loaded|error|ready-notice)`  
id 在读之前已在账本。

### 4.3 驱逐

超 `MAX_RETAINED_BYTES/LINES` 或 `MAX_FULL_BODY_ENTRIES`：

1. 跳过：视口、selected、navigating 保护、userScrolling pin  
2. 释放 body → **同 id estimate**  
3. **不** removeItem  

### 4.4 常量语义

| 旧 | 新 |
|---|---|
| `MAX_CODEVIEW_MEMBERS` = id 上限 | **删除**；用 `MAX_FULL_BODY_ENTRIES` |
| 字节/行上限 | 保持 |

---

## 5. 导航与滚动

### 5.1 树点击

```
beginNavigation(entryKey, sectionKey)
  → boost demand + reading mode navigating
  → scrollTo({ id: sectionKey, align: "start", behavior: smooth|instant })
     // DiffsHub：在场 smooth；firstLayout instant（由 DiffView handle 默认规则）
  → 异步水合 updateItem（preserveAnchor）
  → verify：只 isVisible；maxRescrollAttempts = 0
```

- **废止**「未 materialize 不滚」。  
- index 无 sectionKey → terminal。  
- **behavior：** 对齐 DiffsHub `ReviewUI` 树点击 `smooth`；非「一律 instant」。

### 5.2 贴顶 DoD（分相位）

| 相位 | 标准 |
|---|---|
| scrollTo 返回后 2×rAF | 目标 header 与 scroller 顶 Δy ≤ `DIFF_HEADER_HEIGHT_PX`（按**当时估高**） |
| 目标 **自身** body settle 后 | 允许 K6b 一次校正后再次满足上式；**禁止** verify 循环 rescroll |

### 5.3 用户滚动

window demand 可变；**ledger id 集仅随 index 变**。

---

## 6. Hunk 工具条

| 状态 | 工具条 |
|---|---|
| estimate / error / ready-notice | 无 |
| loaded + 可写 uncommitted | 每 hunk annotation；CSS host hover 显示 |

探针：hover 时 DOM pill 数 = annotations 数。

---

## 7. 内存与大 N

| 组成 | 量级 |
|---|---|
| estimate 元数据 / 槽 | ~1–3 KB |
| 2000 槽骨架 | 数～十几 MiB 堆 |
| loaded 正文 | ≤32 MiB + ≤128 full body |
| 向 Pierre 灌入 | **分帧**（K10）；首开 2k 槽不 OOM、可 scrollTo 末槽（压测下限） |

v1 **禁止**窗口化账本。`LEDGER_SOFT_WARN=5000` 仅警告。

---

## 8. 迁移 PR

| PR | 内容 | DoD |
|---|---|---|
| **A0** | 本文 + 旧文档 supersede 头 + governance 禁「members 裁 id / placeholder 作 estimate」扫描字符串 | 交叉引用齐 |
| **A1** | estimate 类型 + **全槽投影**（断 selectMembers→投影）+ 分帧灌入 + 高度常量 | 打开 N 文件 item 数 = section 槽数；未 load 也可 getItem |
| **A2** | LRU → estimate；reflow delta/anchor | 超限不删 id；上方水合锚行稳 |
| **A3** | 导航 instant + 账本可滚；maxRescroll=0；K6b | 点树首次 instant；`scrollToCount` 按 §9（≤1 或 K6b 时 ≤2） |
| **A4** | 删旧符号/测例重写 | 无「未 load 不在 pierre-diff」假设 |
| **A5** | Hunk hover 契约 | 探针绿 |

**A1 必须含「全槽投影」**；不得拖到 A4。

---

## 9. 验收（可机测）

1. `ledgerIdSet.size === flatten(renderSlots).length`（index 不变时）。  
2. 导航事务：首次 `scrollTo` 必 instant；`scrollToCount <= 1`，或因 K6b 目标增高 `<= 2`（第二次须标注 corrective）。  
3. settle 窗口（如 500ms）：`ledgerIdSet` 对称差为空（index 未变）。  
4. `retainedBytes/Lines/fullBodyCount` 不超过上限（允许一帧回收）。  
5. 始终多文件。  
6. 探针名：**`ledgerIdSet` / `loadedBodyCount` / `retainedBytes` / `scrollToCount`**（禁止再用 membersIdSet 表示显示集）。

体感「无感知抖」**不**作唯一绿标准；以 3+ reflow 锚行探针为准。

---

## 10. 风险

| 风险 | 缓解 |
|---|---|
| 无 numstat 时估高飘 | K9：能算必填；DoD 分档 |
| 高度跳变 | §3.6 |
| 大 N 卡顿 | K10 分帧 |
| 假对齐回稀疏 | K11 + 废止表 + governance |
| stage rebind 丢高 | 高度缓存随 updateItemId |

---

## 11. 完成定义（文档）

- [x] 产品确认 K1–K11（本轮拍板：走 A）  
- [x] 交叉 supersede 写入 sibling 文首（A0）  
- [ ] A1–A5 代码落地且 §9 绿  

---

## 12. 一句话

**对齐 DiffsHub = 全 sectionKey 稳定高度账本 + 按需正文 LRU + 可证伪估高/reflow；不是稀疏 members 上调 sticky。**

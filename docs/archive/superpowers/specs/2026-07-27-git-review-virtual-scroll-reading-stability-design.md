# Git Review：多文件虚拟滚动 + 阅读稳定实施方案

日期：2026-07-27  
状态：**降级为辅助（supersede 2026-07-27）** — **高度账本 / 显示 id / 点树可滚** 以  
`2026-07-27-git-review-stable-ledger-design.md` **为准**。  
本文 ReadingSession / pin **不得**再驱动 cap 裁 id；**禁止** collapsed header-only 作未加载骨架。  
产品约束：**始终多文件 CodeView**；**禁止** Codex 式大 diff 单文件降级。

### 文档层级

| 文档 | 角色 |
|---|---|
| `2026-07-27-git-review-stable-ledger-design.md` | **显示几何与账本权威** |
| `2026-07-25-git-review-codeview-endstate-design.md` | 真正文、soft-retain、stage、failure |
| `2026-07-27-diffshub-full-alignment-design.md` | demand 调度、scroll 单写者 |
| `2026-07-27-diff-view-lifecycle-design.md` | remount / 常量（members 语义见 stable-ledger） |
| **本文** | 刷新 anchor、userScrolling 暂缓 LRU 等**辅助**；主路径不再靠稀疏 pin |

**保留且不得破坏：** hunk/file stage（Codex apply）、双槽 sectionKey、session cache、soft-retain、failure settled-only。

> **全文实施警告：** §3–§5 中 `selectCodeViewMemberEntryKeys` 驱动显示集、cap 裁 id、collapsed 骨架、未 materialize 不滚——**历史，禁止实现**。  
> 现行几何只读 **stable-ledger**。本文仅保留 ReadingSession 辅助语义时有效。

---

## 1. 目标与非目标

### 1.1 目标

1. **体感**：点树定位稳；无沉底再跳；滚动条与视口连续。  
2. **阅读不被冲**：后台 load / 邻文件 append / watch 刷新 / stage 不把用户从正在读的文件拽走。  
3. **性能**：大仓可开；DOM 与在飞读有界；**始终多文件列表 + Pierre 虚拟滚动**。  
4. **写路径**：stage/hunk 叠在稳定坐标系上，不重开导航/拓扑战。

### 1.2 非目标

| 禁止 | 原因 |
|---|---|
| Codex `largeDiff` 单文件模式 | 直接砍审阅面，用户明确拒绝 |
| 「过大无法显示、请去编辑器」作主路径 | 同上；极端 OOM 仅保留进程级防护，不产品化 |
| 换 Cursor MultiDiff / Monaco | 栈切换成本与 Pierre 投资不符 |
| DiffsHub 评论 / GitHub loadDiffFiles 全文产品 | 范围外 |
| 打开 Review 默认全仓 full diff 常驻内存 | 与 Electron 有界目标冲突 |

### 1.3 成功标准（验收摘要）

见 §9。核心：多文件始终成立 + scrollTo≤1 + pin 前缀单调 + 刷新不丢视口。

---

## 2. 问题模型

### 2.1 根因分层

| ID | 根因 | 用户感受 |
|---|---|---|
| R1 | 成员 set-swap / cap 裁掉视口前缀 | 列表跳、高度崩 |
| R2 | scrollTop 硬恢复与 scrollTo 双意图 | 沉底再跳 |
| R3 | 点树 = 改 demand + 抢滚 + 可能尚未 apply | 抖、点了没到 |
| R4 | load 完成驱动「换集」而非同 id 更新 | 读着被冲 |
| R5 | 高度账本 = 可变 cap 子集且无阅读锁 | 滚动条假/抖 |

### 2.2 性能正确解

```
性能 = 少画（虚拟滚）+ 少读（demand）+ 少 remount（单实例）
     ≠ 少展示文件（单文件模式）
     ≠ 乱裁正在阅读的前缀
```

Pierre 已提供：行/文件级虚拟化、estimate 高、离屏 placeholder、append 可 skip 整表 render。  
产品层要保证：**items 账本对「阅读坐标系」单调**，虚拟滚才能稳住。

---

## 3. 目标架构

```
┌──────────────────────────────────────────────────────────────┐
│ ReadingSession（阅读会话，新增模块）                            │
│  mode: idle | navigating | userScrolling | refreshing          │
│  selected: { entryKey, sectionKey } | null                     │
│  pinnedPrefixEntryKeys: 视口∪选中∪导航目标（有序）              │
│  readingAnchor: PierDiffViewAnchor | null（刷新恢复）           │
└────────────────────────────┬─────────────────────────────────┘
                             │ 约束成员选择
┌────────────────────────────▼─────────────────────────────────┐
│ Ledger 投影 = selectCodeViewMemberEntryKeys'                   │
│  candidates = loaded|error（真 item）                          │
│  members ⊇ pinnedPrefix（硬）                                  │
│  fill / LRU 仅 idle 且非 pin                                   │
│  输出 index 序；只 add/update/updateItemId（阅读中禁删 pin）    │
└────────────────────────────┬─────────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────────┐
│ CodeView 单实例（@pierre/diffs）                                │
│  虚拟滚动绘制；scrollTo / pendingScrollTarget                    │
│  load 完成 → updateItem(same id)；新文件 → 优先 addItems 尾部  │
└────────────────────────────┬─────────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────────┐
│ Loader（读调度 only）                                           │
│  demand = window∪lookahead∪seed∪selected boost                 │
│  不定义显示集；不得要求 Ledger 删除 pin                          │
└──────────────────────────────────────────────────────────────┘
```

### 3.1 与 DiffsHub / Cursor agent 的对应

| 概念 | DiffsHub | Cursor agent Review | 本文 Pier |
|---|---|---|---|
| 展示范围 | patch 内文件 | composer 触达文件 | **index 全树可见；CodeView=有界但 pin 稳的 ledger** |
| 高度 | 进列表即 fileDiff 估高 | before/after 全文 + Monaco | Pierre 估高；进列表须可估或骨架高 |
| 点树 | 1× scrollTo | reveal resource | 1× scrollTo + pin |
| 大 diff | 虚拟滚 | MultiDiff | **虚拟滚（禁止单文件）** |

---

## 4. 硬契约

### 4.1 ReadingSession

```ts
type ReviewReadingMode =
  | "idle"
  | "navigating"
  | "userScrolling"
  | "refreshing";

interface ReviewReadingSession {
  mode: ReviewReadingMode;
  selectedEntryKey: string | null;
  selectedSectionKey: string | null;
  /** 不可裁成员：视口 entry + selected + 导航目标（index 序） */
  pinnedPrefixEntryKeys: readonly string[];
  /** 用户阅读锚点；refresh 后优先 restore */
  readingAnchor: PierDiffViewAnchor | null;
  navigationReason: "tree" | "rebind" | null;
}
```

**模式转换：**

| 从 → 到 | 触发 |
|---|---|
| * → navigating | beginNavigation / beginGeneration rebind |
| * → userScrolling | CodeView onScroll（用户意图） |
| * → refreshing | index/generation 切换开始 |
| navigating → idle | finishTerminal / onVisible / timeout settle / clear |
| userScrolling → idle | 短 debounce 无 scroll（建议 150–300ms）或下一次导航 |
| refreshing → idle | 新代 projection 首次 commit + 可选 anchor restore 完成 |

**pin 集合更新：**

- `navigating`：`pin ⊇ previousPin ∪ {selected} ∪ 当前 members∩viewportCandidates`（不得比进入 navigating 时缩小，除 selected 切换时替换 selected 本身）  
- `userScrolling`：按 renderWindow 重算 pin，但 **本帧不删**「上一 pin 中仍 candidate 的」直到 idle（可选简化：滚动中 pin 只增不减）  
- `idle`：pin = selected∪visible∪buffered demand 的 candidates；允许 LRU 裁非 pin  

### 4.2 成员选择（替换/强化 `selectCodeViewMemberEntryKeys`）

```
输入:
  candidates, demand, entryKeysInOrder, maxMembers,
  mode, pinnedPrefixEntryKeys, previousMembers, selected

硬规则:
  mandatory = pinPrefix ∪ selected∪ demand.visible∪demand.buffered  ∩ candidates
  // 阅读非 idle 时: mandatory ⊇ previousMembers ∩ candidates ∩ (oldPin ∪ viewport)
  
  if |mandatory| > maxMembers:
    输出 mandatory（允许暂超 cap）  // ★ 阅读安全优先于 cap
  else:
    fill = index 序 candidates \ mandatory
    输出 (mandatory ∪ fill[0..budget]) 按 index 序
```

**相对 full-alignment sticky：**  
sticky 扩展为 **ReadingSession.pinnedPrefix**，不仅 tree-nav 期间，**userScrolling / refreshing** 同等保护。

### 4.3 滚动单写者（继承并收紧 full-alignment）

```
点树:
  navigationPendingRef = true 先于一切 loader emit
  boost demand（保留 window）
  若 getItem(sectionKey):
    expand? → scrollTo 1×（firstLayout? instant : smooth）
  否则:
    不滚；busy 态；load 优先
    apply 接受后 layout 再 scrollTo 1×
  verify maxRescroll=0
  pending 期间 suppressMembershipScrollRestore（prop + getter）
```

**禁止：** openTreeNode 同步 tryPending 抢在子 apply 前；bare paint effect 作主路径第一枪。

### 4.4 内容变更

| 事件 | Ledger / CodeView | 滚动 |
|---|---|---|
| load 完成 | `updateItem` 同 sectionKey | 不主动 scrollTo；引擎锚点自稳 |
| 新文件进入窗口 | **addItems 优先**（前缀不变） | 不 scroll |
| cap 驱逐 | **仅 idle 且非 pin** | 不 scroll |
| stage 1:1 | updateItemId | suppress 若 pending |
| stage 槽变 | setItems + 可选 restoreAnchor | 禁止无 suppress 的 scrollTop 双意图 |
| 用户滚轮 | mode=userScrolling；clear 导航 pending | 用户拥有 |

### 4.5 虚拟滚动与性能（无单文件）

| 杠杆 | 做法 |
|---|---|
| 画 | 依赖 Pierre 视口；禁止自绘第二套列表 |
| 读 | maxConcurrent + yield selected + cancel obsolete |
| 账本 | idle LRU 非 pin；nav 中可超 cap |
| remount | 仅 layout key（lineHeight/diffStyle/…） |
| 大列表 | append + estimate；尾部 append skip 整表 render（引擎能力） |

---

## 5. 模块改造清单

### 5.1 新增

| 路径 | 职责 |
|---|---|
| `src/plugins/builtin/git/renderer/git-review-reading-session.ts` | ReadingSession 状态机、pin 计算、mode API（纯函数 + 小 store/ref 门面） |
| `tests/unit/renderer/git-review-reading-session.test.ts` | mode/pin 单调/超 cap 保留 pin |
| `tests/unit/renderer/git-review-member-pin-prefix.test.ts` | select 公式：非 idle 不可裁 pin |

### 5.2 修改（P0 必改）

| 路径 | 改动 |
|---|---|
| `git-review-document-demand.ts` | `selectCodeViewMemberEntryKeys` 增加 `mode` + `pinnedPrefixEntryKeys`；非 idle 强制 ⊇ pin；允许 \|members\| > maxMembers |
| `use-git-review-document-session.ts` | 接 ReadingSession；sync 用 pin 而非仅 sticky-from-previous；**先 setSticky 再改 previous**（防重入扩 pin 面错误） |
| `git-review-document-loader.ts` | retention pin = selected∪visible∪**readingPin**（真 pin，非整 members） |
| `use-git-review-navigation.ts` | 进出 navigating 通知 ReadingSession；settle 清 pin 收敛触发一次 reselect |
| `git-review-content.tsx` | onScroll → readingSession.noteUserScroll；wire pin/suppress |
| `use-git-review-tree-open.ts` | 仅 beginNavigation（已基本到位） |
| `use-diff-view-item-apply.ts` / handle | 保持 suppress + firstLayout；无行为回退 |

### 5.3 修改（P1）

| 路径 | 改动 |
|---|---|
| projection / generation | load 完成路径保证同 sectionKey update；新 entry addItems |
| `diff-view-item-sync.ts` | 回归：append→addItems；正文→updateItem |
| skeleton 策略（可选） | 若 index 能提供行数摘要则进列表估高；否则 collapsed header-only 同 id（**不做假 0 高随机槽**） |

### 5.4 修改（P2）

| 路径 | 改动 |
|---|---|
| main `git-review` | 可选：批量/流式 document 或行数摘要 RPC，减少 N 次 IPC |
| retention limits | idle 更积极；与 pin 协同测试 |
| 性能埋点（可选） | scrollTo 计数、members 长度、active loads（dev/diagnostic） |

### 5.5 不改 / 只回归

- `git-apply-patch` / hunk actions / stage 文件头  
- 双槽 sectionKey 契约  
- session-cache 上限与 sourceKey  
- failure-state settled-only  

---

## 6. 详细实施步骤

### PR-A（P0）：ReadingSession + pin 前缀不可裁

**目标：** 任何 load/nav/刷新路径下，正在读的前缀成员不被踢出 CodeView。

#### A.1 `git-review-reading-session.ts`

纯逻辑优先，便于单测：

```ts
export function computePinnedPrefixEntryKeys(input: {
  entryKeysInOrder: readonly string[];
  selectedEntryKey: string | null;
  viewportEntryKeys: readonly string[]; // 来自 demand.visible 或 renderWindow 映射
  navigationTargetEntryKey: string | null;
  previousPinned: readonly string[];
  mode: ReviewReadingMode;
  candidates: ReadonlySet<string>;
}): string[]
```

规则：

- base = selected ∪ viewport ∪ navigationTarget ∩ candidates  
- 若 mode ≠ idle：输出 = unique index 序 (previousPinned ∩ candidates) ∪ base  
- 若 mode = idle：输出 = base  

#### A.2 强化 `selectCodeViewMemberEntryKeys`

签名增加：

```ts
mode?: ReviewReadingMode; // 默认 idle
pinnedPrefixEntryKeys?: readonly string[];
```

实现要点：

1. `mandatory = pinPrefix ∪ pin(demand,selected) ∩ candidates`  
2. 非 idle：`mandatory ∪= previousMembers ∩ candidates ∩ (pinnedPrefix ∪ viewport)`  
3. `|mandatory| > maxMembers` → **仍全出**（超 cap）  
4. 否则 fill 截断  
5. 返回 index 序  

单测：

- idle 可裁非 pin  
- navigating 时 previous 视口全保留即使超 cap  
- 输出 index 序，非 pin-first  

#### A.3 session.sync 接线

在 `use-git-review-document-session.ts` 的 `sync`：

1. 读 `readingSession.getSnapshot()`  
2. 算 `pinnedPrefix`  
3. `selectCodeViewMemberEntryKeys({ ..., mode, pinnedPrefixEntryKeys })`  
4. `setStickyMemberEntryKeys(真 stickyOnly = members 中相对 demand pin 的差，且 ⊆ pinPrefix 保护集)`  
   - **先 setSticky 再写 previousMembers**（防 re-entrancy 扩 pin）  
5. settle 后 navigation 侧 `setSticky([])` 触发 reselect（已有 clearSticky）时 mode 已 idle  

#### A.4 导航 / 滚动 / 刷新通知

| 调用点 | API |
|---|---|
| beginNavigation | `readingSession.beginNavigating(target)` |
| finishTerminal / onVisible / timeout | `readingSession.endNavigating()` |
| content onScroll（用户） | `readingSession.noteUserScroll()` + 现有 clearForUserIntent |
| generation effect 开始 | `readingSession.beginRefreshing()` |
| projection commit 稳定 | `readingSession.endRefreshing()` |

#### A.5 测试（P0 必绿）

- `git-review-reading-session.test.ts`  
- `git-review-document-demand.test.ts` 扩展 pin 超 cap  
- `git-review-panels`：远树点、连续点（已有）不回归  
- governance：suppress 接线仍在  

**完成定义：** 手动/集成：视口内读文件 A，触发邻文件 load / 第二次点树 B，A 仍在 members 且不无故 scrollTo A。

---

### PR-B（P0 续）：点树滚动路径收口

**目标：** DiffsHub 式 1× scroll；与 pin 协同。

#### B.1 顺序（已大部分具备，审计补洞）

1. pending ref 先于 demand emit（已修则锁测试）  
2. 无 openTreeNode 同步 tryPending（已修）  
3. `navigationEpoch` + layout tryPending（已修）  
4. suppress prop + getter（已修）  

#### B.2 补强

- settle 后 **强制** members 走 idle 公式一次（clearSticky 已 emit；确认 pin 收敛）  
- `resume` rebind：reason=rebind，同样 pin 保护  
- 测试：`beginNavigation` 回调内 `hasPendingNavigation()===true`  
- 测试：tryPending + verify scrollTo 恰好 1  

#### B.3 完成定义

已 materialize 文件点树：无双意图；未 materialize：不提前滚，就绪后 1 次。

---

### PR-C（P1）：进列表可估高 + 同 id hydrate

**目标：** 虚拟滚高度可信；load 不换拓扑身份。

#### C.1 现状对齐

- 仅 `loaded|error` 进 CodeView（真 item）——保留  
- load 完成必须 **同 sectionKey** update，禁止删后加同逻辑文件不同 id（除 stage 合法 rebind）  

#### C.2 Hydrate 路径审计

检查 `projectReviewDocuments` + session.sync contentUpdates：

- membership 不变时只 `updateItem`  
- 新 entry：`addItems`（item-sync 已支持）  

加集成测：成员 id 集合在「仅正文到达」时不变。

#### C.3 可选骨架（仅当不影响真 item 原则）

母约禁「假 placeholder 正文」。若做骨架：

- **collapsed 真 diff item** 或 **state 项**，带稳定 sectionKey  
- 高度 = header metrics（与 `diffHeaderHeight` 一致）  
- hydrate 后 updateItem 展开  

**本阶段可不做骨架**，优先保证「已 load 的 pin 稳定」；未 load 点树 = pin 目标 + 优先读 + 就绪 scroll。

#### C.4 firstLayout behavior

保持 `firstLayoutItemIdsRef`：新建 instant、在场 smooth。

---

### PR-D（P2）：性能加深（仍多文件虚拟滚）

#### D.1 Loader

- 保持 maxConcurrent / yield / preFreed  
- 指标：在飞数、取消率（可选 debug）  
- 单测：满并发 protect 插队  

#### D.2 idle LRU

- 仅 `mode===idle` 且 entry ∉ pin 可驱逐  
- 与 retention bytes/lines 协同  
- 禁止 nav 中因 soft budget 抽空 pin（sticky pin 已部分覆盖）  

#### D.3 批量读（可选大 PR）

main 侧评估：

- `git.diff` 多路径或 pack 接口，一次返回多 fileDiff  
- 或 index 附带 **hunk 行数摘要**（不进全文）供估高  

**输出仍 append 进同一 CodeView**，不引入单文件 UI。

#### D.4 完成定义

500+ 变更：可开、可滚、点树可用；内存不线性等于「全文件 DOM」。

---

## 7. 实施顺序与依赖

```
PR-A (ReadingSession + pin 公式)
  └─► PR-B (导航 settle 与 pin 收敛审计)  // 可与 A 同 PR 若体积可控
        └─► PR-C (hydrate 同 id)
              └─► PR-D (idle LRU + 可选批量读)
```

建议：**A+B 合并为一个交付**（阅读稳定最小闭环），C/D 随后。

---

## 8. 测试矩阵

| 层级 | 内容 |
|---|---|
| 单元 | pin 单调、超 cap 保留 pin、idle 可裁、pending 先于 demand、scrollTo≤1、suppress scrollTop、sticky 先 set 后 previous |
| 面板 | 远树点、连续点、目标已在窗口、刷新保留选择、双槽 stage |
| 治理 | 无 topology remount；suppress 接线；无 exclusive demand 注释回潮 |
| 手工 | 大仓滚动读文件时邻文件 load；点树跨百文件；stage 半文件；watch 刷新 |

---

## 9. 验收标准

| # | 场景 | 通过 |
|---|---|---|
| V1 | 始终多文件列表 | **无**单文件模式 banner/路由 |
| V2 | 已 load 连点树 | 每次 ≤1 scrollTo；无沉底再跳 |
| V3 | 未 load 点树 | 就绪前不乱滚；就绪 1 次到位 |
| V4 | 阅读中邻文件 hydrate | 视口文件不消失；无跳到错误文件头 |
| V5 | 后方大量 append | 当前阅读位置稳；滚动条可变长 |
| V6 | 刷新 / soft-retain | 视口内容可恢复；无整表闪空 |
| V7 | stage/hunk | 阅读位置可接受；写失败有反馈 |
| V8 | 大仓性能 | 打开可交互；滚动不卡死；DOM 不随 N 文件线性 |

---

## 10. 风险与缓解

| 风险 | 缓解 |
|---|---|
| pin 导致 members 暂超 cap、内存涨 | 仅非 idle 超 cap；idle 立即收敛；监控 members 长度 |
| pin 只增不减导致泄漏 | idle debounce 收敛；selected 切换更新 pin |
| 与 sticky 概念重复 | ReadingSession.pin 为权威；loader sticky ⊆ pin 差集 |
| 骨架违反「真 item」 | P1 可跳过骨架；或仅 collapsed 真 item |
| 范围蔓延到批量 git 协议 | 批量读放 P2，不挡 P0 |

---

## 11. 回滚

- ReadingSession 可 feature-flag：`mode` 强制 idle 则退回仅 tree-nav sticky（旧行为）  
- 公式改动集中在 `selectCodeViewMemberEntryKeys` + session.sync，便于 git revert 单 PR  

---

## 12. 实施检查清单（开发用）

### P0

- [ ] 新增 `git-review-reading-session.ts` + 单测  
- [ ] `selectCodeViewMemberEntryKeys` 支持 mode/pin/超 cap  
- [ ] session.sync 接 pin；setSticky 顺序正确  
- [ ] navigation/scroll/refresh 通知 mode  
- [ ] settle → idle 收敛  
- [ ] 导航顺序与 scrollTo≤1 测试绿  
- [ ] panels 回归绿  
- [ ] 手动：阅读中 load 邻文件不丢位置  

### P1

- [ ] hydrate 同 id 不变量测试  
- [ ] addItems 优先路径确认  
- [ ] firstLayout 行为回归  

### P2

- [ ] idle LRU 仅非 pin  
- [ ] （可选）批量读 / 行数摘要设计另文  
- [ ] 大仓手测清单  

---

## 13. 总结

本方案在 **坚持多文件虚拟滚动** 的前提下，用 **ReadingSession.pinnedPrefix** 锁住阅读坐标系，用 **demand 只读、Ledger 只稳、CodeView 只虚拟画** 三段分工，解决体感与性能，而不走 Codex 单文件捷径。

**下一步工程：** 按 §6 PR-A+B 开工实现。

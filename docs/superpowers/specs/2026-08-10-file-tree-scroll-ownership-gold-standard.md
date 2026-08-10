# 文件树滚动所有权金标准终态方案

日期：2026-08-10  
状态：**产品已确认（2026-08-10）** — 滚动意图终态权威。  
实现进度：**P1–P5 代码路径已落地**（owner、条件化 compensate、reveal settle、store 热重载不空窗、治理扫描）。宣称「金标准完成」仍以 G0–G5 手工/探针全绿为准。  
范围：`PierFileTree` **滚动意图与 `scrollTop` 写路径**。  
体感、状态机、path-sync、reveal、菜单钉滚动、store 刷新、验收一体定义；**禁止**再叠「多帧 pin / lock 拒收用户滚 / 症状性 rAF 死钉」当结案。

产品硬约束（继承，不得用本文开脱）：

- 文件树仍基于 `@pierre/trees` 虚拟列表；**禁止**为滚动问题自研第二套虚拟列表或引入 Monaco ScrollableElement。
- 保留：懒加载目录、expansion authority、compact folders、stickyFolders、auto-reveal、树内搜索 hide-non-matches、右键 inspect/command 分流。
- files 侧栏与 git review 树 **共用** `PierFileTree` 滚动契约；业务层禁止直写 scroller `scrollTop`。

### 文档层级（冲突时）

| 文档 | 角色 | 与本文关系 |
|------|------|------------|
| **本文** | **滚动所有权终态唯一权威**：意图状态机、谁可写 `scrollTop`、path-sync/reveal/menu、DoD | 权威 |
| `2026-07-02-project-file-tree-design.md` | 文件树产品母约（懒加载、watch、搜索、主题） | 母约仍有效；**滚动写路径以本文为准** |
| `2026-07-18-files-tree-search-path-query-keep-tree-ui-design.md` | 搜索 path query + 树 UI | 搜索导航滚动走本文 reveal 管道 |
| `2026-07-25-git-review-tree-context-menu-endstate.md` | 右键 inspect/command + 菜单会话 | 菜单钉滚动降级为本文 `menu-pin`；意图分流仍有效 |
| `2026-07-27-diffshub-full-alignment-design.md` / `2026-07-31-git-review-gold-standard-endstate-design.md` | Review 正文滚动单写者 | **原则同源**（单意图）；作用域是 CodeView，不是文件树 |
| `packages/ui/src/file/tree-scroll*.ts` 等实现 | 代码 | 实现须对齐本文；冲突时改代码或改本文，禁止双真理 |

**实现禁令：** 未对照本文时，禁止再合「只加长 frames / 只加 lock / 只 pin 右键 / 只 debounce watch」类症状补丁充当终态。  
**里程碑：** PR 可切片，但 **G0–G5 全绿前不得宣称文件树滚动已金标准**。

---

## 0. 一句话终态

> **任意时刻文件树视口最多一个合法滚动意图；用户主动滚动永远优先；path 同步默认不碰 `scrollTop`，仅在「视口上方内容高度可能变了」时做至多一次可被用户抢占的布局补偿；reveal / 搜索定位应用层至多一次 `scrollToPath`；菜单仅短窗 raw pin。**

---

## 1. 标杆对照

### 1.1 Review / DiffsHub（原则层）

| 原则 | Review 终态 | 文件树终态用法 |
|------|-------------|----------------|
| 滚动单写者 | 禁止 membership 写 `scrollTop` 与 `scrollTo` 并行 | path-sync **默认不写**；与 reveal **禁止同回合并行** |
| 应用层定位次数 | 树点 → ≤1 次 scrollTo | reveal / 搜索导航 → ≤1 次 `scrollToPath` |
| 用户阅读不被冲 | 后台 load / watch 不拽视口 | 后台 listing / git / watch **不得**多帧钉死用户滚 |
| 引擎职责 | Pierre CodeView 自管 anchor | `@pierre/trees` 自管虚拟窗口与 `maxScrollTop` 安全钳制；**宿主不双写对抗引擎** |

### 1.2 VS Code Explorer（产品体感）

| 体感 | VS Code | Pier 终态 |
|------|---------|-----------|
| 空闲滚动 | 跟手、无回弹 | 同 |
| 后台文件变更 | 视口尽量稳，不锁死滚动 | 同；用一次 compensate，不用死钉 |
| reveal active | 打开时 nearest/center 一次 | 同；path 未变不因 refresh 再滚 |
| 右键已选中行 | 不因 focus 把行滚进 sticky 带 | 同；`menu-pin` + command 不强制 sticky scrollIntoView |

---

## 2. 问题与根因（可证伪）

### 2.1 必须消灭的体感

| ID | 体感 |
|----|------|
| S1 | 往下滚时滚动条来回跳，像锁死 |
| S2 | 目录 refresh 时先弹顶再弹回 |
| S3 | 活动文件 / refresh 偶发把视口拽回 |
| S4 | 右键或 sticky 行 focus 导致视口跳一下 |

### 2.2 根因分层

| ID | 根因 | 今日机制（实现索引） |
|----|------|----------------------|
| R1 | **双意图滚动** | path-sync `restoreSnapshotSoon({ frames: 4, lock: true })` 与用户 wheel 对打（`use-tree-path-sync.ts`、`tree-scroll-controller.ts`） |
| R2 | **无条件 layout pin** | 任意 path 集合变化都多帧 + lock，不论是否影响视口上方 |
| R3 | **投影高度凹坑** | watch/listing 先短后长 → 引擎 `maxScrollTop` 夹顶（Pierre `FileTreeView.update` + store refresh） |
| R4 | **次级程序化滚动** | auto-reveal 在 path 短暂缺失时再 `scrollToPath`；sticky focus `scrollFocusedRowIntoView` |
| R5 | **观测副作用** | Shadow `MutationObserver({ subtree: true })` 滚动中全量量测 row 几何 |

**非根因（禁止当主线）：** 固定行高估高失败、scrollbar 组件皮肤、仅 git 装饰重渲染（不改 path 集合时 path-sync 已早退）。

---

## 3. 关键决策（冻结）

| # | 决策 | 理由 |
|---|------|------|
| **K1** | 单一 **滚动意图状态机** 拥有所有 Pier 侧 `scrollTop` 写入 | 消灭补丁互钉 |
| **K2** | **用户意图绝对优先**：wheel / touch / 滚动条拖拽 / 滚动键立即 `user`，取消 in-flight compensate 与可取消的 reveal 滚动 | 对症 S1 |
| **K3** | path-sync **默认不写 `scrollTop`**；仅 `shouldCompensate` 为真时 **至多一次** 布局补偿（≤2 帧几何 settle，**禁止 lock 拒收用户位置**） | 保留「上方插入不跳」，去掉「空滚被钉」 |
| **K4** | 程序化滚动只允许：`reveal`（含搜索导航）、`compensate`、`menu-pin`；互斥且可 abort | 对齐 Review 单意图 |
| **K5** | auto-reveal：仅 **revealPath 引用变化** 或 **首次投影成功** 时滚动一次；path 短暂缺失只挂 pending，**禁止** renderSignature 噪音再 nearest | 对症 S3 |
| **K6** | store/watch 目录 refresh **差分 merge、一次发布**；禁止可见的「子树先空再满」中间快照 | 对症 S2 |
| **K7** | 观测不得驱动滚动；snapshot 发布 rAF 合并；禁止滚动热路径全量 row `getBoundingClientRect` | 对症 R5 |
| **K8** | 验收以写手数探针 + 用户抢占测试为准；G0–G5 全绿前不得称金标准 | 防回归成补丁栈 |
| **K9** | 引擎（`@pierre/trees`）允许安全钳制与自身 sticky 键盘校正；Pier **不得**用多帧 pin 与引擎对打。无法包一层的引擎写入靠减少宿主 pin + user claim 窗口共存 | 边界清晰，不假装能重写上游每一帧 |

---

## 4. 目标架构

### 4.1 模块边界

```
业务（files sidebar / git review tree）
  │  items / revealPath / 菜单回调
  │  禁止：query scroller.scrollTop =
  ▼
PierFileTree
  ├─ use-tree-path-sync     → scrollOwner.requestLayoutCompensate?
  ├─ use-tree-reveal-controller → scrollOwner.beginReveal / endReveal
  ├─ tree-internal (menu)   → scrollOwner.beginMenuPin / endMenuPin
  └─ tree-scroll-controller → 绑定 scroller 手势 claim + 发布 snapshot
        │
        ▼
tree-scroll-owner（唯一调度）
  ├─ claimUserScroll / abortGeneration
  ├─ requestLayoutCompensate（条件化、可抢占）
  └─ withProgrammaticScroll（标记宿主写入）
        │
        ▼
tree-scroll.ts（纯函数）
  capture / restore / shouldCompensate 几何
        │
        ▼
@pierre/trees scroller（引擎虚拟窗口 + maxScrollTop 钳制）
```

### 4.2 状态机

```
                    手势 claim
         ┌──────────────────────────┐
         ▼                          │
       user ◄───────────────────────┤
         │  idle 超时（150ms 无手势） │
         ▼                          │
       idle ──compensate──► compensate ──1 次写──► idle
         │                     ▲ 手势 → abort ──► user
         │                     │
         ├──reveal────────► reveal ──≤1 scrollToPath──► idle
         │                     ▲ 手势 → abort 滚动（select 可保留）→ user
         │
         └──menu-pin──────► menu-pin ──会话+尾帧──► idle
```

### 4.3 优先级（高 → 低）

```
user > menu-pin > reveal > compensate > idle
```

规则：

1. 高优先级激活时，低优先级 **不得启动**；已启动则 **abort**（bump generation）。
2. `user` 不主动写 `scrollTop`，只 **禁止** 宿主再写。
3. 同一时刻 owner 至多一个（menu-pin 与 user 若重叠：menu 打开瞬间可 pin，**随后**用户滚 → 升为 user 并结束 pin 的再写）。

### 4.4 谁可以写 `scrollTop`

| 意图 | Pier 可写？ | 次数 / 时长 | 取消 |
|------|-------------|-------------|------|
| `user` | 否（浏览器原生） | 手势后 150ms 滑动占用 | — |
| `reveal` | `model.scrollToPath` | **应用层 ≤1 次** / 请求；retry 只在尚未成功写过时 | 用户手势 abort **后续** scroll；hard cap 800ms |
| `compensate` | `restoreSnapshot` | **≤1 次**（几何未 settle 时允许 +1 帧，合计 ≤2 帧） | 用户手势立即 abort；**禁止 lock** |
| `menu-pin` | raw `scrollTop` 钉 | 菜单 begin→end + 结束 ≤2 帧 | end；用户滚升 `user` |
| path-sync / membership | **禁止**直接写 | — | — |
| MutationObserver / snapshot 发布 | **禁止**写 | — | — |
| 引擎 clamp / sticky 内部 | 引擎自有 | 安全阀 | 宿主不与之对打 |

### 4.5 程序化写入标记

所有 **Pier 宿主** 写 `scrollTop` 必须：

```ts
withProgrammaticScroll(() => {
  scrollElement.scrollTop = next;
});
```

- `programmaticWriteDepth > 0` 期间产生的 `scroll` 事件 **不** `claimUserScroll`。
- 其它 `wheel` / `touchmove` / 滚动键 /（非程序化）`scroll` → `claimUserScroll`。

引擎内部写入无法包一层时：不强制 claim；依赖 K3 减少宿主 pin，避免对打。

---

## 5. 路径契约

### 5.1 path-sync（membership）

**禁止（今日行为）：**

```text
path 变 → capture → batch → restoreSoon(frames: 4, lock: true)  // 无条件
```

**终态：**

```text
path 变
  → captureSnapshot（仅当后续可能 compensate；否则可跳过）
  → batch | resetPaths 残路
  → 必要的 expand-only（authority）—— 不在此写 scrollTop
  → if shouldCompensate(mutation, snapshot) && owner 允许:
        requestLayoutCompensate(snapshot)  // ≤1 次写，无 lock
    else:
        完全不碰 scrollTop
```

#### `shouldCompensate`（规范）

输入：`mutation`（add/remove/move 列表）、补偿前 `snapshot`（优先 anchor）、可选当前 `owner`。

| 条件 | 补偿？ |
|------|--------|
| `owner === user` 或 `owner === reveal`（reveal 持有中） | **否** |
| 无有效 snapshot | **否** |
| mutation 仅触及 anchor 路径在投影序中的 **严格下方**（且不改 anchor 祖先展开集） | **否** |
| 在 anchor **上方** 的 add/remove/move，或 anchor 自身 remove/move | **是** |
| 触及 anchor 祖先目录的 remove/move（可能导致整枝消失） | **是** |
| 懒加载 children **add**，且其父目录在投影序上位于 anchor **之上或等于 anchor 祖先**（展开后把视口内容下推） | **是** |
| `resetPaths` 全量重建 | **是**（优先 position fallback） |
| 同 path 集合、仅重排 | **否**（path-sync 已 no-op） |
| 用户点击导致的 expand/collapse（无 path 集合变化） | **否**（本就不进 path-sync） |
| reveal 持有中产生的 path add（含祖先 listing） | **否**（compensate skip；滚动归 reveal） |
| 搜索 `hide-non-matches` 激活中，由 materialize 产生的大批 add | **否** 用 compensate 追视口；搜索打开/换 query 的定位归 **reveal/search-nav 一次**；关闭搜索后的 path 回落若需稳视口，**仅当 owner≠user 时 position 一次** |

近似实现允许用「官方 path 字符串前缀 / 父路径 + 字典序」代替真实投影下标；**误判方向必须是少补（可能微跳）而不是多钉（锁死）**。

#### 删除的 API 语义

- 公 API **删除** `restoreSnapshotSoon` 的 `lock` 与任意调用方 `frames`。
- 测试可用 internal `restoreSnapshotForTest`；生产 path-sync 只走 `requestLayoutCompensate`。

### 5.2 用户手势占用

在虚拟 scroller（`[data-file-tree-virtualized-scroll="true"]`）上：

| 事件 | 行为 |
|------|------|
| `wheel` / `touchmove` | `claimUserScroll`（passive） |
| 滚动键（PageUp/Down、Space、Home/End 等，与引擎 SCROLL_KEYS 对齐） | 在 keydown 且目标在树内时 claim |
| 滚动条指针拖拽 | pointerdown 命中 scrollbar 轨道时 claim |
| `scroll` 且非 programmatic | claim（兜底） |

占用窗口：常量 **`FILE_TREE_USER_SCROLL_CLAIM_MS = 150`**（单源，禁止魔法数散落）。  
与引擎 `isScrolling`（约 50ms）解耦：宿主占用必须 **更长**，避免 50ms 后 compensate 插回。

**不**因下列原因 claim user：

- 仅 `ResizeObserver` / 面板改宽导致的 layout（视口高度变 → 引擎 clamp 合法）
- 仅 programmatic 写入引发的 `scroll` 事件
- 仅 sticky 覆盖层 DOM 增减无手势

`claimUserScroll` 必须：

1. `owner = user`
2. `abortGeneration++`（作废 in-flight compensate / reveal 后续 scroll）
3. 清除任何 `lockedScrollTop` 残留（终态无 lock，迁移期也要清）

### 5.3 reveal / auto-reveal / 搜索

| 场景 | scroll | 次数 | 用户滚走后 |
|------|--------|------|------------|
| 显式 API / 面包屑 / 磁盘打开 | center 或调用方 | ≤1 | abort 后续 retry 的 scroll；select 可保留 |
| 搜索匹配导航 | center | 每次导航 ≤1 | 同上 |
| active-file，`autoReveal: "on"` | nearest | **path 变化时 1 次**；首次投影成功补 1 次 | **禁止** 因 listing/git/renderSignature 再滚 |
| active-file，`select` | none | 0 | — |
| active-file，`off` / exclude | skip | 0 | — |
| inspect 右键 | none（select-only） | 0 | — |

**删除危险分支：**

```ts
// 禁止：items 暂时找不到 → 立刻 requestReveal 再 nearest
if (!item) requestReveal(path, { intent: "active-file" })
```

**改为：**

```ts
if (!item) {
  pendingReveal = { path, options }  // 不滚动
  return
}
// items 出现且 pending 匹配 → runReveal 一次（仍受 user claim 约束）
```

Reveal 成功后的 hold：

- 仅用于 **防止同回合 path-sync compensate 覆盖定位**（短窗，建议 idle 200–400ms，hard cap **800ms**）。
- **不**等于多帧写 `scrollTop`。
- user claim **立即**结束 hold。

`beginProgrammaticScroll` / `endProgrammaticScroll`：迁移期别名到 `beginReveal` / `endReveal`；新代码只用 reveal 名。

### 5.4 右键 / sticky（menu-pin）

- 保留：`pinFileTreeScrollDuringContextMenu`、trees 侧 sticky 键盘 pin 补丁、inspect/command 分流。
- 统一入口：`scrollOwner.beginMenuPin(anchor)` / `endMenuPin()`。
- **仅**菜单会话；禁止扩成全局持续 rAF 死钉。
- Command：不 focus 到会触发 sticky `scrollFocusedRowIntoView` 的路径（现有策略保持）。

### 5.5 store / watch（数据侧）

金标准（files tree store；git 树有独立投影时同原则）：

1. 目录 refresh = **差分 merge**（add/update/remove 计算后一次 `emit`）。
2. **禁止**对已加载目录发布「children 全空」再「全量加回」的中间 snapshot（除非目录确实变空）。
3. 同目录并发 refresh：generation + 单飞；过期响应丢弃。
4. root reload：在提交前算完 next map，**一次**替换；`rootLoaded` 保持 true 的热替换不得清空 entries 一帧。

目的：引擎 `maxScrollTop = itemCount * h - viewport` 不因假性 `itemCount` 凹坑夹死用户滚。

### 5.6 观测与 snapshot

| 项 | 终态 |
|----|------|
| scroll → `onScrollSnapshotChange` | rAF 合并，至多 1 次/帧 |
| MutationObserver | 仅追踪 scroller 节点出现/替换；**禁止** `subtree: true` 跟随虚拟 row |
| `captureSnapshot` | compensate 前或外部 API；禁止 scroll 热路径扫全部 treeitem 几何 |
| `lock` 拒收 snapshot | **删除** |

---

## 6. 公 API 终态表面

```ts
interface PierFileTreeScrollController {
  /** 进入 reveal 意图（压制 compensate） */
  beginReveal(): void;
  endReveal(): void;

  /** @deprecated 别名 beginReveal / endReveal；迁移后删除 */
  beginProgrammaticScroll(): void;
  endProgrammaticScroll(): void;

  captureSnapshot(): PierFileTreeScrollSnapshot | null;

  /** 同步恢复一次；生产 path-sync 不直接依赖 */
  restoreSnapshot(snapshot: PierFileTreeScrollSnapshot): void;

  // 删除：restoreSnapshotSoon(snapshot, { frames, lock })
}
```

`PierFileTreeScrollRestoreOptions` 的 `lock` / 调用方 `frames` **移出公 API**。

业务与插件：

- **禁止** `fileTreeScrollElement(...).scrollTop =`
- **禁止** 自建 rAF pin 循环（菜单必须走 `onContextMenuSession` / owner）

---

## 7. 实现切片（可并行准备，顺序合入）

| PR | 内容 | 关闭 |
|----|------|------|
| **P1** | scroll-owner + user claim + abort；path-sync 去掉 lock/多帧；user 时 skip compensate | S1 止血 |
| **P2** | `shouldCompensate` + 默认不滚；上方插入仍 1 次锚点稳定 | R2 根治 |
| **P3** | reveal 契约：pending 不滚、hold 缩短、user abort 后续 scroll | S3 |
| **P4** | store 差分 refresh、一次发布 | S2 |
| **P5** | observer/snapshot 治理 + 扫描测试 + 写手数探针 | R5 / 防回归 |

**P1+P2 合入后** 体感上应已不可稳定复现 S1；**G0–G5 全绿** 才可宣称金标准。

---

## 8. 验收门禁（G0–G5）

### G0 — 所有权与治理

- [ ] 生产路径上 Pier 写 `scrollTop` 仅经 `tree-scroll-owner`（或 `withProgrammaticScroll`）。
- [ ] 治理测试：扫描 `packages/ui/src/file` 与 files/git 树业务，禁止裸 `scrollTop =`（白名单仅 owner / 测试 helper）。
- [ ] 公 API 无 `lock`、无调用方自定义多帧 restore。

### G1 — 用户优先

- [ ] 单测：in-flight compensate 期间注入 wheel → 后续帧 **零** 宿主 `scrollTop` 写。
- [ ] 单测：reveal hold 期间 wheel → 不再 `scrollToPath` retry。
- [ ] 组件：高列表连续 wheel，scrollTop 无回弹（允许单调增加）。

### G2 — path-sync 安静

- [ ] 仅下方 add：**0** 次 compensate 写。
- [ ] 上方 insert：锚点 topOffset 误差 ≤1px，**恰好 1** 次写（或 1+1 settle 帧且无 user 时）。
- [ ] 仅 gitStatus / loadState 变化：scrollTop 不变。

### G3 — reveal

- [ ] path 变化 active-file：≤1 次 scrollToPath。
- [ ] 同 path，items 短暂缺失再恢复：**0** 次额外滚动。
- [ ] 显式 reveal 与 path-sync 同回合：compensate skip。

### G4 — 数据不坑

- [ ] 目录 refresh 热路径：不发布 children 空中间态（单测 store）。
- [ ] refresh 过程中用户 scrollTop 不被强制归零（组件或集成）。

### G5 — 菜单 / sticky

- [ ] 既有「右键不跳 scrollTop」测试保持绿。
- [ ] menu-pin 不泄漏为全局持续 pin（会话 end 后 generation 结束）。

### 写手数探针（测试或 dev）

```ts
type ScrollWriteKind = "compensate" | "reveal" | "menu" | "other";
// 单次 path-sync 回合：compensate ≤ 1，other === 0
// 用户滚动回合：compensate === 0 且 reveal === 0（menu 除外）
```

### 手工验收（建议闲置机 / 本地）

1. 大仓多层展开，中部持续往下滚 3s → 无回弹。  
2. 滚动同时对已展开目录大量 `touch`/写文件 → 最多一次微顿，不锁死。  
3. 打开深路径后滚走，触发 git status / listing → 视口不拽回活动文件。  
4. sticky 组头上右键多次 → scrollTop 稳定。

---

## 9. 明确非目标

| 禁止 | 原因 |
|------|------|
| 自研虚拟列表替换 `@pierre/trees` | 成本与问题不匹配 |
| Monaco / 自绘 scrollbar 引擎 | 与 Pier scrollbar 体系冲突 |
| 用更长 rAF / 更强 lock「盖住」抖动 | 与 K2 相反，加重 S1 |
| 业务层第三套 scroll 冻结 | 禁止新写手 |
| 依赖 CSS `overflow-anchor` 作主方案 | 虚拟列表 + spacer 不可靠 |
| 宣称「引擎零写 scrollTop」 | 引擎 clamp/sticky 合法；目标是宿主单意图 |

---

## 10. 风险与残留

| 风险 | 缓解 |
|------|------|
| `shouldCompensate` 少补 → 上方插入时内容微跳 | 单测锁上方 insert；误判偏向少补；可后续收紧启发式 |
| 引擎 sticky focus 仍可能写 scrollTop | menu-pin + 减少 focusPath；不与多帧 pin 对打 |
| 用户 claim 150ms 内合法 compensate 被跳过 | 可接受；用户正在看的坐标优先于后台稳视口 |
| 搜索 materialize 大批 add | 走 shouldCompensate；搜索导航滚动归 reveal 一次 |
| 旧测试依赖 frames:4 + lock | P1/P2 改写断言为「1 次 / 可抢占」 |

**残留（接受，不挡金标准宣称）：**

- `@pierre/trees` 内部 `maxScrollTop` 钳制与 sticky 键盘校正仍可能改 `scrollTop`（K9）。
- 真·目录变空或用户折叠导致的合法夹顶。

---

## 11. 成功定义（可签字）

同时满足：

1. **所有权**：G0 绿；写路径可指出唯一 owner。  
2. **用户优先**：G1 绿；S1 在「边滚边 watch」下不可稳定复现。  
3. **默认安静**：G2 绿；无关视口上方的 path delta 零宿主滚动写入。  
4. **定位仍准**：G3 绿；显式 reveal / 搜索 / 首次 active-file 一次到位。  
5. **数据不坑**：G4 绿。  
6. **菜单不跳**：G5 绿。  

未全绿时：只可说「P1 止血 / P2 部分收紧」，**不得**写进 CHANGELOG 称「文件树滚动金标准完成」。

---

## 12. 附录：与今日代码的映射

| 今日 | 终态 |
|------|------|
| `restoreSnapshotSoon(..., { frames: 4, lock: true })` | 删除；改 `requestLayoutCompensate` |
| `lockedScrollTopRef` 拒收 snapshot | 删除 |
| `suppressRestoreDepthRef` 仅压制 restore | 并入 owner：`reveal` 持有 |
| `pinFileTreeScrollDuringContextMenu` | `menu-pin` 实现细节 |
| reveal `if (!item) requestReveal` | pending 不滚 |
| `MutationObserver(subtree: true)` | 浅观察 scroller 挂载 |
| store refresh 可能中间空 | 差分一次发布 |

### 关键实现文件（预期触点）

- `packages/ui/src/file/tree-scroll-owner.ts`（新增）
- `packages/ui/src/file/tree-scroll.ts`
- `packages/ui/src/file/tree-scroll-controller.ts`
- `packages/ui/src/file/use-tree-path-sync.ts`
- `packages/ui/src/file/use-tree-reveal-controller.ts`
- `packages/ui/src/file/tree-internal.ts`
- `packages/ui/src/file/tree-types.ts`
- `src/plugins/builtin/files/renderer/tree/store.ts` / `watch-*.ts`（P4）
- 测试：`tests/component/app/pier-file-tree-mutations.test.tsx`、`tests/component/files/ui-file-tree.test.tsx`、新增 owner / governance 单测

---

## 13. 终态完备性自审（2026-08-10）

对照仓库内 **Git Review 金标准终态** 条（单意图、禁症状补丁、G 门禁、文档层级、可签字 DoD），对本文结论如下。

### 13.1 已具备「金标准终态文档」形态的部分

| 维度 | 判定 | 说明 |
|------|------|------|
| 根因可证伪 | 通过 | R1–R5 对应代码路径，非「虚拟列表玄学」 |
| 单一权威 | 通过 | 滚动写路径以本文为准；与 file-tree 母约层级清晰 |
| 关键决策冻结 | 通过 | K1–K9；明确用户优先与默认不滚 |
| 状态机 + 写权限表 | 通过 | 谁可写、次数、取消条件可实施 |
| 禁症状补丁 | 通过 | 明确禁更长 pin / 更强 lock |
| 切片与 DoD | 通过 | P1–P5 与 G0–G5；未全绿不得宣称完成 |
| 非目标与残留 | 通过 | 引擎 clamp 合法残留写明，避免假「零写」 |
| 与 Review 原则对齐 | 通过 | membership 不与 scrollTo 并行；应用层 ≤1 次定位 |

### 13.2 仍是「终态方案草案」而非「已确认产品终态」的原因

| 缺口 | 影响 | 关闭条件 |
|------|------|----------|
| 状态仍是草案，未经产品签字 | 不能与 Review「产品已确认」同级 | 产品确认 K2/K3/K5 或修订 |
| 代码未落地 | 文档≠运行时真理 | G0–G5 绿 |
| `shouldCompensate` 为启发式 | 少补可能微跳 | P2 单测锁上方 insert；误判策略已规定「少补」 |
| 引擎 sticky / clamp 仍可写 `scrollTop`（K9） | 极端键盘 + sticky 仍可能轻跳 | 接受为残留；不靠宿主死钉对抗 |
| P4 store 差分与 P1/P2 解耦 | 仅合 P1 时 S2 可能仍在 | 宣称金标准必须 G4，不可只合止血 PR |

### 13.3 审查结论（是否金标准终态方案）

| 问题 | 结论 |
|------|------|
| 是否仍是「补丁叠层」方案？ | **否。** 中心是所有权状态机 + 默认不滚 + 用户抢占，不是再加长 frames。 |
| 是否足以作为实现唯一权威？ | **是（草案级）。** 实现应对齐本文；有冲突改代码或改本文。 |
| 是否可立即写 CHANGELOG「滚动金标准完成」？ | **否。** 须产品确认 + G0–G5。 |
| 相对「理论最纯」（宿主永不写 `scrollTop`）？ | **有意不采用。** 固定行高虚拟列表下，上方 insert 无一次 anchor 补偿会系统性视口跳；一次可抢占 compensate 是 IDE 级终态，不是半吊子。 |
| 最小可宣称「体感根治」的实现集？ | **P1+P2+G0–G2** 可关 S1；**全套 G0–G5** 才可称本文意义下的金标准。 |

### 13.4 自审后已并入正文的增补

- 懒加载 children 在 anchor 上方展开 → 应 compensate。  
- 搜索 materialize 大批 add → 不走 compensate 追滚；定位归 search-nav。  
- `FILE_TREE_USER_SCROLL_CLAIM_MS` 单源；ResizeObserver 不 claim user。  
- 明确「少补优于多钉」与「P4 为 G4 必达」。

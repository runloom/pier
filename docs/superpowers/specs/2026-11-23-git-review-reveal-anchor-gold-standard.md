# Git Review 树跳转布局锚点与有界揭示金标准

日期：2026-11-23  
状态：**已确认（方案 A），实现完成待手工验收** — 本文只修订 Git Review 的“滚动 / 揭示 / 布局锚点”合同；正文成员、加载、失败态仍以
[`2026-07-31-git-review-gold-standard-endstate-design.md`](2026-07-31-git-review-gold-standard-endstate-design.md) 为准。  
本文与旧文冲突时，**§7 导航、§8 验收、§12 探针**以本文为准；旧文其余部分继续有效。

## 0. 一句话终态

> **树点击只提交一个“揭示目标”事务：先立即滚到目标（允许 estimate），目标变成真正文后提交一次内容定位，布局稳定后允许至多两次几何纠正；任何一次高度 / 顶部变化都必须保住用户当前可见的锚点。首次点击即准，不靠第二次点击补救。**

## 1. 问题与证据

生产窗口（0.1.63，长期存活的 Git Review 标签，138 个文件、+19,555 / −1,297）中，左侧树点击
`settings/zh-Hans.json` 后，正文停在目标之前若干行；再点一次同一文件才准确。开发窗口（同一版本 +
仅 Markdown 色条提示提交）首次点击准确。

已排除：

- 不是版本回归：`/Applications/Pier.app` 与开发分支的 Git Review / diff-view 代码一致；开发分支只多一个
  Markdown git-bar tooltip 提交。
- 不是同名文件串线：`entryKey` 对完整路径做哈希，`sectionKey` 对 `(group, oldPath, targetPath)` 做哈希；
  `commands/zh-Hans.json` 与 `settings/zh-Hans.json` 不会碰撞。
- 不是目标行号或 diff 内容算错。

真实差异是**运行时状态**：生产窗口的 Review 表面长期存活、diff 大、点击时目标上方大量槽位仍是
estimate；开发窗口是新建窗口，目标上方大多已实测或尚未进入同一批加载。

## 2. 根因

### 2.1 第一次滚动提交在“估高”上

`CodeView` 的虚拟几何由 `items[].top / height` 构成。estimate 槽位是固定骨架高度；真正文到达后，
上方文件从骨架高度增长到实际高度，目标 `top` 随之后移。

树点击只调用一次 `scrollToItem(target)`。这次调用发生时：

- 目标已进入账本，但可能仍是 estimate；
- 目标上方的文件也可能仍是 estimate；
- `scrollToItem` 按当时的 `top` 计算 `scrollTop`，提交后即视为“已定位”。

### 2.2 布局改写没有锚点保持

`packages/ui/src/diff-view/layout-apply.ts` 的 `applyDiffVirtualHeights` 会重写
`items[].height`、`items[].top`、`scrollHeight`，但只 `pin` 总高，不补偿 `scrollTop`。

随后 estimate → loaded 的正文更新、成员插入或折叠变化会再次改写上方 `top`。如果这次改写发生在
Pierre 的 `pendingLayoutAnchor` 已经结算之后，目标就被推走，而滚动位置不会跟着修正。

### 2.3 导航把“一次 scrollTo”当成事务终点

`src/plugins/builtin/git/renderer/hooks/use-navigation-try.ts` 用
`lastScrolledSectionRef + lastScrolledCacheKeyRef` 判断“同一内容版本只滚一次”。
`lastScrolledLayoutKeyRef` 与 `lastScrolledProjectionRevisionRef` 只写不读；目标上方布局变化后，
`alreadyScrolledTarget` 直接返回，不再纠正。

这不是“估高不够准”的问题。即使估高再准，成员插入、折叠、实时更新仍会改变上方几何；正确性必须来自
**锚点保持 + 有界纠正**，而不是来自更准的估算。

## 3. 设计原则

1. **单一几何真源**：`CodeView.items[].top / height` 是唯一布局账本。禁止再建 Fenwick / RangeMap /
   第二套高度表；那会与 Pierre 的测量、分页、sticky 逻辑漂移。
2. **单一滚动写者**：任一时刻只有一种东西可以改变滚动位置：
   - 用户的滚轮 / 触摸 / 键盘 / 滚动条；
   - 一次显式 `scrollToItem` 揭示；
   - 引擎自己的布局锚点修正（`pendingLayoutAnchor`）。
   三者互斥；布局层不得直接写 `scrollTop`。
3. **锚点先于布局变更**：任何会改 `items[].height / top` 的事务，先捕获当前可见锚点，变更后把锚点
   交回引擎；不靠“滚一下再对”。
4. **揭示是有界事务，不是一次性调用**：意图 → 内容 → 几何，最多 4 次语义滚动；每次都有明确原因，
   不做逐帧像素追逐。
5. **首次点击是验收对象**：第二次点击准确不算通过；第二次点击只用于验证“没有额外重滚”。
6. **不做导航大闩**：不允许等全部上方文件 hydrated 才允许滚动；首次滚动仍可落在 estimate 上。

## 4. 终态架构

```
树点击 / 评论跳转 / 恢复阅读
        │
        ▼
┌───────────────────────────────┐
│ Reveal transaction            │
│ intent → content → geometry   │
│ ≤ 4 semantic scrolls          │
│ settle: 2 stable frames       │
│ cancel: user intent / unmount │
└───────────────┬───────────────┘
                │ scrollToItem(instant)
                ▼
┌───────────────────────────────┐
│ Pierre CodeView               │
│ items[].top/height 唯一账本    │
│ pendingLayoutAnchor 保持可见锚点│
└───────────────┬───────────────┘
                │ height/top mutation
                ▼
┌───────────────────────────────┐
│ Layout anchor keeper          │
│ capture → mutate → seed       │
│ 永不直接写 scrollTop           │
└───────────────────────────────┘
```

### 4.1 两层职责

| 层 | 负责 | 不负责 |
|---|---|---|
| Layout anchor keeper | 上方高度 / 顶部变化时保住当前可见内容 | 把某个树目标滚到顶部 |
| Reveal transaction | 把选中目标带到视口顶，并在目标被推走后纠正 | 修补所有布局变更；替代锚点保持 |

锚点保持让“用户正在看的东西”不动；揭示事务让“用户刚点的东西”到位。两者都不可省。

## 5. 锚点保持合同

### 5.1 锚点形状

```ts
export interface DiffVirtualLayoutAnchor {
  readonly id: string;
  readonly viewportOffset: number;
}
```

- `id`：锚点 item 的稳定 id。
- `viewportOffset`：`paddingTop + item.top - logicalScrollTop`，单位 CSS px。
- 捕获规则：取**最后一个** `paddingTop + item.top <= logicalScrollTop + 0.5` 的 item；若没有，取第一个
  item（视口在首个 item 之前）。
- 锚点必须来自 `items[]` 与逻辑 `getScrollTop()`，不得依赖 `renderState.firstIndex / lastIndex`；
  后者在成员首次物化或布局尚未建立时可能是 `-1`，这正是当前丢锚的窗口。

### 5.2 捕获与播种

```ts
export function captureDiffVirtualLayoutAnchor(
  viewer: unknown
): DiffVirtualLayoutAnchor | null;

export function seedPendingDiffLayoutAnchor(
  viewer: unknown,
  anchor: DiffVirtualLayoutAnchor | null
): boolean;
```

两者都只通过 `Reflect` 读取 / 写入 Pierre 的私有布局字段（`items`、`getHeight`、`getScrollTop`、
`getLayout`、`pendingLayoutAnchor`），不引入 `as never` / `as any` 逃逸。

`seedPendingDiffLayoutAnchor` 的唯一动作是把锚点写入引擎的
`pendingLayoutAnchor = { type: "item", id, viewportOffset }`，然后返回 `true`。它**不得**：

- 写 `scrollTop` / `scrollTo`；
- 覆盖已有的 `pendingLayoutAnchor`；
- 在 `pendingScrollTarget != null` 或 `scrollAnimation != null` 时播种；
- 在视口高度为 0（隐藏标签页）时播种；
- 在锚点 id 已不在 `items[]` 中时播种。

已有 `pendingLayoutAnchor` 时不覆盖：那可能是 Pierre 自己的行级锚点，或正在进行的导航。

### 5.3 布局事务边界

以下事务必须在变更前捕获、变更后播种：

- `reconcileDiffVirtualHeights`：全表重写前后；
- `installDiffVirtualHeightReconciler` 的 `recomputeLayout` 钩子：原函数返回后、`applyDiffVirtualHeights`
  返回 `true` 时；
- collapse-all 的 `computeRenderRangeAndEmit` 分支：原 emit 返回后、全表 apply 返回 `true` 时；
- 单槽折叠 `packages/ui/src/diff-view/use-headers.tsx`：`updateItem` 前捕获，`applyDiffVirtualHeights`
  后播种；`shouldAnchor` 为 true 时让 `scrollTo` 独占，不播种；
- 成员 / 正文更新 `applyCodeViewItemsAnchored`：`syncCodeViewItems` 前捕获；仅在正文变化或需要
  layout flush、且未通过 `scrollToResolvedAnchor` 显式重新定位时，在 flush 前播种。显式重新定位
  已由 `scrollTo` 独占滚动，不再播种。

`applyDiffVirtualHeightsPreservingAnchor(codeView, options, anchor?)` 是对外组合；第三个参数允许
调用方传入变更前已捕获的锚点，避免 `render(true)` 之后再捕获到过期位置：

```ts
const anchor = captureDiffVirtualLayoutAnchor(codeView);
const changed = applyDiffVirtualHeightsPreservingAnchor(codeView, options, anchor);
```

### 5.4 为什么不是第二套几何表

第二套表要自己处理：测量、估高替换、折叠、分页（Pierre 在 12,000,000 px 后分页）、sticky、gap、
clamp。任何一项与 Pierre 不同，都会产生“表里对、屏幕错”。锚点保持只读取当前 `items[]`，不做平行
布局，因此不会漂移。

## 6. 有界揭示事务合同

### 6.1 进度

```ts
export interface ReviewRevealProgress {
  readonly sectionId: string;
  readonly cacheKey: string;
  readonly scrollCount: number;
  readonly contentCommits: number;
  readonly geometryCorrections: number;
  readonly projectionRevision: number;
}
```

- `scrollCount`：本次导航已提交的语义 `scrollToItem` 次数。
- `contentCommits`：同一导航代次内正文 cacheKey 提交次数，最多 1。
- `geometryCorrections`：其中因布局漂移而提交的次数，最多 2。
- `projectionRevision`：最近一次提交时的 `projectionRevisionRef`，只用于证据 / 探针，不作为逐帧门闩。

### 6.2 计划

```ts
export type ReviewRevealPlan =
  | { readonly kind: "scroll-intent" }
  | { readonly kind: "scroll-content"; readonly progress: ReviewRevealProgress }
  | { readonly kind: "scroll-geometry"; readonly progress: ReviewRevealProgress }
  | { readonly kind: "settle" }
  | { readonly kind: "wait" };

export const MAX_REVIEW_REVEAL_SCROLLS = 4;
export const MAX_REVIEW_REVEAL_GEOMETRY_CORRECTIONS = 2;
export const MAX_REVIEW_REVEAL_CONTENT_COMMITS = 1;
export const REVIEW_REVEAL_OFFSET_TOLERANCE_PX = 1;
```

`planReviewReveal` 的输入：

```ts
interface ReviewRevealPlanInput {
  readonly expectedViewportOffset: number;
  readonly isEstimate: boolean;
  readonly progress: ReviewRevealProgress | null;
  readonly projectionRevision: number;
  readonly target: { readonly cacheKey: string; readonly sectionId: string } | null;
  readonly targetVisible: boolean;
  readonly viewportOffset: number | null;
  readonly viewportReady: boolean;
  readonly viewportSettled: boolean;
  readonly windowAcknowledged: boolean;
}
```

判定顺序：

1. `viewportReady === false` → `wait`。隐藏标签页 0×0 不得提交滚动。
2. `target === null` → `wait`；调用方另行判断终态。
3. `progress === null` 或 `progress.sectionId !== target.sectionId` → `scroll-intent`。
4. `progress.cacheKey !== target.cacheKey`：
   - estimate → `wait`（骨架头可见 ≠ 内容已提交）；
   - `contentCommits >= 1` 且 `viewportSettled` → `settle`（同一代次只允许一次正文提交）；
   - `contentCommits >= 1` 且未稳定 → `wait`；
   - `scrollCount >= 4` 且 `viewportSettled` → `settle`（滚动预算耗尽，不再追新 cacheKey）；
   - `scrollCount >= 4` 且未稳定 → `wait`；
   - 否则 → `scroll-content`，`scrollCount + 1`，`contentCommits + 1`。
5. estimate → `wait`。
6. 计算漂移：
   ```ts
   const drift =
     viewportOffset === null
       ? !targetVisible
       : Math.abs(viewportOffset - expectedViewportOffset) >
         REVIEW_REVEAL_OFFSET_TOLERANCE_PX;
   ```
7. 未 `viewportSettled` → `wait`。几何纠正只在连续稳定帧后提交。
8. `drift && geometryCorrections < 2 && scrollCount < 4` → `scroll-geometry`，
   `scrollCount + 1`，`geometryCorrections + 1`。
9. `targetVisible && viewportSettled && windowAcknowledged` → `settle`。
10. 预算耗尽（`scrollCount >= 4` 或 `geometryCorrections >= 2`）且 `viewportSettled` → `settle`，
    不再无限 pending；即使目标仍不可见也落定，保留选中态，让用户可再次点击重新武装事务。
11. 其余 → `wait`。

### 6.3 提交规则

- `scroll-intent`：`progress = { sectionId, cacheKey, scrollCount: 1, contentCommits: 0,
  geometryCorrections: 0, projectionRevision }`，然后 `scrollToItem(sectionId, { behavior:
  "instant", expandCollapsed: reason !== "restore", offset: anchorOffset })`。
- `scroll-content`：用计划返回的 progress，再 `scrollToItem`；不清空 `geometryCorrections`。
- `scroll-geometry`：用计划返回的 progress，再 `scrollToItem`；相同 `behavior` / `offset`。
- 任一 `scrollToItem` 返回 `false`：清空 progress，回到 `wait` 并重新挂 `scheduleVerification()`，
  不得假装已定位，也不得静默停摆。
- 提交后：`viewportLayoutSettledRef.current = false`，调用 `scheduleVerification()`。
- `settle`：调用 `finishTerminal()`；保留 `selectedEntryKey / selectedSectionKey`。
- 用户滚轮 / 触摸 / 键盘 / 滚动条 / 指针按下：现有 `clearForUserIntent()` 清空 pending 与 progress，
  事务立即结束；程序化滚动不算用户意图。

### 6.4 目标视口偏移

`PierDiffViewHandle` 增加：

```ts
getViewportOffsetForItem(id: string): number | null;
```

实现：目标已渲染时返回 `getTopForItem(id) - getScrollTop()`，未渲染返回 `null`。

- `getTopForItem` 已含 `paddingTop`；`getScrollTop()` 是逻辑滚动位置（不是裸 `root.scrollTop`）。
- 树导航期望偏移 = `navigation.anchorOffset ?? 0`；恢复 / 评论带 `anchorOffset` 时不得把非零期望误判为漂移。
- 偏移容差 1 CSS px，与 `headerFlushPx ≤ 1` 同一尺度。

## 7. 边界与失败

### 7.1 隐藏标签页

Dockview 保留 0×0 的 CodeView 时：

- `isViewportReady() === false` → 事务 `wait`，不提交 `scrollTo`；
- 锚点保持也不播种（`getHeight() === 0`）；
- 切回可见后，`use-viewport-effects` 的恢复 / retry 重新进入事务。

### 7.2 estimate 目标

- 首次 `scroll-intent` 允许打在 estimate 上；这是 pending_scroll 的产品语义。
- `isReviewEstimateCacheKey(target.cacheKey)` 为 true 时不得把“骨架头可见”当成内容提交，也不得
  settle。
- estimate → loaded 的 cacheKey 变化只允许一次 `scroll-content`，不重置几何纠正预算。

### 7.3 目标被移除 / 换 section

- `currentScrollTarget` 返回 null 时，按现有终态逻辑 `finishTerminal()`；不得继续滚动。
- stage 换 group 导致 `sectionKey` 变化时，由 `resolveReviewSectionKey` 重绑；progress 的 `sectionId`
  不匹配即重新 `scroll-intent`。

### 7.4 目标在前序内容中消失

- 锚点 item 被移除时，`seedPendingDiffLayoutAnchor` 不得猜后继；锚点失效即返回 `false`。
- 该帧的可见位置由现有 `applyCodeViewItemsAnchored` 的身份迁移 / 后继锚点逻辑处理；揭示事务在
  layout settled 后按漂移纠正。

### 7.5 折叠全部 / 单槽折叠

- collapse-all：全表高度变化必须保持当前顶部锚点；不得因为折叠把视口弹回顶部。
- 单槽折叠且 `shouldAnchor === true`：由 `scrollTo` 把该槽带到顶部，锚点保持让位。
- 单槽折叠且 `shouldAnchor === false`：锚点保持生效，顶部可见内容不跳。

### 7.6 用户滚动

- 用户滚轮 / 触摸 / 键盘 / 滚动条拖动 / 指针按下立即取消 pending 与 progress。
- 事务不得在用户滚动后“抢回”目标；再次点击树会创建新事务。
- 程序化 `scrollToItem` 触发的 scroll 事件不算用户意图。

### 7.7 实时更新

- 目标上方文件因 watch 更新从 loaded 变成新 loaded：若高度变化，锚点保持先保视口；若目标被推走，
  在 settled 后允许一次 `scroll-geometry`。
- 目标自身 cacheKey 更新：走 `scroll-content`；若预算已耗尽，落定并保留选中态。

## 8. 与旧规格的关系

本文对
[`2026-07-31-git-review-gold-standard-endstate-design.md`](2026-07-31-git-review-gold-standard-endstate-design.md)
做以下**显式修订**：

| 旧文 | 旧要求 | 本文修订 |
|---|---|---|
| §7 导航终态 | 有 location 只 `scrollTo` 一次 | 首次 `scroll-intent` 不变；允许一次 `scroll-content` 与至多两次 `scroll-geometry` |
| §8 验收 | “禁止为像素再滚一次” | 禁止**逐帧像素追逐**；允许有界、语义化的几何纠正（≤2） |
| §12 探针 | `scrollToCount ≤ 1` | `scrollToCount ≤ 4`，并记录 `scrollIntents / contentCommits / geometryCorrections`；`headerFlushPx ≤ 1` 不变 |
| §7 单写者 | membership 不得与 scrollTo 并行 | 不变；锚点保持只播种 `pendingLayoutAnchor`，不写 `scrollTop` |

旧文的 bodyClass、Z2 批摘录、失败态、8s hydrate timeout、soft-retain、estimate 骨架几何全部继续有效。

## 9. 验收（DoD）

### 9.1 行为

- 冷启动、目标上方全部 estimate：首次点击后，目标 header 最终距滚动根 ≤ 1 CSS px。
- 目标上方文件在首次滚动后从 estimate 结算为 loaded：仍 ≤ 1 px；允许一次几何纠正，不允许持续抖动。
- 第二次点击同一文件：不产生额外语义滚动（`scrollCount` 不增加）。
- 目标自身 estimate → loaded：只增加一次 `scroll-content`。
- 用户滚轮 / 滚动条拖动后：事务取消，不再自动拉回。
- 隐藏标签页切回：首次可见点击准确；0×0 期间 `scrollToItem` 调用为 0。
- collapse-all / 单槽折叠：顶部可见内容不跳；`shouldAnchor` 单槽仍到顶。
- 实时更新目标上方：阅读位置不被推走；若目标被推走，最多两次纠正后落定。

### 9.2 探针

测试 / E2E 暴露只读计数（可放 `data-*` 或测试句柄，不新增产品 UI）。生产代码由
`readReviewRevealProbe(progress)` 从真实 `ReviewRevealProgress` 派生，不维护平行计数器：

- `scrollToCount`：语义 `scrollToItem` 次数，≤ 4；
- `scrollIntentCount`：≤ 1；
- `contentCommitCount`：≤ 1（同一导航代次）；
- `geometryCorrectionCount`：≤ 2；
- `headerFlushPx`：≤ 1；
- `anchorDeltaPx`：布局事务前后锚点视口偏移差 ≤ 1（无导航时）。

### 9.3 回归测试

- 纯计划器矩阵：intent / content / geometry / settle / wait / 预算耗尽。
- 锚点捕获与播种：最后一个越过顶部的 item、paddingTop、已有锚点不覆盖、pending target 不覆盖、
  0 高度不播种。
- 导航 hook：首次滚动、上方结算后的几何纠正、预算耗尽后落定、`scrollToItem` false 清进度、用户取消。
- 现有 `panels.test.tsx` 的“迟到 sibling 不重复滚”必须继续通过；新增“目标上方迟到结算”用例。

## 10. 非目标

- 不替换 Pierre CodeView，不引入第二套虚拟列表。
- 不预加载全部上方文件后才允许滚动。
- 不按每帧测量结果反复 `scrollTo`。
- 不修改树点击的选中语义、不新增“定位中”产品 UI、不改文案。
- 不修改 Markdown / Files 的滚动行为；本文只覆盖 Git Review 的揭示事务与共享 diff-view 布局锚点。

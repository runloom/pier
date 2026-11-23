# Git Review 揭示事务与布局锚点 Implementation Plan

> **For the implementing agent:** execute this plan task by task. Use TDD: write the failing test, run it, implement the smallest change, run it green. Do not batch tasks or skip the failing step.
>
> **本次执行覆盖：** 直接在当前 worktree 修改；**禁止任何 git 操作**（包括 `git status` / `git diff` / `git add` / `git commit` / 分支切换）。下文所有 commit 步骤一律跳过。
>
> **执行状态（2026-11-23）：** 已按 Subagent-Driven 在当前 worktree 完成 Tasks 2–6；Task 7 的自动化门禁已通过，生产窗口首击手工验收待做。本文件与代码均未提交。
>
> **代码审查后的实现偏差：** 锚点捕获 / 播种改为经 `Reflect` 读取 Pierre 私有字段，移除 `DiffVirtualLayoutSource` 与 `as never`；`ReviewRevealProgress` 增加 `contentCommits`，新增 `MAX_REVIEW_REVEAL_CONTENT_COMMITS`、`readReviewRevealProbe`；`getViewportOffsetForItem` 改为必选合同。下文任务片段保留原始计划形态，最终合同以 spec 为准。

**Goal:** 让 Git Review 树点击在首次点击、目标上方 estimate → loaded、实时更新和隐藏标签页恢复时都落到目标文件头（≤1 CSS px），并保证任何上方高度变化都不把当前阅读位置推走。

**Architecture:** 在 Pierre CodeView 的 `items[].top / height` 单一几何账本上增加两层：  
1) **布局锚点保持**：`capture → mutate → seed pendingLayoutAnchor`，布局层永不直接写 `scrollTop`。  
2) **有界揭示事务**：`intent → content → geometry`，最多 4 次语义滚动、最多 2 次几何纠正，稳定 2 帧后 settle；用户滚动立即取消。  
不引入第二套高度表，不替换 CodeView，不做“等全部上方 hydrated”的导航大闩。

**Tech Stack:** TypeScript 6 strict · React 19 · Pierre `@pierre/diffs` 1.2.12 CodeView · Vitest 4 · Testing Library · Biome/Ultracite。

**Spec:** [`docs/superpowers/specs/2026-11-23-git-review-reveal-anchor-gold-standard.md`](../specs/2026-11-23-git-review-reveal-anchor-gold-standard.md)

## Global Constraints

- 几何真源只能是 `CodeView.items[].top / height`；禁止 Fenwick / RangeMap / 第二套高度表。
- 任一时刻只有一个滚动写者：用户手势、显式 `scrollToItem`、引擎 `pendingLayoutAnchor` 互斥。
- 布局层禁止直接写 `scrollTop`；只允许写 `pendingLayoutAnchor`。
- 首次点击是验收对象；第二次点击准确不算通过。
- `scrollToCount ≤ 4`、`scrollIntentCount ≤ 1`、`contentCommitCount ≤ 1`、`geometryCorrectionCount ≤ 2`、`headerFlushPx ≤ 1`、`anchorDeltaPx ≤ 1`。
- 不新增产品 UI、文案、颜色或设置；不改树点击选中语义。
- 目录密度硬上限：`packages/ui/src/diff-view` 40、`src/plugins/builtin/git/renderer/review` 40、`src/plugins/builtin/git/renderer/hooks` 36 个直接源码文件。**不得新增直接文件**；新逻辑进现有文件或子目录。
- 单文件 ≤ 500 行；提交前 `pnpm check:file-size`、`pnpm check:dir-density` 必须通过。
- 不 commit / push 直到每个任务自己的 TDD 步骤完成；提交信息用 Conventional Commits。
- **本次执行禁止任何 git 操作**；所有 commit / push 步骤跳过。
- 旧规格 §7 / §8 / §12 已被新规格显式修订；实现不得再以“只允许一次 scrollTo”卡住有界纠正。

---

## File Structure

### Modified

| 文件 | 责任 |
|---|---|
| `packages/ui/src/diff-view/item-anchor.ts` | 新增布局锚点捕获 / 播种；现有渲染锚点保持不变 |
| `packages/ui/src/diff-view/layout-apply.ts` | 高度 / top 改写事务接入锚点保持 |
| `packages/ui/src/diff-view/item-sync.ts` | 成员 / 正文提交接入锚点保持 |
| `packages/ui/src/diff-view/use-headers.tsx` | 单槽折叠接入锚点保持 |
| `packages/ui/src/diff-view/handle-types.ts` | `getViewportOffsetForItem` 合同 |
| `packages/ui/src/diff-view/use-handle.ts` | 实现 `getViewportOffsetForItem` |
| `src/plugins/builtin/git/renderer/review/navigation.ts` | 纯 `planReviewReveal` + progress 类型 / 常量 |
| `src/plugins/builtin/git/renderer/hooks/use-navigation-try.ts` | 用揭示事务替换一次性 refs |
| `src/plugins/builtin/git/renderer/hooks/use-navigation.ts` | 用 `revealProgressRef` 替换四个 `lastScrolled*` refs |
| `tests/unit/renderer/git/review/panels.test.tsx` | mock handle 增加 viewport offset，补首次点击 / 上方结算 / 预算用例 |
| `tests/unit/renderer/git/review/navigation.test.ts` | 纯计划器矩阵 |
| `tests/unit/renderer/git/review-gold-standard-governance.test.ts` | 更新旧一次滚动断言 |
| `docs/superpowers/specs/2026-07-31-git-review-gold-standard-endstate-design.md` | 已加新规格指针；任务 1 只校验 |

### New

| 文件 | 责任 |
|---|---|
| `tests/unit/ui/diff-view/layout-anchor.test.ts` | 锚点捕获 / 播种 / 边界 |
| `tests/unit/ui/diff-view/layout-apply-anchor.test.ts` | `applyDiffVirtualHeights` 事务保持锚点 |
| `docs/superpowers/plans/2026-11-23-git-review-reveal-anchor.md` | 本计划 |

> 说明：`tests/unit/ui/diff-view/` 不在目录密度上限内；`packages/ui/src/diff-view` 已满 40 个直接文件，所以新逻辑只能进现有五个文件，不能新增 `layout-anchor.ts` 之类。

---

## Task 1: 锁规格与治理断言

**Files:**
- Verify: `docs/superpowers/specs/2026-07-31-git-review-gold-standard-endstate-design.md:1-8`
- Verify: `docs/superpowers/specs/2026-11-23-git-review-reveal-anchor-gold-standard.md`
- Modify: `tests/unit/renderer/git/review-gold-standard-governance.test.ts`
- Test: `tests/unit/renderer/git/review-gold-standard-governance.test.ts`

**Interfaces:**
- Consumes: 新规格 §8 修订表
- Produces: 治理测试允许 `use-navigation-try.ts` 出现 `planReviewReveal` / `revealProgressRef`，不再要求“单次定位”文案。

- [ ] **Step 1: 读现有治理断言**

  运行：
  ```bash
  pnpm vitest run tests/unit/renderer/git/review-gold-standard-governance.test.ts
  ```
  记录当前 G3 / G4 对 `applyDiffVirtualHeights`、`TREE_NAV_SCROLL_BEHAVIOR`、`不挂 loader.settled`、`isReviewEstimateCacheKey` 的断言。

- [ ] **Step 2: 写失败断言**

  在治理测试新增：
  ```ts
  it("allows a bounded reveal transaction instead of one-shot scrolling", () => {
    const trySource = readFileSync(
      "src/plugins/builtin/git/renderer/hooks/use-navigation-try.ts",
      "utf8"
    );
    expect(trySource).toContain("planReviewReveal");
    expect(trySource).toContain("revealProgressRef");
    expect(trySource).not.toContain("lastScrolledCacheKeyRef");
    expect(trySource).toContain("MAX_REVIEW_REVEAL_SCROLLS");
  });
  ```
  保留旧 G4 的 `TREE_NAV_SCROLL_BEHAVIOR` / `isReviewEstimateCacheKey` 断言。

- [ ] **Step 3: 运行，确认失败**

  ```bash
  pnpm vitest run tests/unit/renderer/git/review-gold-standard-governance.test.ts
  ```
  预期：新增断言失败，提示 `planReviewReveal` 不存在。

- [ ] **Step 4: 不实现功能，只把断言改成当前会通过的最小形态？**

  **不要。** 本任务只写测试；实现留给 Task 5。为避免中间提交红，把该 `it` 标记为 `it.skip` 并在 Task 5 去掉 `skip`，或把治理测试与 Task 5 合并提交。计划选择：**本任务不单独提交**，在 Task 5 一起提交。

- [ ] **Step 5: 校验规格指针**

  ```bash
  rg -n "2026-11-23-git-review-reveal-anchor" docs/superpowers/specs/2026-07-31-git-review-gold-standard-endstate-design.md
  ```
  预期：第 4 行命中。

---

## Task 2: 布局锚点捕获与播种

**Files:**
- Modify: `packages/ui/src/diff-view/item-anchor.ts`
- Test: `tests/unit/ui/diff-view/layout-anchor.test.ts` (new)

**Interfaces:**
- Consumes: CodeView-like `items[]`、`getLayout()`、`getScrollTop()`、`getHeight()`、`pendingLayoutAnchor`、`pendingScrollTarget`、`scrollAnimation`
- Produces:
  ```ts
  export interface DiffVirtualLayoutAnchor {
    readonly id: string;
    readonly viewportOffset: number;
  }
  export function captureDiffVirtualLayoutAnchor(
    viewer: DiffVirtualLayoutSource | null | undefined
  ): DiffVirtualLayoutAnchor | null;
  export function seedPendingDiffLayoutAnchor(
    viewer: DiffVirtualLayoutSource | null | undefined,
    anchor: DiffVirtualLayoutAnchor | null
  ): boolean;
  ```
- 不改变现有 `captureDiffViewItemAnchor` / `captureDiffViewTopAnchor` 签名。

- [ ] **Step 1: 写失败测试**

  新建 `tests/unit/ui/diff-view/layout-anchor.test.ts`：
  ```ts
  import {
    captureDiffVirtualLayoutAnchor,
    seedPendingDiffLayoutAnchor,
  } from "@pier/ui/diff-view/item-anchor.ts";

  function viewer(items: Array<{ id: string; top: number }>, scrollTop: number) {
    return {
      getHeight: () => 600,
      getLayout: () => ({ gap: 1, paddingTop: 8 }),
      getScrollTop: () => scrollTop,
      items: items.map(({ id, top }) => ({
        height: 100,
        instance: { height: 100, top },
        item: { id },
        top,
        type: "diff",
      })),
      pendingLayoutAnchor: undefined as unknown,
      pendingScrollTarget: undefined as unknown,
      scrollAnimation: undefined as unknown,
    };
  }

  describe("captureDiffVirtualLayoutAnchor", () => {
    it("picks the last item whose top is at or above the viewport", () => {
      expect(
        captureDiffVirtualLayoutAnchor(
          viewer([
            { id: "a", top: 0 },
            { id: "b", top: 101 },
            { id: "c", top: 202 },
          ], 150)
        )
      ).toEqual({ id: "b", viewportOffset: 8 + 101 - 150 });
    });

    it("falls back to the first item when the viewport is above it", () => {
      expect(
        captureDiffVirtualLayoutAnchor(
          viewer([{ id: "a", top: 0 }, { id: "b", top: 101 }], -20)
        )
      ).toEqual({ id: "a", viewportOffset: 28 });
    });

    it("returns null without a measurable viewport", () => {
      const source = viewer([{ id: "a", top: 0 }], 0);
      source.getHeight = () => 0;
      expect(captureDiffVirtualLayoutAnchor(source)).toBeNull();
      expect(captureDiffVirtualLayoutAnchor(null)).toBeNull();
    });
  });

  describe("seedPendingDiffLayoutAnchor", () => {
    it("writes an item anchor without touching scrollTop", () => {
      const source = viewer([{ id: "a", top: 0 }], 40);
      let writtenScrollTop = 0;
      Object.defineProperty(source, "scrollTop", {
        get: () => writtenScrollTop,
        set: (value: number) => {
          writtenScrollTop = value;
        },
      });
      expect(
        seedPendingDiffLayoutAnchor(source, {
          id: "a",
          viewportOffset: 12,
        })
      ).toBe(true);
      expect(source.pendingLayoutAnchor).toEqual({
        id: "a",
        type: "item",
        viewportOffset: 12,
      });
      expect(writtenScrollTop).toBe(0);
    });

    it("does not overwrite a pending target, animation, or anchor", () => {
      for (const key of [
        "pendingLayoutAnchor",
        "pendingScrollTarget",
        "scrollAnimation",
      ] as const) {
        const source = viewer([{ id: "a", top: 0 }], 0);
        source[key] = { id: "existing" };
        expect(
          seedPendingDiffLayoutAnchor(source, {
            id: "a",
            viewportOffset: 1,
          })
        ).toBe(false);
        expect(source[key]).toEqual({ id: "existing" });
      }
    });

    it("returns false for a zero-height or anchorless viewport", () => {
      const source = viewer([{ id: "a", top: 0 }], 0);
      source.getHeight = () => 0;
      expect(
        seedPendingDiffLayoutAnchor(source, { id: "a", viewportOffset: 1 })
      ).toBe(false);
      expect(seedPendingDiffLayoutAnchor(null, { id: "a", viewportOffset: 1 })).toBe(false);
      expect(seedPendingDiffLayoutAnchor(viewer([], 0), null)).toBe(false);
    });
  });
  ```

- [ ] **Step 2: 运行，确认失败**

  ```bash
  pnpm vitest run tests/unit/ui/diff-view/layout-anchor.test.ts
  ```
  预期：模块没有导出 `captureDiffVirtualLayoutAnchor`。

- [ ] **Step 3: 实现**

  在 `packages/ui/src/diff-view/item-anchor.ts` 末尾追加：
  ```ts
  interface DiffVirtualLayoutItem {
    readonly item?: { readonly id?: string };
    readonly top: number;
  }

  export interface DiffVirtualLayoutSource {
    readonly items?: readonly DiffVirtualLayoutItem[] | undefined;
    pendingLayoutAnchor?: unknown;
    pendingScrollTarget?: unknown;
    scrollAnimation?: unknown;
    getHeight?(): number;
    getLayout?(): { readonly paddingTop?: number } | undefined;
    getScrollTop?(): number;
  }

  export interface DiffVirtualLayoutAnchor {
    readonly id: string;
    readonly viewportOffset: number;
  }

  export function captureDiffVirtualLayoutAnchor(
    viewer: DiffVirtualLayoutSource | null | undefined
  ): DiffVirtualLayoutAnchor | null {
    const items = viewer?.items ?? [];
    const height = viewer?.getHeight?.() ?? 0;
    const scrollTop = viewer?.getScrollTop?.();
    if (
      items.length === 0 ||
      height <= 0 ||
      typeof scrollTop !== "number" ||
      !Number.isFinite(scrollTop)
    ) {
      return null;
    }
    const paddingTop = viewer?.getLayout?.()?.paddingTop ?? 0;
    let candidate: DiffVirtualLayoutItem | undefined;
    for (const item of items) {
      if (item.top > scrollTop + 0.5) {
        break;
      }
      candidate = item;
    }
    candidate ??= items[0];
    const id = candidate?.item?.id;
    if (typeof id !== "string") {
      return null;
    }
    return {
      id,
      viewportOffset: paddingTop + candidate.top - scrollTop,
    };
  }

  export function seedPendingDiffLayoutAnchor(
    viewer: DiffVirtualLayoutSource | null | undefined,
    anchor: DiffVirtualLayoutAnchor | null
  ): boolean {
    if (
      !(viewer && anchor) ||
      (viewer.getHeight?.() ?? 0) <= 0 ||
      viewer.pendingLayoutAnchor != null ||
      viewer.pendingScrollTarget != null ||
      viewer.scrollAnimation != null
    ) {
      return false;
    }
    viewer.pendingLayoutAnchor = {
      id: anchor.id,
      type: "item",
      viewportOffset: anchor.viewportOffset,
    };
    return true;
  }
  ```
  注意：`DiffVirtualLayoutSource` 的属性不能有 `readonly` 修饰 `pendingLayoutAnchor`，否则赋值报错；接口中保留可变。

- [ ] **Step 4: 运行，确认通过**

  ```bash
  pnpm vitest run tests/unit/ui/diff-view/layout-anchor.test.ts
  ```
  预期：`5 passed`。

- [ ] **Step 5: 提交**

  ```bash
  git add packages/ui/src/diff-view/item-anchor.ts tests/unit/ui/diff-view/layout-anchor.test.ts
  git commit -m "feat(diff-view): capture virtual layout anchor" -m "为 CodeView items 账本增加不依赖 renderState 的顶部锚点捕获，并只通过 pendingLayoutAnchor 播种。"
  ```

---

## Task 3: 布局改写保持锚点

**Files:**
- Modify: `packages/ui/src/diff-view/layout-apply.ts`
- Modify: `packages/ui/src/diff-view/item-sync.ts`
- Modify: `packages/ui/src/diff-view/use-headers.tsx`
- Test: `tests/unit/ui/diff-view/layout-apply-anchor.test.ts` (new)
- Test: `tests/unit/renderer/git/review/panels.test.tsx` (existing collapse tests)

**Interfaces:**
- Consumes: `captureDiffVirtualLayoutAnchor`, `seedPendingDiffLayoutAnchor`
- Produces: `applyDiffVirtualHeights` 行为不变（仍返回 changed），但 changed 时不得丢顶部锚点；新增
  `applyDiffVirtualHeightsPreservingAnchor` 仅内部使用。

- [ ] **Step 1: 写失败测试**

  新建 `tests/unit/ui/diff-view/layout-apply-anchor.test.ts`。构造一个只实现 `items`、`getLayout`、`getScrollTop`、`getHeight`、`pin` 所需字段的 CodeView double：
  ```ts
  it("seeds the current top anchor after heights shift downward", () => {
    const viewer = {
      items: [
        { height: 100, instance: { height: 100, top: 0 }, item: { id: "a" }, top: 0 },
        { height: 100, instance: { height: 100, top: 101 }, item: { id: "b" }, top: 101 },
      ],
      getHeight: () => 600,
      getLayout: () => ({ gap: 1, paddingTop: 8 }),
      getScrollTop: () => 0,
      pendingLayoutAnchor: undefined,
      pendingScrollTarget: undefined,
      scrollAnimation: undefined,
      scrollHeight: 201,
    };
    const options = {
      isUserCollapsed: () => false,
      metrics: { gap: 1 } as never,
    };
    const anchor = captureDiffVirtualLayoutAnchor(viewer);
    expect(anchor).toEqual({ id: "a", viewportOffset: 8 });

    viewer.items[0].height = 300;
    viewer.items[0].top = 0;
    viewer.items[1].top = 301;
    applyDiffVirtualHeightsPreservingAnchor(viewer, options);

    expect(viewer.pendingLayoutAnchor).toEqual({
      id: "a",
      type: "item",
      viewportOffset: 8,
    });
  });
  ```
  再补一条“已有 pendingScrollTarget 时不播种”和“未变化时不播种”。

- [ ] **Step 2: 运行，确认失败**

  ```bash
  pnpm vitest run tests/unit/ui/diff-view/layout-apply-anchor.test.ts
  ```
  预期：没有导出 `applyDiffVirtualHeightsPreservingAnchor`。

- [ ] **Step 3: 实现 layout-apply**

  在 `layout-apply.ts` 顶部导入：
  ```ts
  import {
    captureDiffVirtualLayoutAnchor,
    seedPendingDiffLayoutAnchor,
  } from "./item-anchor.ts";
  ```
  新增：
  ```ts
  export function applyDiffVirtualHeightsPreservingAnchor(
    codeView: unknown,
    options: DiffVirtualHeightOptions
  ): boolean {
    const anchor = captureDiffVirtualLayoutAnchor(
      codeView as DiffVirtualLayoutSource
    );
    const changed = applyDiffVirtualHeights(codeView, options);
    if (changed && anchor) {
      seedPendingDiffLayoutAnchor(
        codeView as DiffVirtualLayoutSource,
        anchor
      );
    }
    return changed;
  }
  ```
  `DiffVirtualLayoutSource` 从容导入类型。给 `CodeViewLike` 增加 `getScrollTop?: () => number`。

  修改：
  - `reconcileDiffVirtualHeights` 开头 `const anchor = capture...`；两处 `applyDiffVirtualHeights` 后如果 changed 且 anchor 存在则 `seed...`。
  - `installDiffVirtualHeightReconciler` 的 `recomputeLayout` 包装：捕获 → 原函数 → `apply` changed → 播种。
  - collapse-all `computeRenderRangeAndEmit` 分支：捕获 → 原 emit → `apply` changed → 播种 → pin。
  - 初始 `applyDiffVirtualHeights` 不需要播种（安装时没有用户阅读位置）。

- [ ] **Step 4: 接入 item-sync**

  在 `item-sync.ts` 导入两个 helper。`applyCodeViewItemsAnchored`：
  ```ts
  const layoutAnchor = captureDiffVirtualLayoutAnchor(
    instanceBefore as never
  );
  ```
  在 `syncCodeViewItems` 后：
  - 若 `focusId` 分支：不播种（`scrollTo` 独占）。
  - 若解析出 `nextId` 并调用 `scrollToResolvedAnchor`：不播种（显式锚点迁移独占）。
  - 其余 `accepted` 分支：`if (layoutAnchor) seedPendingDiffLayoutAnchor(instance, layoutAnchor);`，位置在 `flushCodeViewMembershipLayout(instance)` 之前。
  这样 `flush` 的布局测量会消费 `pendingLayoutAnchor`。

- [ ] **Step 5: 接入单槽折叠**

  `use-headers.tsx` 在 `handle.updateItem(nextItem)` 前：
  ```ts
  const layoutAnchor =
    preserveTopAnchor && !shouldAnchor
      ? captureDiffVirtualLayoutAnchor(viewer)
      : null;
  ```
  在 `applyDiffVirtualHeights(viewer, heightOptions)` 返回 changed 后、`pinCodeViewScrollHeight` 前：
  ```ts
  if (changed && layoutAnchor) {
    seedPendingDiffLayoutAnchor(viewer, layoutAnchor);
  }
  ```
  `shouldAnchor === true` 时不捕获、不播种，仍由现有 `handle.scrollTo` 独占。
  保留 `applyDiffVirtualHeights` 字符串（治理测试 G3）。

- [ ] **Step 6: 运行测试**

  ```bash
  pnpm vitest run tests/unit/ui/diff-view/layout-apply-anchor.test.ts tests/unit/renderer/git/review/panels.test.tsx
  ```
  预期：新测试通过；`panels.test.tsx` 既有折叠断言不回归。

- [ ] **Step 7: 提交**

  ```bash
  git add packages/ui/src/diff-view/layout-apply.ts packages/ui/src/diff-view/item-sync.ts packages/ui/src/diff-view/use-headers.tsx tests/unit/ui/diff-view/layout-apply-anchor.test.ts
  git commit -m "fix(diff-view): preserve layout anchor across height changes"
  ```

---

## Task 4: 暴露目标视口偏移

**Files:**
- Modify: `packages/ui/src/diff-view/item-anchor.ts`
- Modify: `packages/ui/src/diff-view/handle-types.ts`
- Modify: `packages/ui/src/diff-view/use-handle.ts`
- Test: `tests/unit/ui/diff-view/layout-anchor.test.ts`
- Test: `tests/unit/renderer/git/review/panels.test.tsx` (mock only)

**Interfaces:**
- Produces:
  ```ts
  export function diffViewItemViewportOffset(
    top: number | undefined,
    scrollTop: number | undefined
  ): number | null;

  // PierDiffViewHandle
  getViewportOffsetForItem(id: string): number | null;
  ```
  语义：`top - scrollTop`，两者必须 finite；否则 `null`。

- [ ] **Step 1: 写失败测试**

  在 `tests/unit/ui/diff-view/layout-anchor.test.ts` 增加：
  ```ts
  import { diffViewItemViewportOffset } from "@pier/ui/diff-view/item-anchor.ts";

  describe("diffViewItemViewportOffset", () => {
    it("returns the item offset from the logical viewport top", () => {
      expect(diffViewItemViewportOffset(120, 40)).toBe(80);
      expect(diffViewItemViewportOffset(8, 0)).toBe(8);
    });

    it("returns null for missing or non-finite geometry", () => {
      expect(diffViewItemViewportOffset(undefined, 0)).toBeNull();
      expect(diffViewItemViewportOffset(0, undefined)).toBeNull();
      expect(diffViewItemViewportOffset(Number.NaN, 0)).toBeNull();
      expect(diffViewItemViewportOffset(0, Number.POSITIVE_INFINITY)).toBeNull();
    });
  });
  ```

- [ ] **Step 2: 运行，确认失败**

  ```bash
  pnpm vitest run tests/unit/ui/diff-view/layout-anchor.test.ts
  ```
  预期：`diffViewItemViewportOffset` 未导出。

- [ ] **Step 3: 实现 helper**

  在 `item-anchor.ts` 追加：
  ```ts
  export function diffViewItemViewportOffset(
    top: number | undefined,
    scrollTop: number | undefined
  ): number | null {
    if (
      typeof top !== "number" ||
      typeof scrollTop !== "number" ||
      !Number.isFinite(top) ||
      !Number.isFinite(scrollTop)
    ) {
      return null;
    }
    return top - scrollTop;
  }
  ```

- [ ] **Step 4: 实现类型与 handle**

  `handle-types.ts` 在 `getViewportLayoutKey` 旁增加：
  ```ts
  /**
   * 目标 item 相对滚动视口顶部的偏移（CSS px）。
   * 未渲染 / 无实例时 null。只用于揭示事务判定，不得据此硬写 scrollTop。
   */
  getViewportOffsetForItem(id: string): number | null;
  ```

  `use-handle.ts` 导入 `diffViewItemViewportOffset`，在 `getScrollTop` 旁增加：
  ```ts
  getViewportOffsetForItem(id: string): number | null {
    const viewer = codeViewRef.current?.getInstance();
    return diffViewItemViewportOffset(
      viewer?.getTopForItem(id),
      viewer?.getScrollTop()
    );
  },
  ```
  `getTopForItem` 已包含 `paddingTop`；`getScrollTop` 是逻辑滚动位置。不要用 `resolveScrollContainer().scrollTop`。

- [ ] **Step 5: 更新测试 mock**

  `panels.test.tsx` 的 `PierDiffView` mock 增加：
  ```ts
  const viewportOffset = vi.hoisted(() => vi.fn(() => 0));
  // within mock:
  getViewportOffsetForItem: (id: string) => viewportOffset(id),
  ```
  `beforeEach` 加 `viewportOffset.mockReset(); viewportOffset.mockReturnValue(0);`。Task 6 复用同一个 hoisted mock。

- [ ] **Step 6: 运行**

  ```bash
  pnpm typecheck
  pnpm vitest run tests/unit/ui/diff-view/layout-anchor.test.ts tests/unit/renderer/git/review/panels.test.tsx
  ```
  预期：类型通过；新 helper 测试与现有导航用例通过。

- [ ] **Step 7: 提交**

  ```bash
  git add packages/ui/src/diff-view/item-anchor.ts packages/ui/src/diff-view/handle-types.ts packages/ui/src/diff-view/use-handle.ts tests/unit/ui/diff-view/layout-anchor.test.ts tests/unit/renderer/git/review/panels.test.tsx
  git commit -m "feat(diff-view): expose item viewport offset"
  ```

---

## Task 5: 纯揭示计划器

**Files:**
- Modify: `src/plugins/builtin/git/renderer/review/navigation.ts`
- Test: `tests/unit/renderer/git/review/navigation.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ReviewRevealProgress {
    readonly cacheKey: string;
    readonly geometryCorrections: number;
    readonly projectionRevision: number;
    readonly scrollCount: number;
    readonly sectionId: string;
  }
  export type ReviewRevealPlan =
    | { readonly kind: "scroll-intent" }
    | {
        readonly kind: "scroll-content";
        readonly progress: ReviewRevealProgress;
      }
    | {
        readonly kind: "scroll-geometry";
        readonly progress: ReviewRevealProgress;
      }
    | { readonly kind: "settle" }
    | { readonly kind: "wait" };
  export interface ReviewRevealInput {
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
  export const MAX_REVIEW_REVEAL_SCROLLS = 4;
  export const MAX_REVIEW_REVEAL_GEOMETRY_CORRECTIONS = 2;
  export const REVIEW_REVEAL_OFFSET_TOLERANCE_PX = 1;
  export function planReviewReveal(input: ReviewRevealInput): ReviewRevealPlan;
  ```
- `nextProgress` 内部复制并递增 `scrollCount` / `geometryCorrections`；`projectionRevision` 用输入值覆盖。

- [ ] **Step 1: 写失败测试**

  在 `tests/unit/renderer/git/review/navigation.test.ts` 增加：
  ```ts
  describe("planReviewReveal", () => {
    const target = { cacheKey: "cache:1", sectionId: "section:1" };
    const progress = {
      cacheKey: "cache:1",
      geometryCorrections: 0,
      projectionRevision: 0,
      scrollCount: 1,
      sectionId: "section:1",
    };
    const base = {
      expectedViewportOffset: 0,
      isEstimate: false,
      progress,
      projectionRevision: 1,
      target,
      targetVisible: true,
      viewportOffset: 0,
      viewportReady: true,
      viewportSettled: true,
      windowAcknowledged: true,
    };

    it("waits for a ready viewport and a target", () => {
      expect(
        planReviewReveal({ ...base, viewportReady: false })
      ).toEqual({ kind: "wait" });
      expect(planReviewReveal({ ...base, target: null })).toEqual({
        kind: "wait",
      });
    });

    it("commits the first intent", () => {
      expect(planReviewReveal({ ...base, progress: null })).toEqual({
        kind: "scroll-intent",
      });
    });

    it("waits when the target is still an estimate", () => {
      expect(planReviewReveal({ ...base, isEstimate: true })).toEqual({
        kind: "wait",
      });
    });

    it("commits one content scroll when the cache key changes", () => {
      expect(
        planReviewReveal({ ...base, target: { ...target, cacheKey: "cache:2" } })
      ).toEqual({
        kind: "scroll-content",
        progress: {
          ...progress,
          cacheKey: "cache:2",
          scrollCount: 2,
        },
      });
    });

    it("does not commit content twice for the same cache key", () => {
      expect(
        planReviewReveal({
          ...base,
          progress: { ...progress, cacheKey: "cache:2", scrollCount: 2 },
          target: { ...target, cacheKey: "cache:2" },
        })
      ).toEqual({ kind: "settle" });
    });

    it("allows at most two geometry corrections", () => {
      const drifted = { ...base, viewportOffset: 120 };
      expect(planReviewReveal(drifted).kind).toBe("scroll-geometry");
      const once = {
        ...progress,
        geometryCorrections: 1,
        scrollCount: 2,
      };
      expect(
        planReviewReveal({
          ...drifted,
          progress: once,
        }).kind
      ).toBe("scroll-geometry");
      expect(
        planReviewReveal({
          ...drifted,
          progress: { ...once, geometryCorrections: 2, scrollCount: 3 },
        }).kind
      ).toBe("settle");
    });

    it("waits for layout to settle before geometry correction", () => {
      expect(
        planReviewReveal({ ...base, viewportOffset: 120, viewportSettled: false })
      ).toEqual({ kind: "wait" });
    });

    it("respects the total scroll budget", () => {
      expect(
        planReviewReveal({
          ...base,
          viewportOffset: 120,
          progress: { ...progress, scrollCount: 4 },
        }).kind
      ).toBe("settle");
    });

    it("settles instead of chasing a new cache key after the scroll budget", () => {
      expect(
        planReviewReveal({
          ...base,
          progress: { ...progress, scrollCount: 4 },
          target: { ...target, cacheKey: "cache:2" },
        })
      ).toEqual({ kind: "settle" });
      expect(
        planReviewReveal({
          ...base,
          progress: { ...progress, scrollCount: 4 },
          target: { ...target, cacheKey: "cache:2" },
          viewportSettled: false,
        })
      ).toEqual({ kind: "wait" });
    });

    it("settles when the target is visible and acknowledged", () => {
      expect(planReviewReveal(base)).toEqual({ kind: "settle" });
    });
  });
  ```
  同时补 `expectedViewportOffset` 非零时 `viewportOffset` 等于期望值不纠正。

- [ ] **Step 2: 运行，确认失败**

  ```bash
  pnpm vitest run tests/unit/renderer/git/review/navigation.test.ts
  ```
  预期：`planReviewReveal` 未导出。

- [ ] **Step 3: 实现纯计划器**

  在 `navigation.ts` 末尾追加常量和函数。关键顺序：
  ```ts
  export function planReviewReveal(input: ReviewRevealInput): ReviewRevealPlan {
    if (!input.viewportReady || input.target === null) {
      return { kind: "wait" };
    }
    const { progress, target } = input;
    if (progress === null || progress.sectionId !== target.sectionId) {
      return { kind: "scroll-intent" };
    }
    if (progress.cacheKey !== target.cacheKey) {
      if (input.isEstimate) {
        return { kind: "wait" };
      }
      if (progress.scrollCount >= MAX_REVIEW_REVEAL_SCROLLS) {
        return input.viewportSettled ? { kind: "settle" } : { kind: "wait" };
      }
      return {
        kind: "scroll-content",
        progress: {
          ...progress,
          cacheKey: target.cacheKey,
          projectionRevision: input.projectionRevision,
          scrollCount: progress.scrollCount + 1,
        },
      };
    }
    if (input.isEstimate) {
      return { kind: "wait" };
    }
    if (!input.viewportSettled) {
      return { kind: "wait" };
    }
    const drift =
      input.viewportOffset === null
        ? !input.targetVisible
        : Math.abs(input.viewportOffset - input.expectedViewportOffset) >
          REVIEW_REVEAL_OFFSET_TOLERANCE_PX;
    if (
      drift &&
      progress.geometryCorrections < MAX_REVIEW_REVEAL_GEOMETRY_CORRECTIONS &&
      progress.scrollCount < MAX_REVIEW_REVEAL_SCROLLS
    ) {
      return {
        kind: "scroll-geometry",
        progress: {
          ...progress,
          geometryCorrections: progress.geometryCorrections + 1,
          projectionRevision: input.projectionRevision,
          scrollCount: progress.scrollCount + 1,
        },
      };
    }
    if (input.targetVisible && input.windowAcknowledged) {
      return { kind: "settle" };
    }
    if (
      progress.geometryCorrections >= MAX_REVIEW_REVEAL_GEOMETRY_CORRECTIONS ||
      progress.scrollCount >= MAX_REVIEW_REVEAL_SCROLLS
    ) {
      return { kind: "settle" };
    }
    return { kind: "wait" };
  }
  ```
  注意：`progress.sectionId !== target.sectionId` 时返回 `scroll-intent`，调用方必须重建 progress；不能沿用旧计数。

- [ ] **Step 4: 运行，确认通过**

  ```bash
  pnpm vitest run tests/unit/renderer/git/review/navigation.test.ts
  ```
  预期：新增用例全绿。

- [ ] **Step 5: 提交**

  ```bash
  git add src/plugins/builtin/git/renderer/review/navigation.ts tests/unit/renderer/git/review/navigation.test.ts
  git commit -m "feat(git-review): plan bounded reveal transaction"
  ```

---

## Task 6: 导航 hook 接入事务

**Files:**
- Modify: `src/plugins/builtin/git/renderer/hooks/use-navigation-try.ts`
- Modify: `src/plugins/builtin/git/renderer/hooks/use-navigation.ts`
- Modify: `tests/unit/renderer/git/review/panels.test.tsx`
- Modify: `tests/unit/renderer/git/review-gold-standard-governance.test.ts`

**Interfaces:**
- Consumes:
  ```ts
  planReviewReveal({
    expectedViewportOffset,
    isEstimate,
    progress: revealProgressRef.current,
    projectionRevision: projectionRevisionRef.current,
    target,
    targetVisible,
    viewportOffset: diffHandleRef.current?.getViewportOffsetForItem(
      target.sectionId
    ) ?? null,
    viewportReady,
    viewportSettled: viewportLayoutSettledRef.current,
    windowAcknowledged,
  })
  ```
- Produces: `use-navigation.ts` 内部 `revealProgressRef: RefObject<ReviewRevealProgress | null>`；不再有 `lastScrolledSectionRef / lastScrolledCacheKeyRef / lastScrolledLayoutKeyRef / lastScrolledProjectionRevisionRef`。

- [ ] **Step 1: 改测试 mock 与失败用例**

  `panels.test.tsx` 的 handle mock 增加：
  ```ts
  const viewportOffset = vi.hoisted(() => vi.fn(() => 0));
  // within mock:
  getViewportOffsetForItem: (id: string) => viewportOffset(id),
  ```
  `beforeEach` reset `viewportOffset.mockReset(); viewportOffset.mockReturnValue(0);`。

  新增用例：
  ```ts
  it("corrects once when a slot above the target grows after the first scroll", async () => {
    // 选择 section:3；首次 scrollTo 后 viewportOffset 返回 180（目标被上方结算推走）
    // 让 requestViewportLayoutSettled 回调触发
    // 断言 scrollToItem("section:3") 恰好 2 次：
    //   1 次 intent + 1 次 geometry correction
    // 第二次调用后 viewportOffset 返回 0
    // 最终 selected section 仍是 section:3
  });
  ```
  再补：
  - 第三次上方增长但预算已用完 → 不再调用 `scrollToItem`，选中保留。
  - 用户滚动后 `viewportOffset` 仍偏 → 不再拉回。
  - 目标 estimate 时只提交 1 次 intent，不提交 content。

  具体测试可以复用文件中现有的 `renderReview` / `settleLayout` helper；不要新造一套 harness。

- [ ] **Step 2: 运行，确认失败**

  ```bash
  pnpm vitest run tests/unit/renderer/git/review/panels.test.tsx -t "corrects once"
  ```
  预期：当前只调用一次 `scrollToItem`，断言失败。

- [ ] **Step 3: 改 `use-navigation-try.ts`**

  删除四个 `lastScrolled*` option，增加：
  ```ts
  readonly revealProgressRef: RefObject<ReviewRevealProgress | null>;
  ```
  在 `isViewportReady` 检查后：
  ```ts
  const viewportReady = diffHandleRef.current?.isViewportReady() === true;
  const targetVisible =
    diffHandleRef.current?.isItemVisible(target.sectionId, target.cacheKey) ===
    true;
  const viewportOffset =
    diffHandleRef.current?.getViewportOffsetForItem(target.sectionId) ?? null;
  const plan = planReviewReveal({
    expectedViewportOffset: navigation.anchorOffset ?? 0,
    isEstimate: isReviewEstimateCacheKey(target.cacheKey),
    progress: revealProgressRef.current,
    projectionRevision: projectionRevisionRef.current,
    target,
    targetVisible,
    viewportOffset,
    viewportReady,
    viewportSettled: viewportLayoutSettledRef.current,
    windowAcknowledged:
      acknowledgedTargetWindowRevisionRef.current >=
      requiredRenderWindowRevisionRef.current,
  });
  ```
  处理：
  - `wait` → `scheduleVerification()` 后 return。
  - `settle` → `finishTerminal()` 后 return。
  - `scroll-intent`：
    ```ts
    revealProgressRef.current = {
      cacheKey: target.cacheKey,
      geometryCorrections: 0,
      projectionRevision: projectionRevisionRef.current,
      scrollCount: 1,
      sectionId: target.sectionId,
    };
    ```
  - `scroll-content` / `scroll-geometry`：`revealProgressRef.current = plan.progress;`
  - 提交前 `viewportLayoutSettledRef.current = false;`，提交后失败清空 progress 并 return。
  - 调用参数保持 `behavior: TREE_NAV_SCROLL_BEHAVIOR, expandCollapsed: reason !== "restore", offset: navigation.anchorOffset`。
  - `scheduleVerification()`。
  - 保留注释 `不挂 loader.settled` 与 `isReviewEstimateCacheKey` 字样，满足治理 G4。

- [ ] **Step 4: 改 `use-navigation.ts`**

  - 删除四个 `lastScrolled*` refs 及所有 reset。
  - 新增：
    ```ts
    const revealProgressRef = useRef<ReviewRevealProgress | null>(null);
    ```
  - `armNavigation` / `beginGeneration` 里重置 `revealProgressRef.current = null`。
  - `tryGitReviewPendingNavigation({ ..., revealProgressRef, ... })`。
  - `clearForUserIntent` 里清空 `revealProgressRef.current = null`。
  - `finishTerminal` 里也清空，避免下一次导航沿用旧计数。
  - 删除 `use-navigation-try.ts` 不再使用的 import。

- [ ] **Step 5: 更新治理测试**

  去掉 Task 1 的 `it.skip`，让 `planReviewReveal` / `revealProgressRef` 断言生效；删除旧“只滚一次”断言（若与新规格冲突），保留 `TREE_NAV_SCROLL_BEHAVIOR`、`isReviewEstimateCacheKey`、`不挂 loader.settled`。

- [ ] **Step 6: 运行**

  ```bash
  pnpm vitest run tests/unit/renderer/git/review/panels.test.tsx tests/unit/renderer/git/review/navigation.test.ts tests/unit/renderer/git/review-gold-standard-governance.test.ts
  ```
  预期：全绿；新增“上方结算纠正一次”“预算耗尽落定”“用户滚动取消”通过。

- [ ] **Step 7: 提交**

  ```bash
  git add src/plugins/builtin/git/renderer/hooks/use-navigation-try.ts src/plugins/builtin/git/renderer/hooks/use-navigation.ts tests/unit/renderer/git/review/panels.test.tsx tests/unit/renderer/git/review-gold-standard-governance.test.ts
  git commit -m "fix(git-review): keep reveal alive until layout settles" -m "树导航改为有界揭示事务：intent、content、最多两次 geometry 纠正，并用 CodeView 布局锚点保住阅读位置。"
  ```

---

## Task 7: 全量校验与交付

**Files:**
- Verify only.

- [ ] **Step 1: 静态检查**

  ```bash
  pnpm typecheck
  pnpm lint
  pnpm check:file-size
  pnpm check:dir-density
  ```
  预期：全绿；允许既有 soft warning，不允许 hard fail。

- [ ] **Step 2: 相关单测 / 组件测试**

  ```bash
  pnpm vitest run tests/unit/ui/diff-view tests/unit/renderer/git/review tests/unit/plugins/markdown/git-bars-rail.test.tsx
  ```
  预期：全绿。

- [ ] **Step 3: 检查目录密度未新增直接文件**

  ```bash
  pnpm check:dir-density
  ```
  预期：`packages/ui/src/diff-view` 仍 40，`src/plugins/builtin/git/renderer/review` 仍 40，`src/plugins/builtin/git/renderer/hooks` 仍 36。

- [ ] **Step 4: 手工验收（生产窗口）**

  在长期存活的 Git Review 标签中：
  1. 关闭并重开 Git Review，让上方槽位处于 estimate；
  2. 首次点击一个远处文件；断言文件头贴顶（≤1 px），不需要第二次点击；
  3. 滚动到别处再点同一文件；断言只产生一次 intent，不重复滚；
  4. 拖动滚动条后等待；断言不再自动拉回；
  5. 折叠全部 / 展开全部；断言顶部阅读位置不跳。

- [ ] **Step 5: 记录探针**

  在测试或 E2E 中记录：`scrollToCount`、`scrollIntentCount`、`contentCommitCount`、`geometryCorrectionCount`、`headerFlushPx`、`anchorDeltaPx`。没有探针就不算完成首次点击验收。

- [ ] **Step 6: 最终提交（如手工验收只改测试）**

  ```bash
  git status --short
  git diff --stat
  git commit -m "test(git-review): cover first-click reveal under estimate growth"
  ```

---

## Self-Review

### Spec coverage

| 规格条目 | 覆盖任务 |
|---|---|
| 单一几何真源，不建第二套表 | Task 2 / 3（只读 `items[]`） |
| 单一滚动写者 | Task 3（只写 `pendingLayoutAnchor`）/ Task 6（唯一 `scrollToItem`） |
| 锚点捕获 / 播种边界 | Task 2 |
| 布局事务接入 | Task 3 |
| 揭示 intent / content / geometry / settle / wait | Task 5 / 6 |
| 首次点击验收 | Task 6 / 7 |
| estimate 目标 | Task 5 / 6 |
| 隐藏标签页 | Task 6（`viewportReady`） |
| 用户滚动取消 | Task 6（`clearForUserIntent`） |
| collapse-all / 单槽折叠 | Task 3 |
| 预算 / 稳定帧 / 容差 | Task 5 |
| 探针 | Task 7 |

### 类型一致性

- `ReviewRevealProgress.sectionId` 与 `PendingReviewNavigation.sectionKey` 命名不同是故意的：前者是 CodeView item id，后者是导航目标；`target.sectionId` 来自 `findReviewNavigationTarget`，二者最终同值。
- `getViewportOffsetForItem` 用 `viewer.getTopForItem - viewer.getScrollTop`，两者都是 CodeView 逻辑坐标；不要换成 `container.scrollTop`。
- `captureDiffVirtualLayoutAnchor` 的 `viewportOffset` 含 `paddingTop`，与 `scrollToItem` 的 `offset` 语义对齐。
- `seedPendingDiffLayoutAnchor` 的 `pendingLayoutAnchor` 形状必须与 Pierre 一致：`{ type: "item", id, viewportOffset }`。

### 风险与回退

- 风险：`pendingLayoutAnchor` 在成员首次物化时可能被 Pierre 清掉。回退：揭示事务的 geometry correction 仍会兜底；不要因此改为写 `scrollTop`。
- 风险：`applyCodeViewItemsAnchored` 播种与 `preserveAnchor` 显式恢复叠加。回退：`focusId` / 解析锚点迁移分支不播种；显式 `restoreAnchor` 在 `handle-update-items` 最后执行，优先级更高。
- 风险：collapse-all 每帧全表 apply 会重复捕获。回退：只在 `apply` 返回 changed 且当前没有 pending 时播种，已有 pending 不覆盖。
- 风险：新增 `getViewportOffsetForItem` 在旧 mock 中缺失。回退：调用方统一 `?.()` + `?? null`，缺失时计划器按 `targetVisible` 判断漂移。
- 风险：治理测试仍要求“只滚一次”。回退：Task 1 / 6 明确更新为“有界事务”，但保留 `TREE_NAV_SCROLL_BEHAVIOR`、`isReviewEstimateCacheKey`、`不挂 loader.settled`。

### Review Focus

1. **几何正确性**：锚点 `viewportOffset` 是否始终相对于逻辑滚动顶，而不是容器 raw scrollTop。
2. **单写者**：是否任何路径在 `pendingScrollTarget` / `scrollAnimation` 存在时仍播种锚点。
3. **预算**：content 与 geometry 是否共享 `scrollCount`，且不会因 cacheKey 变化重置 geometry 预算。
4. **首次点击**：测试是否覆盖“目标上方迟到结算”，而不是只覆盖“目标后方插入”。
5. **目录密度**：是否误在 `packages/ui/src/diff-view` 新增直接文件；是否把 `use-navigation-try.ts` 推过 500 行。
6. **旧规格冲突**：是否还有代码注释 / 测试断言坚持“只允许一次 scrollTo”。

## Execution Handoff

计划完成后，二选一：

1. **Subagent-Driven（推荐）**：每个 Task 派一个 worker，按 TDD 顺序执行；主代理逐 Task review，防止越界改文件。
2. **Inline Execution**：在当前会话按 Task 顺序执行，每个 Task 完成后跑测试并 commit。

选择后开始 Task 1。

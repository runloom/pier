# 大盘固定格宽与流式重排实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 大盘卡片格子像素恒定（88px），面板宽度只决定可用列数，放不下的卡片按阅读序流式换行；widget 内容用 container query 按卡片实际宽度重排。

**Architecture:** 持久化的 `widgets: [{id,x,y,w,h}]` 升级语义为 12 列基准布局（零迁移）。容器宽度换算可用列数 k：k≥12 原样渲染基准，k<12 用纯函数 `deriveLayout` 派生 k 列排布（派生结果不持久化）。派生模式下 resize 直存基准 w/h，拖拽映射为阅读序重排后对基准 12 列重新装箱。widget 内容层在卡片 `CardContent` 上开 `@container`，内部用 Tailwind v4 容器查询变体。

**Tech Stack:** react-grid-layout v2.2（`gridConfig.containerPadding`、`LayoutItem`）、Tailwind CSS v4（原生 container queries）、Zod（逐条抢救解析）、Vitest 4 + Testing Library。

**设计文档：** `docs/superpowers/specs/2026-07-06-dashboard-responsive-layout-design.md`

**提交规约（项目安全边界）：** 本仓库 Git 默认只读。每个 Commit 步骤执行前必须：只 stage 步骤中列出的明确路径，展示 `git diff --staged` 与拟用提交信息，**取得用户确认后再 commit**。禁止 `git add .`。

---

## 背景速览（给零上下文工程师）

- 大盘面板：`src/renderer/panel-kits/dashboard/dashboard-panel.tsx`，用 react-grid-layout（下称 RGL）渲染 12 列网格，现状列宽 = 容器宽 ÷ 12（比例缩放，本计划要改掉）。
- 几何工具：`src/renderer/panel-kits/dashboard/dashboard-grid-geometry.ts`（`ROW_HEIGHT = 88`、`MARGIN = [12,12]`、first-fit 装箱）。
- 持久化：dockview panel params（`props.params`），schema 在 `src/shared/contracts/dashboard.ts`。
- RGL v2 API：`<GridLayout gridConfig={{cols, margin, rowHeight, containerPadding}} width={px} layout={...} onLayoutChange={...}>`；`LayoutItem = {i, x, y, w, h, minW?, maxW?, minH?, maxH?}`。**注意 `containerPadding` 不显式传时默认取 margin 值**。
- 测试：`pnpm vitest run <文件路径>` 跑单个文件；`pnpm test:unit` / `pnpm test:component` 跑分类；`pnpm check` 全量门禁。
- jsdom 中无 ResizeObserver，`useContainerWidth`（`src/renderer/hooks/use-container-width.ts`）回退 800px——组件测试因此**确定性地**得到 k=8（派生模式）。

---

### Task 1: 几何常量与派生布局纯函数

**Files:**
- Modify: `src/renderer/panel-kits/dashboard/dashboard-grid-geometry.ts`
- Test: `tests/unit/renderer/dashboard-grid-geometry.test.ts`

- [ ] **Step 1: 写失败测试（追加到现有测试文件末尾）**

```ts
// ---- 追加 import（合并进文件顶部现有 import 语句）----
// deriveLayout, computeAvailableCols, gridPixelWidth, CELL_WIDTH 来自
// "@/panel-kits/dashboard/dashboard-grid-geometry.ts"

describe("computeAvailableCols", () => {
  // k = clamp(1, floor((contentWidth + 12) / 100), 12)
  it("788px 内容宽 → 8 列", () => {
    expect(computeAvailableCols(788)).toBe(8);
  });

  it("宽面板 clamp 到 12 列上限", () => {
    expect(computeAvailableCols(5000)).toBe(12);
  });

  it("极窄面板 clamp 到 1 列下限", () => {
    expect(computeAvailableCols(50)).toBe(1);
  });

  it("恰好 12 列的临界宽度 1188px", () => {
    expect(computeAvailableCols(1188)).toBe(12);
    expect(computeAvailableCols(1187)).toBe(11);
  });
});

describe("gridPixelWidth", () => {
  it("k 列像素宽 = k*100 - 12", () => {
    expect(gridPixelWidth(12)).toBe(1188);
    expect(gridPixelWidth(8)).toBe(788);
    expect(gridPixelWidth(1)).toBe(88);
  });

  it("CELL_WIDTH = 88", () => {
    expect(CELL_WIDTH).toBe(88);
  });
});

describe("deriveLayout", () => {
  it("k≥所有卡片需求时按阅读序 first-fit 铺排", () => {
    const derived = deriveLayout(
      [
        { h: 2, i: "b", w: 4, x: 4, y: 0 },
        { h: 2, i: "a", w: 4, x: 0, y: 0 },
      ],
      8
    );
    // 阅读序 a(0,0) → b(4,0)，8 列同行放得下
    expect(derived).toEqual([
      { h: 2, i: "a", w: 4, x: 0, y: 0 },
      { h: 2, i: "b", w: 4, x: 4, y: 0 },
    ]);
  });

  it("放不下的卡片换行下移", () => {
    const derived = deriveLayout(
      [
        { h: 2, i: "a", w: 4, x: 0, y: 0 },
        { h: 3, i: "b", w: 6, x: 4, y: 0 },
      ],
      8
    );
    // b 宽 6，a 后同行只剩 4 → b 落第二行
    expect(derived.find((l) => l.i === "b")).toMatchObject({ x: 0, y: 2 });
  });

  it("w 超过 k 时 clamp 到 k，minW/maxW 同步 clamp", () => {
    const derived = deriveLayout(
      [{ h: 2, i: "a", w: 12, x: 0, y: 0, maxW: 12, minW: 6 }],
      4
    );
    expect(derived[0]).toMatchObject({ maxW: 4, minW: 4, w: 4, x: 0, y: 0 });
  });

  it("k=1 全部单列堆叠", () => {
    const derived = deriveLayout(
      [
        { h: 2, i: "a", w: 4, x: 0, y: 0 },
        { h: 3, i: "b", w: 4, x: 4, y: 0 },
      ],
      1
    );
    expect(derived).toEqual([
      { h: 2, i: "a", w: 1, x: 0, y: 0 },
      { h: 3, i: "b", w: 1, x: 0, y: 2 },
    ]);
  });

  it("确定性：同输入同输出，且不改输入数组", () => {
    const input = [
      { h: 2, i: "b", w: 4, x: 4, y: 0 },
      { h: 2, i: "a", w: 4, x: 0, y: 0 },
    ];
    const snapshot = JSON.stringify(input);
    expect(deriveLayout(input, 4)).toEqual(deriveLayout(input, 4));
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("同格坐标用 id 兜底排序保证确定性", () => {
    const derived = deriveLayout(
      [
        { h: 2, i: "z", w: 2, x: 0, y: 0 },
        { h: 2, i: "a", w: 2, x: 0, y: 0 }, // 脏数据：同坐标
      ],
      4
    );
    expect(derived[0]?.i).toBe("a");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/unit/renderer/dashboard-grid-geometry.test.ts`
Expected: FAIL（`computeAvailableCols` 等未导出）

- [ ] **Step 3: 实现**

对 `src/renderer/panel-kits/dashboard/dashboard-grid-geometry.ts` 做三处修改。

3a. `import type { LayoutItem } from "react-grid-layout";` 已存在，无需动。在 `MARGIN` 声明后追加：

```ts
/** 格子像素宽——固定值，卡片尺寸与面板宽度解耦（HA 模型）。与 ROW_HEIGHT 对齐成方格。 */
export const CELL_WIDTH = 88;

/** 一格占位（格宽 + 水平间距）。 */
const GRID_UNIT = CELL_WIDTH + MARGIN[0];

/**
 * 内容区宽度 → 可用列数 k ∈ [1, 12]。
 * k 列网格像素宽 = k*88 + (k-1)*12 = k*100 - 12，故 k = floor((w + 12) / 100)。
 */
export function computeAvailableCols(contentWidth: number): number {
  const k = Math.floor((contentWidth + MARGIN[0]) / GRID_UNIT);
  return Math.max(1, Math.min(DASHBOARD_GRID_COLS, k));
}

/** k 列网格的像素总宽（containerPadding 为 [0,0] 时）。 */
export function gridPixelWidth(cols: number): number {
  return cols * GRID_UNIT - MARGIN[0];
}

/** 阅读序比较：y 优先、x 其次、id 兜底（脏数据同坐标时仍确定）。 */
function readingOrderCompare(
  a: { id: string; x: number; y: number },
  b: { id: string; x: number; y: number }
): number {
  return a.y - b.y || a.x - b.x || a.id.localeCompare(b.id);
}

/**
 * 派生排布（k < 12 的窄容器）：基准 layout 按阅读序 first-fit 装入 k 列。
 * 纯函数、确定性、不修改输入；派生结果只用于渲染，绝不持久化。
 */
export function deriveLayout(
  items: readonly LayoutItem[],
  cols: number
): LayoutItem[] {
  const sorted = [...items].sort((a, b) =>
    readingOrderCompare({ id: a.i, x: a.x, y: a.y }, { id: b.i, x: b.x, y: b.y })
  );
  const placed: LayoutItem[] = [];
  for (const item of sorted) {
    const w = Math.min(item.w, cols);
    const pos = findFirstFit(placed, w, item.h, cols);
    const derived: LayoutItem = { ...item, w, x: pos.x, y: pos.y };
    if (item.minW !== undefined) {
      derived.minW = Math.min(item.minW, cols);
    }
    if (item.maxW !== undefined) {
      derived.maxW = Math.min(item.maxW, cols);
    }
    placed.push(derived);
  }
  return placed;
}
```

3b. 给现有 `findFirstFit` 与 `overlapsAny` 增加 `cols` 参数（`findFirstFit` 的内层扫描上限从 `DASHBOARD_GRID_COLS - w` 改为 `cols - w`）：

```ts
function findFirstFit(
  entries: readonly { h: number; w: number; x: number; y: number }[],
  w: number,
  h: number,
  cols: number
): { x: number; y: number } {
  if (entries.length === 0) {
    return { x: 0, y: 0 };
  }

  const maxBottom = entries.reduce((acc, e) => Math.max(acc, e.y + e.h), 0);

  for (let y = 0; y <= maxBottom; y++) {
    for (let x = 0; x <= cols - w; x++) {
      if (!overlapsAny(entries, x, y, w, h)) {
        return { x, y };
      }
    }
  }

  return { x: 0, y: maxBottom };
}
```

（`overlapsAny` 本体不依赖列数，不用改。）

3c. 现有 `appendEntry` 内的调用处补参数：

```ts
  const pos = findFirstFit(entries, size.w, size.h, DASHBOARD_GRID_COLS);
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run tests/unit/renderer/dashboard-grid-geometry.test.ts`
Expected: PASS（新旧用例全绿）

- [ ] **Step 5: Commit（按头部提交规约，先经用户确认）**

```bash
git add src/renderer/panel-kits/dashboard/dashboard-grid-geometry.ts tests/unit/renderer/dashboard-grid-geometry.test.ts
git commit -m "feat(dashboard): 固定格宽常量与 k 列派生排布纯函数"
```

---

### Task 2: 阅读序重排映射（派生模式拖拽 → 基准重装箱）

**Files:**
- Modify: `src/renderer/panel-kits/dashboard/dashboard-grid-geometry.ts`
- Test: `tests/unit/renderer/dashboard-grid-geometry.test.ts`

- [ ] **Step 1: 写失败测试（追加）**

```ts
// 追加 import：readingOrderIds, sameOrder, repackEntries

describe("readingOrderIds / sameOrder", () => {
  it("按 y 优先 x 其次输出 id 序", () => {
    expect(
      readingOrderIds([
        { id: "c", x: 0, y: 2 },
        { id: "b", x: 4, y: 0 },
        { id: "a", x: 0, y: 0 },
      ])
    ).toEqual(["a", "b", "c"]);
  });

  it("sameOrder 比较两个 id 序列", () => {
    expect(sameOrder(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameOrder(["a", "b"], ["b", "a"])).toBe(false);
    expect(sameOrder(["a"], ["a", "b"])).toBe(false);
  });
});

describe("repackEntries", () => {
  it("按新顺序把基准重新 first-fit 装入 12 列", () => {
    const basis = [
      { h: 2, id: "a", w: 6, x: 0, y: 0 },
      { h: 2, id: "b", w: 6, x: 6, y: 0 },
    ];
    const repacked = repackEntries(basis, ["b", "a"]);
    expect(repacked).toEqual([
      { h: 2, id: "b", w: 6, x: 0, y: 0 },
      { h: 2, id: "a", w: 6, x: 6, y: 0 },
    ]);
  });

  it("保留每项的 w/h，只重算 x/y", () => {
    const basis = [
      { h: 3, id: "a", w: 4, x: 0, y: 0 },
      { h: 2, id: "b", w: 8, x: 4, y: 0 },
    ];
    const repacked = repackEntries(basis, ["b", "a"]);
    expect(repacked.find((e) => e.id === "a")).toMatchObject({ h: 3, w: 4 });
    expect(repacked.find((e) => e.id === "b")).toMatchObject({ h: 2, w: 8 });
  });

  it("newOrder 缺失的 id 追加到末尾（防御脏输入）", () => {
    const basis = [
      { h: 2, id: "a", w: 6, x: 0, y: 0 },
      { h: 2, id: "b", w: 6, x: 6, y: 0 },
    ];
    const repacked = repackEntries(basis, ["b"]);
    expect(repacked.map((e) => e.id)).toEqual(["b", "a"]);
  });

  it("newOrder 中不存在于基准的 id 被忽略", () => {
    const basis = [{ h: 2, id: "a", w: 6, x: 0, y: 0 }];
    const repacked = repackEntries(basis, ["ghost", "a"]);
    expect(repacked.map((e) => e.id)).toEqual(["a"]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/unit/renderer/dashboard-grid-geometry.test.ts`
Expected: FAIL（`readingOrderIds` 等未导出）

- [ ] **Step 3: 实现（追加到 dashboard-grid-geometry.ts）**

```ts
/** 阅读序 id 列表（y 优先、x 其次、id 兜底）。 */
export function readingOrderIds(
  items: readonly { id: string; x: number; y: number }[]
): string[] {
  return [...items].sort(readingOrderCompare).map((e) => e.id);
}

export function sameOrder(
  a: readonly string[],
  b: readonly string[]
): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/**
 * 派生模式拖拽的持久化语义：按新阅读序把基准条目重新 first-fit 装回 12 列。
 * 保留每项 w/h，只重算 x/y。已知代价：基准里刻意的留白会被压实（见设计文档 §5）。
 */
export function repackEntries(
  entries: readonly { h: number; id: string; w: number; x: number; y: number }[],
  orderIds: readonly string[]
): { h: number; id: string; w: number; x: number; y: number }[] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const orderedIds = [
    ...orderIds.filter((id) => byId.has(id)),
    ...entries.map((e) => e.id).filter((id) => !orderIds.includes(id)),
  ];
  const placed: { h: number; id: string; w: number; x: number; y: number }[] =
    [];
  for (const id of orderedIds) {
    const e = byId.get(id);
    if (!e) {
      continue;
    }
    const pos = findFirstFit(placed, e.w, e.h, DASHBOARD_GRID_COLS);
    placed.push({ h: e.h, id: e.id, w: e.w, x: pos.x, y: pos.y });
  }
  return placed;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run tests/unit/renderer/dashboard-grid-geometry.test.ts`
Expected: PASS

- [ ] **Step 5: Commit（按头部提交规约，先经用户确认）**

```bash
git add src/renderer/panel-kits/dashboard/dashboard-grid-geometry.ts tests/unit/renderer/dashboard-grid-geometry.test.ts
git commit -m "feat(dashboard): 阅读序重排映射——派生模式拖拽写回基准的装箱函数"
```

---

### Task 3: params 逐条抢救解析

**Files:**
- Modify: `src/shared/contracts/dashboard.ts`
- Test: `tests/unit/renderer/dashboard-merge.test.ts`（追加一个 describe；该文件已 import 本契约模块的邻近符号）

- [ ] **Step 1: 写失败测试（追加到 dashboard-merge.test.ts 末尾）**

```ts
import { salvageDashboardPanelParams } from "@shared/contracts/dashboard.ts";

describe("salvageDashboardPanelParams", () => {
  it("整体合法时原样返回", () => {
    const raw = { widgets: [{ h: 3, id: "a", w: 4, x: 0, y: 0 }] };
    expect(salvageDashboardPanelParams(raw)).toEqual(raw);
  });

  it("混合合法/非法条目时只丢非法项", () => {
    const raw = {
      widgets: [
        { h: 3, id: "good", w: 4, x: 0, y: 0 },
        { h: 3, id: "bad-x", w: 4, x: 12, y: 0 }, // x 越界
        { h: 2.5, id: "bad-h", w: 4, x: 0, y: 3 }, // h 非整数
      ],
    };
    expect(salvageDashboardPanelParams(raw)).toEqual({
      widgets: [{ h: 3, id: "good", w: 4, x: 0, y: 0 }],
    });
  });

  it("widgets 不是数组 / raw 为 null 时回退空", () => {
    expect(salvageDashboardPanelParams({ widgets: "junk" })).toEqual({
      widgets: [],
    });
    expect(salvageDashboardPanelParams(null)).toEqual({ widgets: [] });
    expect(salvageDashboardPanelParams(undefined)).toEqual({ widgets: [] });
  });

  it("抢救出的条目不含多余字段", () => {
    const raw = {
      widgets: [{ extra: true, h: 3, id: "a", w: 4, x: 0, y: 0 }],
    };
    expect(salvageDashboardPanelParams(raw)).toEqual({
      widgets: [{ h: 3, id: "a", w: 4, x: 0, y: 0 }],
    });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/unit/renderer/dashboard-merge.test.ts`
Expected: FAIL（`salvageDashboardPanelParams` 未导出）

- [ ] **Step 3: 实现（追加到 src/shared/contracts/dashboard.ts，`dashboardPanelParamsSchema` 之后）**

```ts
/**
 * params 逐条抢救：整体合法直接返回；否则逐条校验，丢非法项、留合法项。
 * 替代"整体 safeParse 失败 → 空数组"——那条路径会让一条脏数据毁掉整个
 * 大盘组装，且用户下一次编辑就把空布局永久写回。
 * 抢救结果只用于渲染，调用方不得主动回写（避免打开面板即触发写盘）。
 */
export function salvageDashboardPanelParams(
  raw: unknown
): DashboardPanelParams {
  const full = dashboardPanelParamsSchema.safeParse(raw);
  if (full.success) {
    return full.data;
  }
  const widgetsRaw =
    raw !== null && typeof raw === "object" && "widgets" in raw
      ? (raw as { widgets: unknown }).widgets
      : undefined;
  if (!Array.isArray(widgetsRaw)) {
    return { widgets: [] };
  }
  const widgets = widgetsRaw.flatMap((entry) => {
    const parsed = dashboardPanelWidgetEntrySchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
  return { widgets };
}
```

注意：zod object 默认 strip 未知字段，"不含多余字段"用例天然满足。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run tests/unit/renderer/dashboard-merge.test.ts`
Expected: PASS

- [ ] **Step 5: Commit（按头部提交规约，先经用户确认）**

```bash
git add src/shared/contracts/dashboard.ts tests/unit/renderer/dashboard-merge.test.ts
git commit -m "fix(dashboard): params 逐条抢救——一条脏数据不再毁掉整个大盘组装"
```

---

### Task 4: DashboardPanel 接入（k 列渲染 + 写回守卫 + 量宽修正）

**Files:**
- Modify: `src/renderer/panel-kits/dashboard/dashboard-panel.tsx`
- Test: `tests/component/dashboard-panel.test.tsx`

- [ ] **Step 1: 写失败测试（追加到 dashboard-panel.test.tsx）**

jsdom 无 ResizeObserver → `useContainerWidth` 回退 800px → `computeAvailableCols(800) = 8` → 组件测试确定性进入派生模式（k=8）。

```ts
describe("固定格宽与派生模式", () => {
  it("窄容器（jsdom 回退 800px → k=8）：网格容器宽 788px 且水平居中", () => {
    const props = makeProps({
      widgets: [{ h: 3, id: "core.activity-overview", w: 4, x: 0, y: 0 }],
    });
    const { container } = render(<DashboardPanel {...props} />);
    const wrapper = container.querySelector("[data-testid='dashboard-grid-wrapper']");
    expect(wrapper).toBeInTheDocument();
    expect(wrapper).toHaveStyle({ width: "788px" });
    expect((wrapper as HTMLElement).className).toContain("mx-auto");
  });

  it("派生模式守卫：挂载与渲染不把派生坐标写回 params", () => {
    const updateParameters = vi.fn();
    // w=12 的卡片在 k=8 下会被派生 clamp 到 8——若守卫失效，
    // RGL 挂载触发的 onLayoutChange 会把 w=8 写回 params
    const props = makeProps(
      { widgets: [{ h: 3, id: "core.activity-overview", w: 12, x: 0, y: 0 }] },
      updateParameters
    );
    render(<DashboardPanel {...props} />);
    expect(updateParameters).not.toHaveBeenCalled();
  });

  it("params 含非法条目时抢救渲染合法条目，且不主动回写", () => {
    const updateParameters = vi.fn();
    const props = makeProps(
      {
        widgets: [
          { h: 3, id: "core.activity-overview", w: 4, x: 0, y: 0 },
          { h: 3, id: "broken", w: 4, x: 99, y: 0 },
        ],
      },
      updateParameters
    );
    render(<DashboardPanel {...props} />);
    expect(
      screen.getByTestId("dashboard-widget-core.activity-overview")
    ).toBeInTheDocument();
    expect(updateParameters).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/component/dashboard-panel.test.tsx`
Expected: FAIL（`dashboard-grid-wrapper` 不存在；非法条目用例整盘渲染为空）

- [ ] **Step 3: 实现**

修改 `src/renderer/panel-kits/dashboard/dashboard-panel.tsx`。`renderResizeHandle` 与 `findSizeDeclaration` 保持不变；变更点如下。

3a. import 调整：

```ts
import {
  DASHBOARD_GRID_COLS,
  type DashboardGridSize,
  salvageDashboardPanelParams,
} from "@shared/contracts/dashboard.ts";
// dashboardPanelParamsSchema 不再直接使用，从 import 中移除
```

```ts
import {
  appendEntry,
  computeAvailableCols,
  deriveLayout,
  entryToLayoutItem,
  gridPixelWidth,
  layoutToEntries,
  MARGIN,
  readingOrderIds,
  repackEntries,
  ROW_HEIGHT,
  sameOrder,
} from "./dashboard-grid-geometry.ts";
```

3b. `DashboardPanel` 函数体内，params 解析与布局派生：

```ts
  const [containerRef, containerWidth] = useContainerWidth();
  const cols = computeAvailableCols(containerWidth);
  const isDerived = cols < DASHBOARD_GRID_COLS;
```

```ts
  const params = useMemo(
    () => salvageDashboardPanelParams(props.params),
    [props.params]
  );
```

（删除原 `parseResult` useMemo 与 `const params = parseResult.success ? … : { widgets: [] }` 两段。）

原 `layout` useMemo 更名为 `basisLayout`，并新增派生：

```ts
  const basisLayout = useMemo(
    () =>
      params.widgets.map((entry) => {
        const decl = findSizeDeclaration(entry.id, plugins);
        return entryToLayoutItem(entry, decl);
      }),
    [params.widgets, plugins]
  );

  // k<12 进入派生模式：纯函数换行重排，结果只渲染不持久化
  const layout = useMemo(
    () => (isDerived ? deriveLayout(basisLayout, cols) : basisLayout),
    [basisLayout, cols, isDerived]
  );
```

3c. `handleLayoutChange` 全量替换：

```ts
  const handleLayoutChange = useCallback(
    (newLayout: Layout) => {
      // 全宽模式：直存基准（原有路径）
      if (!isDerived) {
        const newEntries = layoutToEntries(newLayout);
        const newJson = JSON.stringify(newEntries);
        if (newJson !== prevEntriesRef.current) {
          prevEntriesRef.current = newJson;
          props.api.updateParameters({ widgets: newEntries });
        }
        return;
      }

      // 派生模式：绝不把 k 列坐标写回。只识别两类真实编辑——
      // (a) resize：与当前派生布局比对 w/h 差分，直存基准条目
      // (b) 拖拽：阅读序变化 → 基准按新序重新装箱
      const prevById = new Map(layout.map((l) => [l.i, l]));
      let entries = params.widgets;
      let dirty = false;

      for (const item of newLayout) {
        const prev = prevById.get(item.i);
        if (prev && (item.w !== prev.w || item.h !== prev.h)) {
          entries = entries.map((e) =>
            e.id === item.i ? { ...e, h: item.h, w: item.w } : e
          );
          dirty = true;
        }
      }

      const prevOrder = readingOrderIds(
        layout.map((l) => ({ id: l.i, x: l.x, y: l.y }))
      );
      const newOrder = readingOrderIds(
        newLayout.map((l) => ({ id: l.i, x: l.x, y: l.y }))
      );
      if (!sameOrder(prevOrder, newOrder)) {
        entries = repackEntries(entries, newOrder);
        dirty = true;
      }

      if (dirty) {
        prevEntriesRef.current = JSON.stringify(entries);
        props.api.updateParameters({ widgets: entries });
      }
    },
    [isDerived, layout, params.widgets, props.api]
  );
```

3d. JSX：量宽 ref 移到 `p-6` 内容 div（修 48px 溢出 bug），网格套定宽居中容器，`gridConfig` 显式 `containerPadding: [0, 0]` 并传动态 `cols`：

```tsx
  return (
    <div
      className={[
        "flex h-full flex-col bg-surface-canvas",
        "[&_.react-grid-placeholder]:rounded-xl [&_.react-grid-placeholder]:bg-accent/30",
        "[&_.react-grid-item:hover_.react-resizable-handle]:opacity-100 [&_.react-resizable-handle]:opacity-0",
      ].join(" ")}
    >
      <div className="flex-1 overflow-auto p-6" ref={containerRef}>
        <div
          className="mx-auto"
          data-testid="dashboard-grid-wrapper"
          style={{ width: gridPixelWidth(cols) }}
        >
          {resolved.length > 0 ? (
            <GridLayout
              compactor={verticalCompactor}
              dragConfig={{
                cancel:
                  "button, a, input, textarea, select, [role='menuitem'], [data-no-drag]",
              }}
              gridConfig={{
                cols,
                containerPadding: [0, 0],
                margin: MARGIN,
                rowHeight: ROW_HEIGHT,
              }}
              layout={layout}
              onLayoutChange={handleLayoutChange}
              resizeConfig={{
                handleComponent: renderResizeHandle,
                handles: ["se", "s", "e"],
              }}
              width={gridPixelWidth(cols)}
            >
              {resolved.map((widget) => {
                const item = layout.find((l) => l.i === widget.id);
                const size: DashboardGridSize = item
                  ? { h: item.h, w: item.w }
                  : { h: 3, w: 4 };
                return (
                  <div key={widget.id}>
                    <DashboardWidgetCard
                      onRemove={() => handleRemove(widget.id)}
                      size={size}
                      widget={widget}
                    />
                  </div>
                );
              })}
            </GridLayout>
          ) : null}
          <DashboardAddCard
            addedIds={addedIds}
            coreWidgetRegistrations={CORE_DASHBOARD_WIDGET_COMPONENTS}
            coreWidgets={CORE_DASHBOARD_WIDGETS}
            isEmpty={resolved.length === 0}
            onAdd={handleAdd}
            plugins={plugins}
            widgetRegistrations={widgetRegistrations}
          />
        </div>
      </div>
    </div>
  );
```

已知取舍：`useContainerWidth` 首帧 `getBoundingClientRect` 量到的是含 padding 的 border-box 宽，ResizeObserver 首次回调（observe 后立即触发）会以 content-box 宽度纠正——首帧偏差一帧内消失，不做额外处理。

- [ ] **Step 4: 跑组件测试确认通过（含旧用例回归）**

Run: `pnpm vitest run tests/component/dashboard-panel.test.tsx`
Expected: PASS（新增 3 例 + 原有 8 例全绿；原有用例在 k=8 派生模式下运行，渲染断言不受影响）

- [ ] **Step 5: 类型检查**

Run: `pnpm typecheck`
Expected: 无错误

- [ ] **Step 6: Commit（按头部提交规约，先经用户确认）**

```bash
git add src/renderer/panel-kits/dashboard/dashboard-panel.tsx tests/component/dashboard-panel.test.tsx
git commit -m "feat(dashboard): 面板接入固定格宽派生渲染——写回守卫、量宽修正、逐条抢救"
```

---

### Task 5: 卡片开启容器查询上下文

**Files:**
- Modify: `src/renderer/panel-kits/dashboard/dashboard-widget-card.tsx:158`
- Test: `tests/component/dashboard-panel.test.tsx`

- [ ] **Step 1: 写失败测试（追加）**

```ts
  it("CardContent 声明 @container，为 widget 内容提供容器查询上下文", () => {
    const props = makeProps({
      widgets: [{ h: 3, id: "core.activity-overview", w: 4, x: 0, y: 0 }],
    });
    const { container } = render(<DashboardPanel {...props} />);
    const content = container.querySelector("[data-slot='card-content']");
    expect(content?.className).toContain("@container");
  });
```

（若 `card-content` 无 `data-slot` 属性，先看 `packages/ui/card.tsx` 里 `CardContent` 的实际锚点，改用其类名或结构选择器；shadcn 新版模板默认带 `data-slot`。）

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/component/dashboard-panel.test.tsx`
Expected: FAIL（className 不含 `@container`）

- [ ] **Step 3: 实现**

`dashboard-widget-card.tsx` 中：

```tsx
      <CardContent className="@container min-h-0 flex-1 p-0">
        {renderBody()}
      </CardContent>
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run tests/component/dashboard-panel.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit（按头部提交规约，先经用户确认）**

```bash
git add src/renderer/panel-kits/dashboard/dashboard-widget-card.tsx tests/component/dashboard-panel.test.tsx
git commit -m "feat(dashboard): 卡片内容区开启 @container 容器查询上下文"
```

---

### Task 6: ActivityWidget 内容响应

**Files:**
- Modify: `src/renderer/panel-kits/dashboard/core-widgets/activity-widget.tsx:31`
- Test: `tests/unit/renderer/host-context-panels.test.tsx` 不涉及；用现有 widget 渲染路径的组件测试文件 `tests/component/dashboard-panel.test.tsx`

- [ ] **Step 1: 写失败测试（追加）**

jsdom 不执行 container query，只能断言类名存在（设计文档 §7 明确此边界）。

```ts
  it("ActivityWidget 统计块带容器查询变体（窄卡纵排、宽卡三列）", () => {
    const props = makeProps({
      widgets: [{ h: 3, id: "core.activity-overview", w: 4, x: 0, y: 0 }],
    });
    const { container } = render(<DashboardPanel {...props} />);
    const statGrid = container.querySelector(
      "[data-testid='activity-stat-grid']"
    );
    expect(statGrid?.className).toContain("grid-cols-1");
    expect(statGrid?.className).toContain("@[14rem]:grid-cols-3");
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/component/dashboard-panel.test.tsx`
Expected: FAIL（testid 不存在）

- [ ] **Step 3: 实现**

`activity-widget.tsx` 统计块容器（原 `grid grid-cols-3 gap-2 px-3 pt-3`）改为：

```tsx
      <div
        className="grid grid-cols-1 gap-2 px-3 pt-3 @[14rem]:grid-cols-3"
        data-testid="activity-stat-grid"
      >
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run tests/component/dashboard-panel.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit（按头部提交规约，先经用户确认）**

```bash
git add src/renderer/panel-kits/dashboard/core-widgets/activity-widget.tsx tests/component/dashboard-panel.test.tsx
git commit -m "feat(dashboard): ActivityWidget 统计块按卡片宽度容器查询重排"
```

---

### Task 7: AccountsWidget 内容响应

**Files:**
- Modify: `src/plugins/builtin/codex/renderer/accounts-widget.tsx:120-180`（`AccountRow`）
- Test: `tests/unit/renderer/git-plugin.test.tsx` 不涉及；用 codex widget 现有测试文件（`grep -rl "accounts-widget" tests/` 定位；若无独立文件则新建 `tests/unit/renderer/codex-accounts-widget.test.tsx`，用与该 widget 现有测试相同的 context stub 方式——先看 `tests/unit/main/plugin-runtime.test.ts` 旁是否已有 renderer 侧 codex 测试再决定）

- [ ] **Step 1: 定位现有测试**

Run: `grep -rl "accounts-widget\|AccountsWidget\|account-row" tests/`
Expected: 找到既有测试文件（Phase 3 交付含 widget 测试）。以下步骤的断言追加到该文件；若确实没有，跳过测试步骤直接实现并在 Task 8 全量测试兜底（记录到计划执行笔记）。

- [ ] **Step 2: 写失败测试（追加到定位到的文件）**

```ts
  it("账号行为窄卡片准备了折行收纳（flex-wrap + email truncate）", () => {
    // 渲染任一含账号的正常态（复用该文件既有的 snapshot/context stub），然后：
    const row = screen.getByTestId("account-row-acc-1");
    const headerRow = row.firstElementChild as HTMLElement;
    expect(headerRow.className).toContain("flex-wrap");
    const email = screen.getByText("user@example.com");
    expect(email.className).toContain("truncate");
  });
```

（`acc-1` 与 `user@example.com` 按该测试文件既有 fixture 的实际值替换。）

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm vitest run <定位到的测试文件>`
Expected: FAIL

- [ ] **Step 4: 实现**

`accounts-widget.tsx` 的 `AccountRow` 中两处：

```tsx
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <div className="flex min-w-0 items-center gap-2">
          {isActive ? (
            <Check
              className="size-3.5 shrink-0 text-primary"
              data-testid="active-indicator"
            />
          ) : (
            <span className="size-3.5 shrink-0" />
          )}
          <span className="min-w-0 truncate font-medium text-sm">
            {account.email}
          </span>
          {account.planType && (
            <Badge variant="secondary">{account.planType}</Badge>
          )}
        </div>
```

（外层行 `flex items-center justify-between` → `flex flex-wrap items-center justify-between gap-x-2 gap-y-1`；左侧组加 `min-w-0`；email span 加 `min-w-0 truncate`。其余不动。）

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm vitest run <定位到的测试文件>`
Expected: PASS

- [ ] **Step 6: Commit（按头部提交规约，先经用户确认）**

```bash
git add src/plugins/builtin/codex/renderer/accounts-widget.tsx <定位到的测试文件>
git commit -m "feat(codex): 账号行窄卡片折行收纳与邮箱截断"
```

---

### Task 8: 接入文档 + 全量验证

**Files:**
- Modify: `AGENTS.md`（`### 大盘组件贡献点 dashboardWidgets` 小节）
- Modify: `src/plugins/api/renderer.ts:155-157`（`DashboardWidgetComponentProps` 注释）

- [ ] **Step 1: AGENTS.md 追加一条纪律**

在 `### 大盘组件贡献点 dashboardWidgets` 小节末尾追加：

```markdown
- 网格几何：格子像素恒定（`CELL_WIDTH = 88`），面板宽度只决定可用列数 k；k<12 时按阅读序
  first-fit 派生排布（`deriveLayout`），派生结果不持久化——持久化的 `widgets` 数组始终是
  12 列基准布局。widget 内容响应一律用 container query（卡片 `CardContent` 已开
  `@container`），不要依赖 `size` prop 换算像素。
```

- [ ] **Step 2: 插件 API 注释**

`src/plugins/api/renderer.ts` 中：

```ts
export interface DashboardWidgetComponentProps {
  /**
   * 卡片占位（格子数，非像素）。用于逻辑分支（如"h ≥ 4 才显示列表"）。
   * 内容级响应式布局请用 container query（CardContent 已开 @container），
   * 勿依赖本值换算像素——格宽固定但列数随面板宽度变化。
   */
  size: DashboardGridSize;
}
```

- [ ] **Step 3: 全量门禁**

Run: `pnpm check`
Expected: typecheck + lint + depcruise + file-size + unit + component 全绿

- [ ] **Step 4: 全量 vitest 兜底（项目记忆：改共享数据后 check 不够）**

Run: `pnpm test`
Expected: 全绿

- [ ] **Step 5: 真机验证（/verify 语义）**

Run: `pnpm dev`
手工核对清单：
1. 打开大盘 panel，拖拽 dockview 分栏由宽变窄：卡片宽度不变、逐个换行下移；由窄变宽：布局逐级恢复，回到全宽后与改动前基准布局完全一致。
2. 全宽下拖拽/resize 卡片 → 重启 app（或关开 panel）布局保留。
3. 窄态下 resize 卡片 → 拉回全宽，新尺寸保留。
4. 窄态下把卡片 A 拖到卡片 B 后面 → 拉回全宽，A/B 顺序已交换（重新装箱）。
5. 满 12 列布局右缘不再裁切、无横向滚动条（48px bug 修复验证）。
6. 把 activity 卡 resize 到 2 格宽：统计块纵排；4 格宽以上：三列。

- [ ] **Step 6: Commit（按头部提交规约，先经用户确认）**

```bash
git add AGENTS.md src/plugins/api/renderer.ts
git commit -m "docs(dashboard): 固定格宽几何纪律与 widget 内容响应指引"
```

---

## 计划自审记录

- 规格覆盖：设计文档 §4.1→Task 3/4、§4.2→Task 1/4、§4.3→Task 1、§4.4→Task 2/4、§4.5→Task 5/6/7、§6 文档行→Task 8、§7 测试全部映射到各 Task 的测试步骤。无缺口。
- 类型一致性：`deriveLayout(items: readonly LayoutItem[], cols)`（Task 1）与 Task 4 调用一致；`repackEntries/readingOrderIds/sameOrder`（Task 2）与 Task 4 的 `handleLayoutChange` 一致；`salvageDashboardPanelParams`（Task 3）与 Task 4 import 一致；`findFirstFit` 加 `cols` 参数后 Task 1 的 `appendEntry` 调用处已同步。
- 占位符检查：Task 7 的测试文件定位步骤是有意的运行时探查（fixture 值依既有文件而定），已给出探查命令与两种分支的处理方式；其余步骤均为完整代码。

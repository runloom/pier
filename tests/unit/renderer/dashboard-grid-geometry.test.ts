import {
  DASHBOARD_GRID_COLS,
  HOST_DEFAULT_WIDGET_SIZE,
} from "@shared/contracts/dashboard.ts";
import { describe, expect, it } from "vitest";
import {
  appendEntry,
  applyDerivedLayoutChange,
  CELL_WIDTH,
  computeAvailableCols,
  deriveLayout,
  entryToLayoutItem,
  gridPixelWidth,
  layoutToEntries,
  MARGIN,
  ROW_HEIGHT,
  readingOrderIds,
  repackEntries,
  sameOrder,
} from "@/panel-kits/dashboard/dashboard-grid-geometry.ts";

describe("entryToLayoutItem", () => {
  it("maps entry fields to RGL layout item with min/max", () => {
    const item = entryToLayoutItem(
      { h: 3, id: "w1", w: 4, x: 0, y: 0 },
      { minSize: { h: 2, w: 2 }, maxSize: { h: 8, w: 8 } }
    );
    expect(item).toEqual({
      h: 3,
      i: "w1",
      maxH: 8,
      maxW: 8,
      minH: 2,
      minW: 2,
      w: 4,
      x: 0,
      y: 0,
    });
  });

  it("clamps w to [min, max]", () => {
    const item = entryToLayoutItem(
      { h: 3, id: "w1", w: 1, x: 0, y: 0 },
      { minSize: { h: 2, w: 3 } }
    );
    expect(item.w).toBe(3);
  });

  it("clamps h to max", () => {
    const item = entryToLayoutItem(
      { h: 20, id: "w1", w: 4, x: 0, y: 0 },
      { maxSize: { h: 10, w: 12 } }
    );
    expect(item.h).toBe(10);
  });

  it("clamps x to [0, 12 - w]", () => {
    const item = entryToLayoutItem(
      { h: 3, id: "w1", w: 4, x: 11, y: 0 },
      undefined
    );
    expect(item.x).toBe(DASHBOARD_GRID_COLS - 4);
  });

  it("uses HOST defaults when decl is undefined", () => {
    const item = entryToLayoutItem(
      { h: 3, id: "w1", w: 4, x: 0, y: 0 },
      undefined
    );
    expect(item.minH).toBe(2);
    expect(item.minW).toBe(2);
    expect(item.maxH).toBe(12);
    expect(item.maxW).toBe(12);
  });
});

describe("layoutToEntries", () => {
  it("strips transient RGL fields, keeps id/x/y/w/h", () => {
    const entries = layoutToEntries([
      {
        h: 3,
        i: "w1",
        w: 4,
        x: 0,
        y: 0,
        moved: false,
        static: false,
      },
    ]);
    expect(entries).toEqual([{ h: 3, id: "w1", w: 4, x: 0, y: 0 }]);
  });

  it("handles empty layout", () => {
    expect(layoutToEntries([])).toEqual([]);
  });

  it("preserves order", () => {
    const entries = layoutToEntries([
      { h: 2, i: "b", w: 3, x: 4, y: 2 },
      { h: 3, i: "a", w: 4, x: 0, y: 0 },
    ]);
    expect(entries[0]?.id).toBe("b");
    expect(entries[1]?.id).toBe("a");
  });
});

describe("appendEntry", () => {
  // (a) 网格有一个 4×3 在 (0,0)，新增 4×4 应落 (4,0) 而非下一行
  it("places entry to the right when row has space (first-fit)", () => {
    const existing = [{ id: "a", x: 0, y: 0, w: 4, h: 3 }];
    const entry = appendEntry(existing, "b", {
      defaultSize: { w: 4, h: 4 },
    });
    expect(entry.x).toBe(4);
    expect(entry.y).toBe(0);
    expect(entry.w).toBe(4);
    expect(entry.h).toBe(4);
  });

  // (b) 行内剩余宽度不够时顶到下一可容纳位
  it("wraps to next viable row when remaining width is insufficient", () => {
    // 两个 5-宽 widget 占满 0-4 和 5-9 => 列 10-11 剩 2 格
    const existing = [
      { id: "a", x: 0, y: 0, w: 5, h: 2 },
      { id: "b", x: 5, y: 0, w: 5, h: 2 },
    ];
    // 新增 w=4, 不够塞同行 => 应落到 y=2 (两个 widget 底部)
    const entry = appendEntry(existing, "c", {
      defaultSize: { w: 4, h: 3 },
    });
    expect(entry.x).toBe(0);
    expect(entry.y).toBe(2);
  });

  // (c) 空网格落 (0,0)
  it("starts at (0,0) for empty grid", () => {
    const entry = appendEntry([], "w1", undefined);
    expect(entry.x).toBe(0);
    expect(entry.y).toBe(0);
  });

  // (d) 完全填满时落底部新行
  it("places at bottom new row when grid is fully packed", () => {
    // 12 列 × 2 行完全填满
    const existing = [
      { id: "a", x: 0, y: 0, w: 12, h: 2 },
      { id: "b", x: 0, y: 2, w: 12, h: 2 },
    ];
    const entry = appendEntry(existing, "c", {
      defaultSize: { w: 4, h: 3 },
    });
    expect(entry.x).toBe(0);
    expect(entry.y).toBe(4);
  });

  // (e) 尺寸仍经 clamp(defaultSize)
  it("uses clamp(defaultSize) for w/h", () => {
    const entry = appendEntry([], "w1", {
      defaultSize: { h: 5, w: 6 },
      minSize: { h: 3, w: 3 },
      maxSize: { h: 8, w: 8 },
    });
    expect(entry.w).toBe(6);
    expect(entry.h).toBe(5);
  });

  it("clamps defaultSize to min when default < min", () => {
    const entry = appendEntry([], "w1", {
      defaultSize: { h: 1, w: 1 },
      minSize: { h: 3, w: 3 },
    });
    expect(entry.w).toBe(3);
    expect(entry.h).toBe(3);
  });

  it("uses HOST_DEFAULT_WIDGET_SIZE when decl omits defaultSize", () => {
    const entry = appendEntry([], "w1", undefined);
    expect(entry.w).toBe(HOST_DEFAULT_WIDGET_SIZE.w);
    expect(entry.h).toBe(HOST_DEFAULT_WIDGET_SIZE.h);
  });

  // 补充：first-fit 找到行中间的缝隙
  it("fills gap between two existing widgets", () => {
    // widget A 在 (0,0) 宽 3，widget B 在 (7,0) 宽 5
    // 中间空隙 x=[3..6] 宽 4，刚好能放 w=4
    const existing = [
      { id: "a", x: 0, y: 0, w: 3, h: 2 },
      { id: "b", x: 7, y: 0, w: 5, h: 2 },
    ];
    const entry = appendEntry(existing, "c", {
      defaultSize: { w: 4, h: 2 },
    });
    expect(entry.x).toBe(3);
    expect(entry.y).toBe(0);
  });
});

describe("constants", () => {
  it("ROW_HEIGHT = 88", () => {
    expect(ROW_HEIGHT).toBe(88);
  });

  it("MARGIN = [12, 12]", () => {
    expect(MARGIN).toEqual([12, 12]);
  });
});

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

describe("deriveLayout 保序（禁回填）", () => {
  it("小卡不回填到前面空隙：显示阅读序 == 基准阅读序", () => {
    // k=8：a w6 → (0,0)；b w6 放不进剩余 2 列 → (0,1)；
    // c w2 若回填会落 (6,0)（顺序变 a,c,b），保序必须落 (6,1) 或更晚
    const derived = deriveLayout(
      [
        { h: 1, i: "a", w: 6, x: 0, y: 0 },
        { h: 1, i: "b", w: 6, x: 0, y: 1 },
        { h: 1, i: "c", w: 2, x: 6, y: 1 },
      ],
      8
    );
    expect(
      readingOrderIds(derived.map((l) => ({ id: l.i, x: l.x, y: l.y })))
    ).toEqual(["a", "b", "c"]);
    // 保序实现下 c 恰好可与 b 同行并排
    expect(derived.find((l) => l.i === "c")).toMatchObject({ x: 6, y: 1 });
  });

  it("同行仍可并排（保序不等于强制换行）", () => {
    const derived = deriveLayout(
      [
        { h: 2, i: "a", w: 4, x: 0, y: 0 },
        { h: 2, i: "b", w: 4, x: 4, y: 0 },
      ],
      8
    );
    expect(derived).toEqual([
      { h: 2, i: "a", w: 4, x: 0, y: 0 },
      { h: 2, i: "b", w: 4, x: 4, y: 0 },
    ]);
  });
});

describe("repackEntries 保序（禁回填）", () => {
  it("重排后基准阅读序精确等于新顺序（混合宽度不回填）", () => {
    // 12 列：a w6@(0,0)，b w8 放不下同行 → (0,2)，c w4 保序 → (8,2)（b 右侧同行）
    // 而非回填到 (6,0)
    const basis = [
      { h: 2, id: "a", w: 6, x: 0, y: 0 },
      { h: 2, id: "b", w: 8, x: 0, y: 2 },
      { h: 2, id: "c", w: 4, x: 8, y: 2 },
    ];
    const repacked = repackEntries(basis, ["a", "b", "c"]);
    expect(readingOrderIds(repacked)).toEqual(["a", "b", "c"]);
    expect(repacked.find((e) => e.id === "c")).toMatchObject({ x: 8, y: 2 });
  });
});

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

describe("applyDerivedLayoutChange", () => {
  it("纯回声（RGL 回报与派生布局一致）返回 null", () => {
    const basis = [
      { h: 2, id: "a", w: 6, x: 0, y: 0 },
      { h: 2, id: "b", w: 6, x: 6, y: 0 },
    ];
    // k=8 派生：a 同行放不下 b → b 换行
    const derived = [
      { h: 2, i: "a", w: 6, x: 0, y: 0 },
      { h: 2, i: "b", w: 6, x: 0, y: 2 },
    ];
    const echo = derived.map((l) => ({ ...l }));
    expect(applyDerivedLayoutChange(basis, derived, echo)).toBeNull();
  });

  it("仅 resize：基准对应条目更新 w/h，x/y 不动，返回新数组", () => {
    const basis = [
      { h: 2, id: "a", w: 4, x: 0, y: 0 },
      { h: 2, id: "b", w: 4, x: 4, y: 0 },
    ];
    const derived = [
      { h: 2, i: "a", w: 4, x: 0, y: 0 },
      { h: 2, i: "b", w: 4, x: 4, y: 0 },
    ];
    // a 拉宽到 5，b 被 RGL 顺推到 x=5——阅读序不变，只算 resize
    const next = [
      { h: 2, i: "a", w: 5, x: 0, y: 0 },
      { h: 2, i: "b", w: 4, x: 5, y: 0 },
    ];
    const result = applyDerivedLayoutChange(basis, derived, next);
    expect(result).toEqual([
      { h: 2, id: "a", w: 5, x: 0, y: 0 },
      { h: 2, id: "b", w: 4, x: 4, y: 0 },
    ]);
    expect(result).not.toBe(basis);
  });

  it("仅改高度不污染被派生 clamp 的宽：基准 w=12 保持不变", () => {
    // 基准 w=12 在 k=8 派生下 clamp 到 8；用户拖 s 手柄只改高度，
    // 若整组写回会把派生宽 8 静默写进基准，回全宽后永久变窄
    const basis = [{ h: 3, id: "a", w: 12, x: 0, y: 0 }];
    const derived = [{ h: 3, i: "a", w: 8, x: 0, y: 0 }];
    const next = [{ h: 5, i: "a", w: 8, x: 0, y: 0 }];
    expect(applyDerivedLayoutChange(basis, derived, next)).toEqual([
      { h: 5, id: "a", w: 12, x: 0, y: 0 },
    ]);
  });

  it("仅拖拽：阅读序变化，返回按新序 repack 的基准", () => {
    const basis = [
      { h: 2, id: "a", w: 6, x: 0, y: 0 },
      { h: 2, id: "b", w: 6, x: 6, y: 0 },
    ];
    // k=8 派生：单列上下堆叠
    const derived = [
      { h: 2, i: "a", w: 6, x: 0, y: 0 },
      { h: 2, i: "b", w: 6, x: 0, y: 2 },
    ];
    // 用户把 b 拖到 a 上方 → 新阅读序 [b, a]
    const next = [
      { h: 2, i: "b", w: 6, x: 0, y: 0 },
      { h: 2, i: "a", w: 6, x: 0, y: 2 },
    ];
    // 12 列 repack：b、a 各宽 6，同行并排
    expect(applyDerivedLayoutChange(basis, derived, next)).toEqual([
      { h: 2, id: "b", w: 6, x: 0, y: 0 },
      { h: 2, id: "a", w: 6, x: 6, y: 0 },
    ]);
  });

  it("resize+拖拽复合：先差分尺寸再 repack，repack 输入含新尺寸", () => {
    const basis = [
      { h: 2, id: "a", w: 6, x: 0, y: 0 },
      { h: 2, id: "b", w: 6, x: 6, y: 0 },
    ];
    const derived = [
      { h: 2, i: "a", w: 6, x: 0, y: 0 },
      { h: 2, i: "b", w: 6, x: 0, y: 2 },
    ];
    // b 拉宽到 7 并拖到 a 上方
    const next = [
      { h: 2, i: "b", w: 7, x: 0, y: 0 },
      { h: 2, i: "a", w: 6, x: 0, y: 2 },
    ];
    // 12 列 repack 吃到 b 的新宽 7：7+6>12 → a 换行。
    // 若 repack 输入还是旧宽 6，a 会错误地并排在 (6,0)。
    expect(applyDerivedLayoutChange(basis, derived, next)).toEqual([
      { h: 2, id: "b", w: 7, x: 0, y: 0 },
      { h: 2, id: "a", w: 6, x: 0, y: 2 },
    ]);
  });

  it("nextLayout 含未知 id 时不崩且忽略该项", () => {
    const basis = [{ h: 2, id: "a", w: 4, x: 0, y: 0 }];
    const derived = [{ h: 2, i: "a", w: 4, x: 0, y: 0 }];
    const next = [
      { h: 2, i: "a", w: 4, x: 0, y: 0 },
      { h: 2, i: "ghost", w: 4, x: 4, y: 0 },
    ];
    // ghost 让阅读序比较判为变化 → 走 repack，但 repack 丢弃未知 id，
    // 基准条目几何不变
    expect(applyDerivedLayoutChange(basis, derived, next)).toEqual([
      { h: 2, id: "a", w: 4, x: 0, y: 0 },
    ]);
  });
});

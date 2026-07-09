import {
  HOST_DEFAULT_WIDGET_SIZE,
  MISSION_CONTROL_GRID_COLS,
} from "@shared/contracts/mission-control.ts";
import { describe, expect, it } from "vitest";
import { CORE_MISSION_CONTROL_WIDGETS } from "@/panel-kits/mission-control/core-mission-control-widgets.ts";
import { deriveOptimalAutoLayout } from "@/panel-kits/mission-control/mission-control-auto-layout.ts";
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
  resolveResponsiveGridSize,
  sameOrder,
} from "@/panel-kits/mission-control/mission-control-grid-geometry.ts";

describe("entryToLayoutItem", () => {
  it("maps entry fields to layout item with min/max", () => {
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
    expect(item.x).toBe(MISSION_CONTROL_GRID_COLS - 4);
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
  it("strips transient layout fields, keeps id/x/y/w/h", () => {
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

describe("resolveResponsiveGridSize", () => {
  it("没有显式 min/max 时只做必要宽度 clamp，不自动改变高度", () => {
    expect(resolveResponsiveGridSize({ h: 3, w: 4 }, undefined, 12)).toEqual({
      h: 3,
      w: 4,
    });
    expect(resolveResponsiveGridSize({ h: 3, w: 4 }, undefined, 2)).toEqual({
      h: 3,
      w: 2,
    });
  });

  it("显式 minSize 表示自动尺寸，未声明 maxSize 时可放大到可用宽度", () => {
    const decl = {
      defaultSize: { h: 3, w: 4 },
      minSize: { h: 2, w: 3 },
    };
    expect(resolveResponsiveGridSize({ h: 3, w: 4 }, decl, 3)).toEqual({
      h: 2,
      w: 3,
    });
    expect(resolveResponsiveGridSize({ h: 3, w: 4 }, decl, 12)).toEqual({
      h: 3,
      w: 12,
    });
  });

  it("显式 maxSize 表示可自动放大，未声明 minSize 则不自动缩小到基准以下之外", () => {
    const decl = {
      defaultSize: { h: 3, w: 4 },
      maxSize: { h: 5, w: 8 },
    };
    expect(resolveResponsiveGridSize({ h: 3, w: 4 }, decl, 12)).toEqual({
      h: 5,
      w: 8,
    });
    expect(resolveResponsiveGridSize({ h: 3, w: 4 }, decl, 3)).toEqual({
      h: 3,
      w: 3,
    });
  });
});

describe("deriveLayout", () => {
  it("按阅读序派生窄容器布局，并保持确定性", () => {
    const input = [
      { h: 3, i: "b", w: 4, x: 4, y: 0 },
      { h: 3, i: "a", w: 4, x: 0, y: 0 },
      { h: 3, i: "c", w: 4, x: 8, y: 0 },
    ];

    const derived = deriveLayout(input, 8);

    expect(derived.map((item) => item.i)).toEqual(["a", "b", "c"]);
    expect(derived.map(({ i, w, x, y }) => ({ i, w, x, y }))).toEqual([
      { i: "a", w: 4, x: 0, y: 0 },
      { i: "b", w: 4, x: 4, y: 0 },
      { i: "c", w: 4, x: 0, y: 3 },
    ]);
    expect(deriveLayout(input, 8)).toEqual(derived);
    expect(input[0]).toMatchObject({ i: "b", x: 4, y: 0 });
  });

  it("列数小于物料宽度时收敛到可用列宽", () => {
    const derived = deriveLayout([{ h: 3, i: "a", w: 12, x: 0, y: 0 }], 5);
    expect(derived[0]).toMatchObject({ h: 3, i: "a", w: 5, x: 0, y: 0 });
  });

  it("显式 min/max 尺寸参与派生展示尺寸", () => {
    const derived = deriveLayout([{ h: 3, i: "a", w: 4, x: 0, y: 0 }], 8, {
      getSizeDeclaration: () => ({
        defaultSize: { h: 3, w: 4 },
        minSize: { h: 2, w: 3 },
      }),
    });
    expect(derived[0]).toMatchObject({ h: 3, w: 8 });
  });

  it("保序派生不让后续小卡回填到前序卡片之前的空洞", () => {
    const derived = deriveLayout(
      [
        { h: 2, i: "a", w: 5, x: 0, y: 0 },
        { h: 2, i: "b", w: 5, x: 5, y: 0 },
        { h: 2, i: "c", w: 2, x: 10, y: 0 },
      ],
      8
    );
    expect(derived.map(({ i, x, y }) => ({ i, x, y }))).toEqual([
      { i: "a", x: 0, y: 0 },
      { i: "b", x: 0, y: 2 },
      { i: "c", x: 5, y: 2 },
    ]);
  });
});

describe("deriveOptimalAutoLayout", () => {
  const primaryProfiles = {
    layoutPriority: "primary" as const,
    layoutProfiles: [
      { h: 2, key: "compact", w: 3 },
      { h: 3, key: "normal", w: 4 },
      { h: 3, key: "wide", w: 6 },
    ],
  };
  const normalProfiles = {
    layoutPriority: "normal" as const,
    layoutProfiles: [
      { h: 2, key: "compact", w: 2 },
      { h: 3, key: "normal", w: 4 },
      { h: 3, key: "wide", w: 6 },
    ],
  };
  const rowWidths = (layout: ReturnType<typeof deriveOptimalAutoLayout>) =>
    [...new Set(layout.map((l) => l.y))].map((y) =>
      layout.filter((l) => l.y === y).reduce((sum, l) => sum + l.w, 0)
    );
  const emptyArea = (layout: ReturnType<typeof deriveOptimalAutoLayout>) =>
    [...new Set(layout.map((l) => l.y))].reduce((sum, y) => {
      const row = layout.filter((l) => l.y === y);
      const height = Math.max(...row.map((l) => l.h));
      const filled = row.reduce((area, l) => area + l.w * l.h, 0);
      return sum + 12 * height - filled;
    }, 0);

  it("两个 primary 物料在 12 列下优先同排填满整行", () => {
    const layout = deriveOptimalAutoLayout(
      [
        { h: 3, i: "activity", w: 4, x: 0, y: 0 },
        { h: 4, i: "system", w: 4, x: 4, y: 0 },
      ],
      12,
      {
        getSizeDeclaration: () => primaryProfiles,
      }
    );

    expect(layout).toMatchObject([
      { i: "activity", w: 6, x: 0, y: 0 },
      { i: "system", w: 6, x: 6, y: 0 },
    ]);
  });

  it("视觉阅读顺序按 12 列基准坐标派生，而不是 params 数组顺序", () => {
    const layout = deriveOptimalAutoLayout(
      [
        { h: 3, i: "b", w: 4, x: 4, y: 0 },
        { h: 3, i: "a", w: 4, x: 0, y: 0 },
        { h: 3, i: "c", w: 4, x: 8, y: 0 },
      ],
      8,
      {
        getSizeDeclaration: () => normalProfiles,
      }
    );

    expect(
      readingOrderIds(layout.map((l) => ({ id: l.i, x: l.x, y: l.y })))
    ).toEqual(["a", "b", "c"]);
  });

  it("存在满行解时优先选择高利用率布局，不留下可避免行尾空洞", () => {
    const profiles = {
      layoutPriority: "normal" as const,
      layoutProfiles: [
        { h: 3, key: "normal", w: 4 },
        { h: 3, key: "wide", w: 6 },
      ],
    };
    const layout = deriveOptimalAutoLayout(
      ["a", "b", "c", "d", "e"].map((i, n) => ({
        h: 3,
        i,
        w: 4,
        x: (n % 3) * 4,
        y: Math.floor(n / 3) * 3,
      })),
      12,
      { getSizeDeclaration: () => profiles }
    );

    expect(rowWidths(layout)).toEqual([12, 12]);
  });

  it("混合高度物料优先减少实际空洞面积，而不是只看行尾空列", () => {
    const profilesById = new Map([
      [
        "a",
        {
          layoutPriority: "normal" as const,
          layoutProfiles: [{ h: 8, key: "normal", w: 8 }],
        },
      ],
      [
        "b",
        {
          layoutPriority: "normal" as const,
          layoutProfiles: [{ h: 2, key: "normal", w: 4 }],
        },
      ],
      [
        "c",
        {
          layoutPriority: "normal" as const,
          layoutProfiles: [{ h: 2, key: "normal", w: 4 }],
        },
      ],
      [
        "d",
        {
          layoutPriority: "normal" as const,
          layoutProfiles: [{ h: 2, key: "normal", w: 4 }],
        },
      ],
    ]);
    const layout = deriveOptimalAutoLayout(
      [
        { h: 8, i: "a", w: 8, x: 0, y: 0 },
        { h: 2, i: "b", w: 4, x: 8, y: 0 },
        { h: 2, i: "c", w: 4, x: 0, y: 8 },
        { h: 2, i: "d", w: 4, x: 4, y: 8 },
      ],
      12,
      { getSizeDeclaration: (id) => profilesById.get(id) }
    );

    expect(emptyArea(layout)).toBeLessThanOrEqual(40);
  });

  it("有可行替代时避免最后一行只有普通窄卡", () => {
    const twoColumnProfiles = {
      layoutPriority: "normal" as const,
      layoutProfiles: [
        { h: 3, key: "normal", w: 4 },
        { h: 3, key: "wide", w: 6 },
      ],
    };
    const layout = deriveOptimalAutoLayout(
      [
        { h: 3, i: "a", w: 4, x: 0, y: 0 },
        { h: 3, i: "b", w: 4, x: 4, y: 0 },
        { h: 3, i: "c", w: 4, x: 0, y: 3 },
      ],
      8,
      {
        getSizeDeclaration: () => twoColumnProfiles,
      }
    );

    const lastY = Math.max(...layout.map((l) => l.y));
    const lastRow = layout.filter((l) => l.y === lastY);
    expect(lastRow.map((l) => l.i)).toEqual(["b", "c"]);
  });

  it("行内余量优先分给 primary 物料", () => {
    const layout = deriveOptimalAutoLayout(
      [
        { h: 3, i: "primary", w: 4, x: 0, y: 0 },
        { h: 3, i: "normal", w: 4, x: 4, y: 0 },
      ],
      8,
      {
        getSizeDeclaration: (id) =>
          id === "primary" ? primaryProfiles : normalProfiles,
      }
    );

    expect(layout).toMatchObject([
      { i: "primary", w: 6, x: 0, y: 0 },
      { i: "normal", w: 2, x: 6, y: 0 },
    ]);
  });

  it("确定性输出且不修改输入 layout", () => {
    const input = [
      { h: 3, i: "a", w: 4, x: 0, y: 0 },
      { h: 3, i: "b", w: 4, x: 4, y: 0 },
    ];
    const before = JSON.stringify(input);

    expect(
      deriveOptimalAutoLayout(input, 12, {
        getSizeDeclaration: () => primaryProfiles,
      })
    ).toEqual(
      deriveOptimalAutoLayout(input, 12, {
        getSizeDeclaration: () => primaryProfiles,
      })
    );
    expect(JSON.stringify(input)).toBe(before);
  });

  it("真实核心物料在常见列宽下保持稳定阅读序与非空布局", () => {
    const input = [
      { h: 3, i: "core.activity-overview", w: 4, x: 0, y: 0 },
      { h: 4, i: "core.system-resources", w: 4, x: 4, y: 0 },
      { h: 4, i: "instance-1", w: 3, x: 8, y: 0 },
    ];
    const getSizeDeclaration = (id: string) => {
      const widgetId = id === "instance-1" ? "core.custom-card" : id;
      return CORE_MISSION_CONTROL_WIDGETS.find((w) => w.id === widgetId);
    };

    for (const cols of [12, 8, 6, 4]) {
      const layout = deriveOptimalAutoLayout(input, cols, {
        getSizeDeclaration,
      });
      expect(
        readingOrderIds(layout.map((l) => ({ id: l.i, x: l.x, y: l.y })))
      ).toEqual([
        "core.activity-overview",
        "core.system-resources",
        "instance-1",
      ]);
      expect(layout.every((l) => l.w <= cols && l.w > 0 && l.h > 0)).toBe(true);
    }
  });
});

describe("readingOrderIds", () => {
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

    expect(repackEntries(basis, ["b", "a"])).toEqual([
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

    expect(repacked.find((entry) => entry.id === "a")).toMatchObject({
      h: 3,
      w: 4,
    });
    expect(repacked.find((entry) => entry.id === "b")).toMatchObject({
      h: 2,
      w: 8,
    });
  });

  it("newOrder 缺失的 id 追加到末尾，不存在于基准的 id 被忽略", () => {
    const basis = [
      { h: 2, id: "a", w: 6, x: 0, y: 0 },
      { h: 2, id: "b", w: 6, x: 6, y: 0 },
    ];

    expect(repackEntries(basis, ["ghost", "b"]).map((e) => e.id)).toEqual([
      "b",
      "a",
    ]);
  });
});

describe("applyDerivedLayoutChange", () => {
  const basis = [
    { h: 3, id: "a", w: 6, x: 0, y: 0 },
    { h: 3, id: "b", w: 6, x: 6, y: 0 },
  ];
  const derived = [
    { h: 3, i: "a", w: 4, x: 0, y: 0 },
    { h: 3, i: "b", w: 4, x: 4, y: 0 },
  ];

  it("纯挂载回声返回 null，不污染基准布局", () => {
    expect(applyDerivedLayoutChange(basis, derived, derived)).toBeNull();
  });

  it("只调整尺寸时把 w/h 差分写回对应基准条目", () => {
    const next = [
      { h: 4, i: "a", w: 5, x: 0, y: 0 },
      { h: 3, i: "b", w: 4, x: 4, y: 0 },
    ];

    expect(applyDerivedLayoutChange(basis, derived, next)).toEqual([
      { h: 4, id: "a", w: 5, x: 0, y: 0 },
      { h: 3, id: "b", w: 6, x: 6, y: 0 },
    ]);
  });

  it("派生 resize 只改高度时保留基准宽度", () => {
    const narrowBasis = [{ h: 3, id: "wide", w: 12, x: 0, y: 0 }];
    const narrowDerived = [{ h: 3, i: "wide", w: 8, x: 0, y: 0 }];
    const next = [{ h: 4, i: "wide", w: 8, x: 0, y: 0 }];

    expect(applyDerivedLayoutChange(narrowBasis, narrowDerived, next)).toEqual([
      { h: 4, id: "wide", w: 12, x: 0, y: 0 },
    ]);
  });

  it("派生 resize 只改宽度时保留基准高度", () => {
    const narrowBasis = [{ h: 6, id: "tall", w: 12, x: 0, y: 0 }];
    const narrowDerived = [{ h: 4, i: "tall", w: 8, x: 0, y: 0 }];
    const next = [{ h: 4, i: "tall", w: 6, x: 0, y: 0 }];

    expect(applyDerivedLayoutChange(narrowBasis, narrowDerived, next)).toEqual([
      { h: 6, id: "tall", w: 6, x: 0, y: 0 },
    ]);
  });

  it("只拖拽换序时按新阅读序重装基准布局", () => {
    const next = [
      { h: 3, i: "a", w: 4, x: 4, y: 0 },
      { h: 3, i: "b", w: 4, x: 0, y: 0 },
    ];

    expect(applyDerivedLayoutChange(basis, derived, next)).toEqual([
      { h: 3, id: "b", w: 6, x: 0, y: 0 },
      { h: 3, id: "a", w: 6, x: 6, y: 0 },
    ]);
  });
});

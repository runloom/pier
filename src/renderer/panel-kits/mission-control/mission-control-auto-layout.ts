import type {
  MissionControlGridSize,
  MissionControlWidgetLayoutPriority,
  MissionControlWidgetLayoutProfile,
} from "@shared/contracts/mission-control.ts";
import {
  HOST_MAX_WIDGET_SIZE,
  HOST_MIN_WIDGET_SIZE,
  MISSION_CONTROL_GRID_COLS,
} from "@shared/contracts/mission-control.ts";
import type { LayoutItem } from "react-grid-layout";
import {
  clampSize,
  readingOrderCompare,
  type SizeDeclaration,
} from "./mission-control-grid-geometry.ts";

type LayoutCandidate = MissionControlGridSize & {
  key: string;
};

interface AutoLayoutItem {
  candidates: LayoutCandidate[];
  item: LayoutItem;
  priority: MissionControlWidgetLayoutPriority;
}

interface AutoLayoutRow {
  height: number;
  items: {
    item: LayoutItem;
    priority: MissionControlWidgetLayoutPriority;
    size: MissionControlGridSize;
  }[];
  score: number;
}

interface AutoLayoutResult {
  rows: AutoLayoutRow[];
  score: number;
}

interface DeriveOptimalAutoLayoutOptions {
  getSizeDeclaration?: (id: string) => SizeDeclaration | undefined;
}

const PRIORITY_WEIGHT: Record<MissionControlWidgetLayoutPriority, number> = {
  normal: 2,
  primary: 3,
  secondary: 1,
};

const ROW_COUNT_PENALTY = 1000;
const WIDTH_BONUS_UNIT = 24;

/**
 * 自动布局求解器：按 12 列基准几何阅读序，只在连续行断点和候选尺寸之间做全局选择。
 * 目标是高利用率、减少可避免普通孤儿卡，并把行内余量优先分配给高优先级物料。
 */
export function deriveOptimalAutoLayout(
  items: readonly LayoutItem[],
  cols: number,
  options?: DeriveOptimalAutoLayoutOptions
): LayoutItem[] {
  const availableCols = Math.max(1, Math.min(MISSION_CONTROL_GRID_COLS, cols));
  const sorted = [...items].sort((a, b) =>
    readingOrderCompare(
      { id: a.i, x: a.x, y: a.y },
      { id: b.i, x: b.x, y: b.y }
    )
  );
  const autoItems = sorted.map((item) => {
    const decl = options?.getSizeDeclaration?.(item.i);
    return {
      candidates: sizeCandidates(item, decl, availableCols),
      item,
      priority: decl?.layoutPriority ?? "normal",
    };
  });

  const dp: AutoLayoutResult[] = Array.from(
    { length: autoItems.length + 1 },
    () => ({ rows: [], score: Number.POSITIVE_INFINITY })
  );
  dp[autoItems.length] = { rows: [], score: 0 };

  for (let start = autoItems.length - 1; start >= 0; start--) {
    for (let end = start + 1; end <= autoItems.length; end++) {
      const minWidth = autoItems.slice(start, end).reduce((sum, item) => {
        const first = item.candidates[0];
        return first ? sum + first.w : sum;
      }, 0);
      if (minWidth > availableCols && end > start + 1) {
        break;
      }

      const row = bestRow(
        autoItems.slice(start, end),
        availableCols,
        end === autoItems.length,
        autoItems.length
      );
      if (!row) {
        continue;
      }
      const rest = dp[end] ?? { rows: [], score: Number.POSITIVE_INFINITY };
      const score = row.score + rest.score;
      const current = dp[start] ?? {
        rows: [],
        score: Number.POSITIVE_INFINITY,
      };
      if (score < current.score) {
        dp[start] = { rows: [row, ...rest.rows], score };
      }
    }
  }

  let y = 0;
  const placed: LayoutItem[] = [];
  for (const row of (dp[0] ?? { rows: [], score: 0 }).rows) {
    let x = 0;
    for (const entry of row.items) {
      const item = entry.item;
      const derived: LayoutItem = {
        ...item,
        h: entry.size.h,
        w: entry.size.w,
        x,
        y,
      };
      if (item.minW !== undefined) {
        derived.minW = Math.min(item.minW, availableCols);
      }
      if (item.maxW !== undefined) {
        derived.maxW = Math.min(item.maxW, availableCols);
      }
      if (item.minH !== undefined) {
        derived.minH = item.minH;
      }
      if (item.maxH !== undefined) {
        derived.maxH = item.maxH;
      }
      placed.push(derived);
      x += entry.size.w;
    }
    y += row.height;
  }
  return placed;
}

function bestRow(
  items: readonly AutoLayoutItem[],
  cols: number,
  isLastRow: boolean,
  totalCount: number
): AutoLayoutRow | null {
  let best: AutoLayoutRow | null = null;

  const visit = (
    index: number,
    picked: AutoLayoutRow["items"],
    usedWidth: number,
    rowHeight: number
  ) => {
    if (index === items.length) {
      const unused = cols - usedWidth;
      const filledArea = picked.reduce(
        (sum, entry) => sum + entry.size.w * entry.size.h,
        0
      );
      const emptyArea = cols * rowHeight - filledArea;
      const first = items[0];
      const ordinaryOrphan =
        items.length === 1 && first?.priority !== "primary" && usedWidth < cols;
      const orphanPenalty =
        ordinaryOrphan && totalCount > 1
          ? 2500 + unused * 100 + (isLastRow ? 2500 : 0)
          : 0;
      const widthBonus = picked.reduce(
        (sum, entry) =>
          sum +
          entry.size.w * PRIORITY_WEIGHT[entry.priority] * WIDTH_BONUS_UNIT,
        0
      );
      const score =
        ROW_COUNT_PENALTY +
        emptyArea * 20 +
        unused * unused * 25 +
        rowHeight * 5 +
        orphanPenalty -
        widthBonus;
      const row: AutoLayoutRow = {
        height: rowHeight,
        items: picked,
        score,
      };
      if (!best || row.score < best.score) {
        best = row;
      }
      return;
    }

    const current = items[index];
    if (!current) {
      return;
    }
    for (const size of current.candidates) {
      if (usedWidth + size.w > cols) {
        continue;
      }
      visit(
        index + 1,
        [...picked, { item: current.item, priority: current.priority, size }],
        usedWidth + size.w,
        Math.max(rowHeight, size.h)
      );
    }
  };

  visit(0, [], 0, 0);
  return best;
}

function sizeCandidates(
  item: LayoutItem,
  decl: SizeDeclaration | undefined,
  cols: number
): LayoutCandidate[] {
  const profiles =
    decl?.layoutProfiles && decl.layoutProfiles.length > 0
      ? decl.layoutProfiles
      : fallbackProfiles(item, decl, cols);
  const byKey = new Map<string, LayoutCandidate>();
  const min = decl?.minSize ?? HOST_MIN_WIDGET_SIZE;
  const max = decl?.maxSize ?? HOST_MAX_WIDGET_SIZE;
  for (const profile of profiles) {
    const clamped = clampSize(profile, min, max);
    const size = {
      h: clamped.h,
      key: profile.key,
      w: Math.max(1, Math.min(cols, clamped.w)),
    };
    byKey.set(`${size.w}:${size.h}`, size);
  }
  return [...byKey.values()].sort((a, b) => a.w - b.w || a.h - b.h);
}

function fallbackProfiles(
  item: LayoutItem,
  decl: SizeDeclaration | undefined,
  cols: number
): MissionControlWidgetLayoutProfile[] {
  const dflt = decl?.defaultSize ?? { h: item.h, w: item.w };
  const profiles: MissionControlWidgetLayoutProfile[] = [
    { h: dflt.h, key: "normal", w: dflt.w },
  ];
  if (decl?.minSize) {
    profiles.push({ ...decl.minSize, key: "compact" });
  }
  if (decl?.maxSize) {
    profiles.push({ ...decl.maxSize, key: "wide" });
  } else if (decl?.minSize || decl?.maxSize) {
    profiles.push({ h: dflt.h, key: "wide", w: cols });
  }
  return profiles;
}

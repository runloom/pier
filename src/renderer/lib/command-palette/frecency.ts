/**
 * 命令面板 MRU 排序算法.
 *
 *   frecency = useCount × 0.5^(ageDays / HALF_LIFE_DAYS)
 *
 * 半衰期 14 天: 两周不用, 权重折半. 参数硬编码, 后续观察体感再调.
 */
import type { MruEntry } from "@shared/contracts/command-palette-mru.ts";
import type { Action } from "@/lib/actions/types.ts";

const HALF_LIFE_DAYS = 14;
const MS_PER_DAY = 86_400_000;

export const CATEGORY_META: Record<
  string,
  { labelKey: string; order: number }
> = {
  View: { order: 0, labelKey: "view" },
  Workspace: { order: 1, labelKey: "workspace" },
  Panel: { order: 2, labelKey: "panel" },
  Window: { order: 3, labelKey: "window" },
  Settings: { order: 4, labelKey: "settings" },
};

export const UNKNOWN_ORDER = Object.keys(CATEGORY_META).length;

export function buildFrecencyMap(
  entries: readonly MruEntry[],
  now: number
): ReadonlyMap<string, number> {
  const map = new Map<string, number>();
  for (const entry of entries) {
    const ageDays = (now - entry.lastUsedAt) / MS_PER_DAY;
    map.set(entry.actionId, entry.useCount * 0.5 ** (ageDays / HALF_LIFE_DAYS));
  }
  return map;
}

export type ActionRank =
  | { tier: "frecency"; score: number }
  | { tier: "fallback"; sortOrder: number };

export function actionRank(
  action: Action,
  frecencyMap: ReadonlyMap<string, number>
): ActionRank {
  const score = frecencyMap.get(action.id);
  return score == null
    ? { tier: "fallback", sortOrder: action.metadata?.sortOrder ?? 0 }
    : { tier: "frecency", score };
}

export type GroupRank =
  | { tier: "frecency"; maxScore: number }
  | { tier: "fallback"; order: number };

export function groupRank(
  actions: readonly Action[],
  frecencyMap: ReadonlyMap<string, number>
): GroupRank {
  let maxScore = Number.NEGATIVE_INFINITY;
  for (const a of actions) {
    const s = frecencyMap.get(a.id);
    if (s != null && s > maxScore) {
      maxScore = s;
    }
  }
  if (maxScore > Number.NEGATIVE_INFINITY) {
    return { tier: "frecency", maxScore };
  }
  const category = actions[0]?.category ?? "";
  return {
    tier: "fallback",
    order: CATEGORY_META[category]?.order ?? UNKNOWN_ORDER,
  };
}

export function compareActions(
  a: Action,
  b: Action,
  frecencyMap: ReadonlyMap<string, number>
): number {
  const ra = actionRank(a, frecencyMap);
  const rb = actionRank(b, frecencyMap);
  // frecency tier 在前
  if (ra.tier === "frecency" && rb.tier === "fallback") {
    return -1;
  }
  if (ra.tier === "fallback" && rb.tier === "frecency") {
    return 1;
  }
  if (ra.tier === "frecency" && rb.tier === "frecency") {
    return rb.score - ra.score; // 高分在前
  }
  if (ra.tier === "fallback" && rb.tier === "fallback") {
    return ra.sortOrder - rb.sortOrder; // 小 sortOrder 在前
  }
  return 0;
}

export function compareGroups(
  ga: readonly Action[],
  gb: readonly Action[],
  frecencyMap: ReadonlyMap<string, number>
): number {
  const ra = groupRank(ga, frecencyMap);
  const rb = groupRank(gb, frecencyMap);
  if (ra.tier === "frecency" && rb.tier === "fallback") {
    return -1;
  }
  if (ra.tier === "fallback" && rb.tier === "frecency") {
    return 1;
  }
  if (ra.tier === "frecency" && rb.tier === "frecency") {
    return rb.maxScore - ra.maxScore;
  }
  if (ra.tier === "fallback" && rb.tier === "fallback") {
    return ra.order - rb.order;
  }
  return 0;
}

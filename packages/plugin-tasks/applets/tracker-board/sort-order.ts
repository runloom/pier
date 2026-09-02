export function rankBetween(before?: number, after?: number): number {
  if (typeof before === "number" && typeof after === "number") {
    if (after > before) {
      return (before + after) / 2;
    }
    return before + 1e-3;
  }
  if (typeof before === "number") {
    return before + 1000;
  }
  if (typeof after === "number") {
    return after - 1000;
  }
  return 0;
}

export function canPersistNumericRank(before?: number, after?: number): boolean {
  if (typeof before === "number" && typeof after === "number") {
    return after > before;
  }
  return true;
}

export function placeCardInColumn<T extends { key: string; sortOrder?: number }>(
  items: readonly T[],
  card: T,
  index?: number
): {
  items: T[];
  persistSortOrder: boolean;
  rankAfterKey?: string;
  rankBeforeKey?: string;
  sortOrder: number;
} {
  const without = items.filter((item) => item.key !== card.key);
  const at =
    index === undefined
      ? without.length
      : Math.max(0, Math.min(index, without.length));
  const before = without[at - 1]?.sortOrder;
  const after = without[at]?.sortOrder;
  const sortOrder = rankBetween(before, after);
  const rankAfterKey = without[at - 1]?.key;
  const rankBeforeKey = without[at]?.key;
  return {
    items: [
      ...without.slice(0, at),
      { ...card, sortOrder },
      ...without.slice(at),
    ],
    persistSortOrder: canPersistNumericRank(before, after),
    sortOrder,
    ...(rankAfterKey ? { rankAfterKey } : {}),
    ...(rankBeforeKey ? { rankBeforeKey } : {}),
  };
}

export function largestIndexMove(
  previous: readonly string[],
  next: readonly string[]
): { index: number; key: string } | null {
  if (previous.length !== next.length) {
    return null;
  }
  const prevIndex = new Map(previous.map((key, index) => [key, index]));
  let best: { delta: number; index: number; key: string } | null = null;
  for (let index = 0; index < next.length; index += 1) {
    const key = next[index];
    if (!key) {
      continue;
    }
    const from = prevIndex.get(key);
    if (from === undefined || from === index) {
      continue;
    }
    const delta = Math.abs(from - index);
    if (!best || delta > best.delta) {
      best = { delta, index, key };
    }
  }
  return best ? { index: best.index, key: best.key } : null;
}

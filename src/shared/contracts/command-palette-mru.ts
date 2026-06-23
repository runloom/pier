/**
 * 命令面板 MRU 持久化 schema. 详见 docs/superpowers/specs/2026-06-23-command-palette-mru-design.md
 */
import { z } from "zod";

export const mruEntrySchema = z.object({
  actionId: z.string().min(1),
  useCount: z.number().int().nonnegative(),
  lastUsedAt: z.number().int(),
});

export const mruStateSchema = z.object({
  version: z.literal(1),
  entries: z.array(mruEntrySchema).max(200),
});

export type MruEntry = z.infer<typeof mruEntrySchema>;
export type MruState = z.infer<typeof mruStateSchema>;

export const EMPTY_MRU_STATE: MruState = { version: 1, entries: [] };
export const MRU_MAX_ENTRIES = 200;

/** 半衰期 14 天: 两周不用, 权重折半. main state evictWeakest 和 renderer
 * frecency.ts 双端共用, 调这里就两边都生效. */
export const HALF_LIFE_DAYS = 14;
export const MS_PER_DAY = 86_400_000;

/** frecency = useCount × 0.5^(ageDays / HALF_LIFE_DAYS).
 * 同时在 main state.evictWeakest 和 renderer buildFrecencyMap 使用. */
export function frecency(entry: MruEntry, now: number): number {
  const ageDays = (now - entry.lastUsedAt) / MS_PER_DAY;
  return entry.useCount * 0.5 ** (ageDays / HALF_LIFE_DAYS);
}

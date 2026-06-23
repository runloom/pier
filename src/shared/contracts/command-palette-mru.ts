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

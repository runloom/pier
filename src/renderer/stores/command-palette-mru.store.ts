/**
 * 命令面板 MRU store. 详见 specs/2026-06-23-command-palette-mru-design.md.
 *
 * - init: read + 订阅 onChange (main 端 record/clear 都会广播)
 * - recordUse: 本地立即更新 + fire-and-forget IPC
 * - frecencyMap 仅 entries 引用变化时重算
 */
import {
  EMPTY_MRU_STATE,
  type MruEntry,
  type MruState,
} from "@shared/contracts/command-palette-mru.ts";
import { create } from "zustand";
import { buildFrecencyMap } from "@/lib/command-palette/frecency.ts";

interface CommandPaletteMruStore {
  clear(): Promise<void>;
  entries: readonly MruEntry[];
  frecencyMap: ReadonlyMap<string, number>;
  recordUse(actionId: string): void;
}

function recompute(entries: readonly MruEntry[]): ReadonlyMap<string, number> {
  return buildFrecencyMap(entries, Date.now());
}

function applyLocal(
  prev: readonly MruEntry[],
  actionId: string,
  now: number
): readonly MruEntry[] {
  const idx = prev.findIndex((e) => e.actionId === actionId);
  if (idx >= 0) {
    const existing = prev[idx];
    if (existing) {
      const updated: MruEntry = {
        ...existing,
        useCount: existing.useCount + 1,
        lastUsedAt: now,
      };
      const next = prev.slice();
      next[idx] = updated;
      return next;
    }
  }
  return [...prev, { actionId, useCount: 1, lastUsedAt: now }];
}

export const useCommandPaletteMru = create<CommandPaletteMruStore>(
  (set, get) => ({
    entries: EMPTY_MRU_STATE.entries,
    frecencyMap: new Map(),

    recordUse: (actionId) => {
      const nextEntries = applyLocal(get().entries, actionId, Date.now());
      set({ entries: nextEntries, frecencyMap: recompute(nextEntries) });
      window.pier?.commandPaletteMru?.recordUse?.(actionId);
    },

    clear: async () => {
      try {
        await window.pier?.commandPaletteMru?.clear?.();
        // 广播回来会通过 onChange 重置, 这里不直接 set 避免双写
      } catch (err) {
        console.error("[command-palette-mru] clear 失败:", err);
        // 仍然本地清空保持 UI 一致
        set({ entries: [], frecencyMap: new Map() });
      }
    },
  })
);

export async function initCommandPaletteMru(): Promise<void> {
  const api = window.pier?.commandPaletteMru;
  if (!api) {
    return;
  }
  try {
    const state = await api.read();
    useCommandPaletteMru.setState({
      entries: state.entries,
      frecencyMap: recompute(state.entries),
    });
  } catch (err) {
    console.error("[command-palette-mru] init read 失败:", err);
  }
  api.onChange((state: MruState) => {
    useCommandPaletteMru.setState({
      entries: state.entries,
      frecencyMap: recompute(state.entries),
    });
  });
}

/**
 * 命令面板 MRU store. 详见 specs/2026-06-23-command-palette-mru-design.md.
 *
 * - init: read + 订阅 onChange (main 端 record/clear 都会广播)
 * - recordUse: 本地立即更新 + fire-and-forget IPC
 * - frecencyMap 仅 entries 引用变化时重算
 */
import {
  EMPTY_MRU_STATE,
  frecency,
  MRU_MAX_ENTRIES,
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
  const incoming: MruEntry = { actionId, useCount: 1, lastUsedAt: now };
  if (prev.length < MRU_MAX_ENTRIES) {
    return [...prev, incoming];
  }
  // 已满: 按 frecency 淘汰最弱, 与 main evictWeakest 同语义, 保证渲染器瞬时状态也守 schema max(200).
  let weakestIdx = 0;
  const head = prev[0];
  let weakestScore = head ? frecency(head, now) : 0;
  for (let i = 1; i < prev.length; i++) {
    const e = prev[i];
    if (!e) {
      continue;
    }
    const s = frecency(e, now);
    if (s < weakestScore) {
      weakestScore = s;
      weakestIdx = i;
    }
  }
  return [...prev.filter((_, i) => i !== weakestIdx), incoming];
}

function entriesEqual(a: readonly MruEntry[], b: readonly MruEntry[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (!(x && y)) {
      return false;
    }
    if (
      x.actionId !== y.actionId ||
      x.useCount !== y.useCount ||
      x.lastUsedAt !== y.lastUsedAt
    ) {
      return false;
    }
  }
  return true;
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
      const api = window.pier?.commandPaletteMru;
      // #3: preload 缺失 → 本地兜底, 不让 await undefined 静默成功.
      if (!api) {
        set({ entries: [], frecencyMap: new Map() });
        return;
      }
      try {
        // #10: 用 IPC 返回值兜底, 不再仅依赖 broadcast 触发 onChange.
        const next = await api.clear();
        set({
          entries: next.entries,
          frecencyMap: recompute(next.entries),
        });
      } catch (err) {
        console.error("[command-palette-mru] clear 失败:", err);
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

  let onChangeApplied = false;

  // 先订阅 onChange, 否则 await read 期间到来的广播会丢失
  api.onChange((state: MruState) => {
    onChangeApplied = true;
    if (entriesEqual(state.entries, useCommandPaletteMru.getState().entries)) {
      return;
    }
    useCommandPaletteMru.setState({
      entries: state.entries,
      frecencyMap: recompute(state.entries),
    });
  });

  try {
    const state = await api.read();
    if (onChangeApplied) {
      // read 等待期间已有更新到达, 它的快照可能比当前状态旧, 跳过覆盖.
      return;
    }
    useCommandPaletteMru.setState({
      entries: state.entries,
      frecencyMap: recompute(state.entries),
    });
  } catch (err) {
    console.error("[command-palette-mru] init read 失败:", err);
  }
}

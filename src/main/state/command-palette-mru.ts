/**
 * 命令面板 MRU 持久化层. 纯函数 (recordUse, evictWeakest) 暴露给单测;
 * IO 函数 (readMruState, writeMruState) 走 debounced store.
 */
import { join } from "node:path";
import {
  EMPTY_MRU_STATE,
  frecency,
  MRU_MAX_ENTRIES,
  type MruEntry,
  type MruState,
  mruStateSchema,
} from "@shared/contracts/command-palette-mru.ts";
import { app } from "electron";
import {
  type DebouncedJsonStore,
  debouncedJsonStore,
} from "./debounced-store.ts";

export function evictWeakest(
  entries: readonly MruEntry[],
  now: number
): MruEntry[] {
  const first = entries[0];
  if (!first) {
    return [];
  }
  let weakestIdx = 0;
  let weakestScore = frecency(first, now);
  for (let i = 1; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) {
      continue;
    }
    const score = frecency(entry, now);
    if (score < weakestScore) {
      weakestIdx = i;
      weakestScore = score;
    }
  }
  return entries.filter((_, i) => i !== weakestIdx);
}

export function recordUse(
  state: MruState,
  actionId: string,
  now: number
): MruState {
  const existingIdx = state.entries.findIndex((e) => e.actionId === actionId);
  let entries: MruEntry[];
  if (existingIdx >= 0) {
    const prev = state.entries[existingIdx];
    if (!prev) {
      return state;
    }
    entries = [
      {
        actionId,
        useCount: prev.useCount + 1,
        lastUsedAt: now,
      },
      ...state.entries.filter((_, i) => i !== existingIdx),
    ];
  } else {
    entries = [{ actionId, useCount: 1, lastUsedAt: now }, ...state.entries];
  }
  while (entries.length > MRU_MAX_ENTRIES) {
    entries = evictWeakest(entries, now);
  }
  return { version: 1, entries };
}

function resolveFilePath(): string {
  return join(app.getPath("userData"), "command-palette-mru.json");
}

let store: DebouncedJsonStore<MruState> | undefined;

function getStore(): DebouncedJsonStore<MruState> {
  if (!store) {
    store = debouncedJsonStore<MruState>({
      filePath: resolveFilePath(),
      defaults: EMPTY_MRU_STATE,
      debounceMs: 500,
    });
  }
  return store;
}

async function ensureStore(): Promise<DebouncedJsonStore<MruState>> {
  const s = getStore();
  try {
    const raw = await s.init();
    mruStateSchema.parse(raw);
  } catch (err) {
    console.warn("[command-palette-mru] parse failed, using empty state:", err);
    await s.clear();
    await s.init();
  }
  return s;
}

export async function readMruState(): Promise<MruState> {
  const s = await ensureStore();
  return s.get();
}

export async function writeMruState(state: MruState): Promise<void> {
  const s = await ensureStore();
  s.replace(state);
}

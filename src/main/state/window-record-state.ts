import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { app } from "electron";
import { z } from "zod";
import {
  type DebouncedJsonStore,
  debouncedJsonStore,
} from "./debounced-store.ts";

const windowRecordSchema = z.object({
  id: z.string().min(1),
  layout: z.unknown().optional(),
  updatedAt: z.string(),
});

const windowRecordStateSchema = z.object({
  lastFocusedWindowRecordId: z.string().min(1).nullable().optional(),
  openWindowRecordIds: z.array(z.string().min(1)),
  recentlyClosedWindowRecordIds: z.array(z.string().min(1)),
  records: z.record(z.string(), windowRecordSchema),
  version: z.literal(1),
});

export type WindowRecord = z.infer<typeof windowRecordSchema>;
type WindowRecordState = z.infer<typeof windowRecordStateSchema>;

const DEFAULTS: WindowRecordState = {
  lastFocusedWindowRecordId: null,
  openWindowRecordIds: [],
  recentlyClosedWindowRecordIds: [],
  records: {},
  version: 1,
};

function resolveFilePath(): string {
  return join(app.getPath("userData"), "window-record-state.json");
}

let store: DebouncedJsonStore<WindowRecordState> | undefined;

function getStore(): DebouncedJsonStore<WindowRecordState> {
  if (!store) {
    store = debouncedJsonStore<WindowRecordState>({
      filePath: resolveFilePath(),
      defaults: DEFAULTS,
      debounceMs: 500,
    });
  }
  return store;
}

async function ensureStore(): Promise<DebouncedJsonStore<WindowRecordState>> {
  const s = getStore();
  try {
    const raw = await s.init();
    windowRecordStateSchema.parse(raw);
  } catch (err) {
    console.warn(
      "[window-record-state] parse failed, resetting to defaults:",
      err
    );
    await s.clear();
    await s.init();
  }
  return s;
}

function now(): string {
  return new Date().toISOString();
}

function ensureRecord(
  state: WindowRecordState,
  recordId: string
): WindowRecord {
  const existing = state.records[recordId];
  if (existing) {
    return existing;
  }
  const record = {
    id: recordId,
    updatedAt: now(),
  };
  state.records[recordId] = record;
  return record;
}

function withoutId(ids: readonly string[], recordId: string): string[] {
  return ids.filter((id) => id !== recordId);
}

export async function createWindowRecord(): Promise<WindowRecord> {
  const s = await ensureStore();
  const id = randomUUID();
  const record = {
    id,
    updatedAt: now(),
  };
  s.mutate((state) => {
    state.records[id] = record;
    return state;
  });
  return record;
}

export async function markWindowRecordOpen(recordId: string): Promise<void> {
  if (recordId.trim().length === 0) {
    return;
  }
  const s = await ensureStore();
  s.mutate((state) => {
    const record = ensureRecord(state, recordId);
    record.updatedAt = now();
    state.openWindowRecordIds = [
      ...withoutId(state.openWindowRecordIds, recordId),
      recordId,
    ];
    state.recentlyClosedWindowRecordIds = withoutId(
      state.recentlyClosedWindowRecordIds,
      recordId
    );
    return state;
  });
}

export async function markWindowRecordClosed(recordId: string): Promise<void> {
  if (recordId.trim().length === 0) {
    return;
  }
  const s = await ensureStore();
  s.mutate((state) => {
    const record = ensureRecord(state, recordId);
    record.updatedAt = now();
    state.openWindowRecordIds = withoutId(state.openWindowRecordIds, recordId);
    state.recentlyClosedWindowRecordIds = [
      recordId,
      ...withoutId(state.recentlyClosedWindowRecordIds, recordId),
    ];
    return state;
  });
}

export async function markWindowRecordFocused(recordId: string): Promise<void> {
  if (recordId.trim().length === 0) {
    return;
  }
  const s = await ensureStore();
  s.mutate((state) => {
    const record = state.records[recordId];
    if (!record) {
      return state;
    }
    record.updatedAt = now();
    state.lastFocusedWindowRecordId = recordId;
    return state;
  });
}

export async function readOpenWindowRecordIds(): Promise<string[]> {
  const s = await ensureStore();
  return [...s.get().openWindowRecordIds];
}

export async function readPreferredOpenWindowRecordIds(): Promise<string[]> {
  const s = await ensureStore();
  const state = s.get();
  const openIds = [...state.openWindowRecordIds];
  const preferredId = state.lastFocusedWindowRecordId;
  if (!(preferredId && openIds.includes(preferredId))) {
    return openIds;
  }
  return [preferredId, ...openIds.filter((id) => id !== preferredId)];
}

export async function readMostRecentClosedWindowRecordId(): Promise<
  string | null
> {
  const s = await ensureStore();
  return s.get().recentlyClosedWindowRecordIds[0] ?? null;
}

export async function readWindowRecordLayout(
  recordId: string
): Promise<unknown | null> {
  if (recordId.trim().length === 0) {
    return null;
  }
  const s = await ensureStore();
  return s.get().records[recordId]?.layout ?? null;
}

export async function saveWindowRecordLayout(
  recordId: string,
  layout: unknown
): Promise<void> {
  if (recordId.trim().length === 0) {
    return;
  }
  const s = await ensureStore();
  s.mutate((state) => {
    const record = ensureRecord(state, recordId);
    record.layout = layout;
    record.updatedAt = now();
    return state;
  });
  await s.flush();
}

export async function clearWindowRecordLayout(recordId: string): Promise<void> {
  if (recordId.trim().length === 0) {
    return;
  }
  const s = await ensureStore();
  s.mutate((state) => {
    const record = state.records[recordId];
    if (record) {
      state.records[recordId] = {
        id: record.id,
        updatedAt: now(),
      };
    }
    return state;
  });
  await s.flush();
}

export async function flushWindowRecordState(): Promise<void> {
  const s = await ensureStore();
  await s.flush();
}

/**
 * 命令面板 MRU 持久化层. 纯函数 (recordUse, evictWeakest) 暴露给单测;
 * IO 函数 (readMruState, writeMruState) 走 lockfile + atomic write.
 *
 * IO pattern 抄自 src/main/state/preferences.ts.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  EMPTY_MRU_STATE,
  frecency,
  MRU_MAX_ENTRIES,
  type MruEntry,
  type MruState,
  mruStateSchema,
} from "@shared/contracts/command-palette-mru.ts";
import { app } from "electron";
import lockfile from "proper-lockfile";
import writeFileAtomic from "write-file-atomic";

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
    const current = entries[i];
    if (!current) {
      continue;
    }
    const s = frecency(current, now);
    if (s < weakestScore) {
      weakestScore = s;
      weakestIdx = i;
    }
  }
  return entries.filter((_, i) => i !== weakestIdx);
}

export function recordUse(
  state: MruState,
  actionId: string,
  now: number
): MruState {
  const idx = state.entries.findIndex((e) => e.actionId === actionId);
  const existing = idx >= 0 ? state.entries[idx] : undefined;
  if (existing) {
    const updated: MruEntry = {
      actionId: existing.actionId,
      useCount: existing.useCount + 1,
      lastUsedAt: now,
    };
    const entries = state.entries.slice();
    entries[idx] = updated;
    return { ...state, entries };
  }
  const incoming: MruEntry = { actionId, useCount: 1, lastUsedAt: now };
  const base =
    state.entries.length >= MRU_MAX_ENTRIES
      ? evictWeakest(state.entries, now)
      : state.entries;
  return { ...state, entries: [...base, incoming] };
}

function resolveFilePath(): string {
  return join(app.getPath("userData"), "command-palette-mru.json");
}

async function ensureDir(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
}

export async function readMruState(): Promise<MruState> {
  const path = resolveFilePath();
  if (!existsSync(path)) {
    return EMPTY_MRU_STATE;
  }
  try {
    const raw = await readFile(path, "utf-8");
    return mruStateSchema.parse(JSON.parse(raw));
  } catch (err) {
    console.warn("[command-palette-mru] schema 校验失败, 回到空状态:", err);
    return EMPTY_MRU_STATE;
  }
}

export async function writeMruState(state: MruState): Promise<void> {
  const path = resolveFilePath();
  await ensureDir(path);
  // 首次写: 文件还不存在时 lockfile.lock 会拒, 所以先 touch 一个空状态再加锁覆盖.
  if (!existsSync(path)) {
    await writeFileAtomic(
      path,
      `${JSON.stringify(EMPTY_MRU_STATE, null, 2)}\n`
    );
  }
  const release = await lockfile.lock(path);
  try {
    await writeFileAtomic(path, `${JSON.stringify(state, null, 2)}\n`);
  } finally {
    await release();
  }
}

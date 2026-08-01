/**
 * 消息去重：同一 dedupeKey 在窗口期内不新增条目，合并为 repeatCount++ 并顶到最新。
 *
 * 合并 inbox 条目；是否再弹 toast 仍由 report.suppressToast 决定
 * （agent.attention 可重复打断；app-update 等 one-shot 由调用方带 suppressToast）。
 * app-update ready 的进程级单次上报在 main `notifyAppUpdateReady`（downloaded 边沿）。
 */

import { NOTIFICATION_DEDUPE_WINDOW_MS } from "@shared/contracts/notification-center.ts";

export interface DedupeMergeDecision {
  /** 命中的既有条目 id；未命中为 null（应新增条目）。 */
  existingId: string | null;
}

export function decideDedupe(
  existing: ReadonlyArray<{
    dedupeKey?: string | undefined;
    id: string;
    ts: number;
  }>,
  input: { dedupeKey?: string | undefined; ts: number },
  windowMs: number = NOTIFICATION_DEDUPE_WINDOW_MS
): DedupeMergeDecision {
  if (!input.dedupeKey) {
    return { existingId: null };
  }
  // items 按 ts 倒序，首个命中即最新一条。
  const hit = existing.find(
    (item) =>
      item.dedupeKey === input.dedupeKey && input.ts - item.ts <= windowMs
  );
  return { existingId: hit ? hit.id : null };
}

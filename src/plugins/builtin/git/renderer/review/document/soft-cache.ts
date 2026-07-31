import type { GitReviewScope } from "@shared/contracts/git/review.ts";
import type { GitReviewDocumentResource } from "./resource.ts";

type LoadedResource = Extract<GitReviewDocumentResource, { kind: "loaded" }>;

/**
 * 同 scope 跨阅读面共享的 soft-retain 正文池。
 *
 * stage 会把用户从 index 切到 staged；新面首挂若只读空 session，会整页 estimate 空白。
 * 各面 dispose 才写 session 太晚——仍在挂载的源面还没卸，目标面已经冷启动。
 * 这里用进程内 map，按 scope（不含 diffBase）发布 loaded 文档，供新面 previousByEntryKey 种子。
 */
const softByScopeKey = new Map<string, Map<string, LoadedResource>>();

export function reviewDocumentSoftCacheScopeKey(
  scope: Pick<GitReviewScope, "contextId" | "gitRootPath" | "target">
): string {
  return JSON.stringify([scope.contextId, scope.gitRootPath, scope.target]);
}

/** 每 scope 最多常驻 loaded 份数；超出按插入序丢最旧（保护后写入的新文件）。 */
export const GIT_REVIEW_SOFT_CACHE_MAX_ENTRIES = 96;

export function publishReviewDocumentSoftCache(
  scopeKey: string,
  resources:
    | ReadonlyMap<string, GitReviewDocumentResource>
    | Iterable<GitReviewDocumentResource>
): void {
  const next = new Map(softByScopeKey.get(scopeKey));
  const list = resources instanceof Map ? resources.values() : resources;
  for (const resource of list) {
    if (resource.kind === "loaded") {
      // 再写入时移到队尾（Map 插入序 = LRU 近似）
      next.delete(resource.entry.entryKey);
      next.set(resource.entry.entryKey, resource);
    }
  }
  while (next.size > GIT_REVIEW_SOFT_CACHE_MAX_ENTRIES) {
    const oldest = next.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    next.delete(oldest);
  }
  if (next.size === 0) {
    softByScopeKey.delete(scopeKey);
    return;
  }
  softByScopeKey.set(scopeKey, next);
}

/** 用当前有效 loaded 集合整体替换（dispose 时与 session 对齐）。 */
export function replaceReviewDocumentSoftCache(
  scopeKey: string,
  loadedByEntryKey: ReadonlyMap<string, LoadedResource>
): void {
  if (loadedByEntryKey.size === 0) {
    softByScopeKey.delete(scopeKey);
    return;
  }
  softByScopeKey.set(scopeKey, new Map(loadedByEntryKey));
}

export function readReviewDocumentSoftCache(
  scopeKey: string
): ReadonlyMap<string, LoadedResource> {
  return softByScopeKey.get(scopeKey) ?? new Map();
}

export function clearReviewDocumentSoftCache(scopeKey?: string): void {
  if (scopeKey === undefined) {
    softByScopeKey.clear();
    return;
  }
  softByScopeKey.delete(scopeKey);
}

export function clearAllReviewDocumentSoftCachesForTests(): void {
  softByScopeKey.clear();
}

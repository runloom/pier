/**
 * Files quick-open MRU — window-scoped, root-bucketed, memory-only (design §5.2).
 *
 * Hard cap `FILE_PATH_QUERY_MRU_MAX` (contract). Newest-first ordering; a
 * re-recorded path moves to the head without duplicating. Never persisted,
 * never shared across windows.
 */
import { FILE_PATH_QUERY_MRU_MAX } from "@shared/contracts/file-query.ts";

const buckets = new Map<string, string[]>();

export function recordFilesPathMru(root: string, relativePath: string): void {
  if (root.length === 0 || relativePath.length === 0) {
    return;
  }
  const existing = buckets.get(root);
  if (existing === undefined) {
    buckets.set(root, [relativePath]);
    return;
  }
  if (existing[0] === relativePath) {
    return;
  }
  const filtered = existing.filter((p) => p !== relativePath);
  filtered.unshift(relativePath);
  if (filtered.length > FILE_PATH_QUERY_MRU_MAX) {
    filtered.length = FILE_PATH_QUERY_MRU_MAX;
  }
  buckets.set(root, filtered);
}

export function listFilesPathMru(root: string): readonly string[] {
  const existing = buckets.get(root);
  if (existing === undefined) {
    return [];
  }
  return existing.slice();
}

/** Test-only: clear every bucket so cases start from a clean state. */
export function __resetFilesPathMruForTests(): void {
  buckets.clear();
}

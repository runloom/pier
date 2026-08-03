/**
 * Persist Files tree expansion intents per project root (localStorage).
 * Storage mechanics live in `@pier/ui/file/tree-expansion-persist.ts`; this
 * module only owns the Files-specific key space.
 */
import type { TreeExpansionAuthority } from "@pier/ui/file/tree.tsx";
import {
  bindTreeExpansionPersistence,
  readTreeExpansion,
  writeTreeExpansion,
} from "@pier/ui/file/tree-expansion-persist.ts";

const STORAGE_PREFIX = "pier.files.tree.expansion.v1:";

function storageKey(projectRoot: string): string {
  return STORAGE_PREFIX.concat(projectRoot);
}

export function readFilesTreeExpansion(projectRoot: string): unknown {
  return readTreeExpansion(storageKey(projectRoot));
}

export function writeFilesTreeExpansion(
  projectRoot: string,
  authority: TreeExpansionAuthority
): void {
  writeTreeExpansion(storageKey(projectRoot), authority);
}

export function bindFilesTreeExpansionPersistence(
  projectRoot: string,
  authority: TreeExpansionAuthority
): () => void {
  return bindTreeExpansionPersistence(storageKey(projectRoot), authority);
}

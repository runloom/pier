/**
 * 为 WorktreeItem 附加 canonicalPath + WorktreeRef（W4-S1）。
 */
import { resolve } from "node:path";
import { buildWorktreeRef } from "@shared/contracts/local-control/worktree-ref.ts";
import type { WorktreeItem } from "@shared/contracts/worktree.ts";
import type { WorktreeIncarnationStore } from "./incarnation-store.ts";

function samePath(a: string, b: string): boolean {
  return resolve(a) === resolve(b);
}

export async function attachWorktreeRefs(args: {
  mainPath: string;
  items: readonly WorktreeItem[];
  store: WorktreeIncarnationStore;
  mode: "ensure" | "mint";
  mintPath?: string | undefined;
  realpath?: (path: string) => Promise<string>;
}): Promise<WorktreeItem[]> {
  const {
    mainPath,
    items,
    store,
    mode,
    mintPath,
    realpath = async (p) => resolve(p),
  } = args;
  const mainKey = await realpath(mainPath);
  const mintKey = mintPath ? await realpath(mintPath) : undefined;
  const out: WorktreeItem[] = [];
  for (const item of items) {
    const pathKey = await realpath(item.path);
    const shouldMint =
      mode === "mint" && mintKey !== undefined && samePath(pathKey, mintKey);
    const incarnationId = shouldMint
      ? await store.mint(pathKey)
      : await store.ensure(pathKey);
    const worktreeRef = buildWorktreeRef({
      path: pathKey,
      gitRoot: mainKey,
      branch: item.branch,
      incarnationId,
    });
    out.push({
      ...item,
      path: pathKey,
      canonicalPath: pathKey,
      worktreeRef,
    });
  }
  return out;
}

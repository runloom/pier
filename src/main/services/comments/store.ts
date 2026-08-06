/**
 * 评论 per-worktree 持久化（设计文档 §5）。
 *
 * - 文件布局：`{userData}/comments/<hash>.json`，hash = contextId 的 16 位 hex
 *   （contextId = `ctx:<hash>`，文件名去掉 `ctx:` 前缀，跨平台安全）。
 * - 每个 worktree 一个 versionedJsonStore（v1，迁移链空）：init 读磁盘 + schema
 *   校验，mutate 改 + 500ms debounced flush，clear 删文件。
 * - listProjects 扫目录 + 逐文件读，返回 listing（worktreeKey + 计数 + 时间）。
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type CommentProjectListing,
  type CommentProjectStore,
  commentProjectStoreSchema,
} from "@shared/contracts/comments/index.ts";
import type { DebouncedJsonStore } from "../../state/debounced-store.ts";
import { versionedJsonStore } from "../../state/versioned-store.ts";
import { contextIdFor } from "./identity.ts";

const COMMENTS_SUBDIR = "comments";
const JSON_SUFFIX = ".json";

export function commentsDirPath(userDataDir: string): string {
  return join(userDataDir, COMMENTS_SUBDIR);
}

/** worktreeKey → 文件名：contextId 的 hash 部分（去掉 `ctx:` 前缀）。 */
function hashForWorktreeKey(worktreeKey: string): string {
  return contextIdFor(worktreeKey).slice("ctx:".length);
}

export function commentStoreFilePath(
  worktreeKey: string,
  userDataDir: string
): string {
  return join(
    commentsDirPath(userDataDir),
    `${hashForWorktreeKey(worktreeKey)}${JSON_SUFFIX}`
  );
}

/** 评论存储 v1 默认值：空线程，lastReadAt=0（从未读）。 */
function defaultStore(worktreeKey: string): CommentProjectStore {
  return {
    version: 1,
    worktreeKey,
    threads: [],
    readState: { lastReadAt: 0 },
  };
}

/**
 * 创建 per-worktree 评论 store（未 init）。调用方需 await store.init()。
 * v1 迁移链空；文件损坏 / schema 失败 → versionedJsonStore 备份 + 回退默认。
 */
export function createCommentProjectStore(
  worktreeKey: string,
  userDataDir: string
): DebouncedJsonStore<CommentProjectStore> {
  return versionedJsonStore<CommentProjectStore>({
    currentVersion: 1,
    debounceMs: 500,
    defaults: defaultStore(worktreeKey),
    filePath: commentStoreFilePath(worktreeKey, userDataDir),
    migrations: [],
    schema: commentProjectStoreSchema,
  });
}

function listingFromStore(store: CommentProjectStore): CommentProjectListing {
  const updatedAt = store.threads.reduce(
    (max, thread) => Math.max(max, thread.updatedAt),
    0
  );
  return {
    worktreeKey: store.worktreeKey,
    threadCount: store.threads.length,
    openCount: store.threads.filter((thread) => thread.state === "open").length,
    ...(updatedAt > 0 ? { updatedAt } : {}),
  };
}

/**
 * 扫描 comments 目录，返回已知项目清单（设计文档 §5：listProjects）。
 *
 * 逐文件读 + commentProjectStoreSchema.parse；损坏文件跳过（不影响其它项目）。
 * 不缓存——listProjects 是低频操作（清空项目入口 / 孤儿回收）。
 */
export async function listCommentProjectFiles(
  userDataDir: string
): Promise<CommentProjectListing[]> {
  const dir = commentsDirPath(userDataDir);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const listings: CommentProjectListing[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(JSON_SUFFIX)) {
      continue;
    }
    const filePath = join(dir, entry);
    try {
      const raw = await readFile(filePath, "utf-8");
      const parsed = commentProjectStoreSchema.parse(JSON.parse(raw));
      listings.push(listingFromStore(parsed));
    } catch {
      // 损坏文件跳过；不删除（数据安全优先，设计文档 §5 孤儿策略）
    }
  }
  return listings;
}

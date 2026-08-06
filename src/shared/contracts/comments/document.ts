import { z } from "zod";
import { type commentProjectStoreSchema, commentThreadSchema } from "./base.ts";
import {
  commentReadStateSchema,
  commentTimestampSchema,
} from "./primitives.ts";

/**
 * 单项目评论快照（设计文档 §5、§6）。
 *
 * - comments.list 命令的返回值（懒加载触发点）。
 * - pier://comments:changed 广播载荷：main 发完整快照，renderer 按
 *   worktreeKey 路由到对应项目镜像（评论 v1 量级小，全量快照可接受）。
 * - seq 是 per-project 单调递增序号，镜像 store 乱序守卫
 *   （对齐 notification-center snapshot seq）。
 *
 * 与 commentProjectStoreSchema 的区别：store 是磁盘格式（含 version），
 * snapshot 是线协议（去掉 version，加 seq）。threads 与 readState 共享。
 */
export const commentProjectSnapshotSchema = z.strictObject({
  worktreeKey: z.string().min(1).max(65_536),
  threads: z.array(commentThreadSchema),
  readState: commentReadStateSchema,
  seq: z.number().int().nonnegative(),
});
export type CommentProjectSnapshot = z.infer<
  typeof commentProjectSnapshotSchema
>;

/**
 * 已知项目清单条目（comments.listProjects 返回）。
 *
 * 不返回全部 threads，只读 worktreeKey + 计数 + 时间戳，用于
 * 「清空某项目评论」入口与孤儿回收（设计文档 §5）。openCount 是未解决
 * 线程数，方便调用方展示工作量而无需拉全量。
 */
export const commentProjectListingSchema = z.strictObject({
  worktreeKey: z.string().min(1).max(65_536),
  threadCount: z.number().int().nonnegative(),
  openCount: z.number().int().nonnegative(),
  updatedAt: commentTimestampSchema.optional(),
});
export type CommentProjectListing = z.infer<typeof commentProjectListingSchema>;

/** 从磁盘 store 派生 snapshot（main 侧使用）。 */
export function projectStoreToSnapshot(
  store: z.infer<typeof commentProjectStoreSchema>,
  seq: number
): CommentProjectSnapshot {
  return {
    worktreeKey: store.worktreeKey,
    threads: store.threads,
    readState: store.readState,
    seq,
  };
}

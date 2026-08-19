/**
 * WorktreeRef：CLI 定位用身份（W4-S1）。
 * 不承载文件/Git 内容；同路径重建必须更换 incarnationId。
 *
 * 本文件会进入 renderer（命令 schema → 物料 Host API 目录），禁止 import Node
 * builtins。路径规范化只在 main（`attachWorktreeRefs` 的 realpath）完成后再
 * 调用 `buildWorktreeRef`。
 */
import { z } from "zod";

const nonEmpty = z.string().min(1);

export const worktreeRefSchema = z
  .object({
    /** 稳定主键：绝对路径语义，与 PanelContext.worktreeKey 同源 */
    worktreeKey: nonEmpty,
    /** 展示/定位用绝对路径（通常与 worktreeKey 相同） */
    rootPath: nonEmpty,
    /** 主仓库 git root（linked worktree 时与 rootPath 不同） */
    gitRoot: nonEmpty.optional(),
    branch: nonEmpty.nullable().optional(),
    /**
     * 代际身份：同路径删除再建必须变。
     * 调用方不得跨 incarnation 复用旧定位。
     */
    incarnationId: nonEmpty,
  })
  .strict();

export type WorktreeRef = z.infer<typeof worktreeRefSchema>;

export function buildWorktreeRef(args: {
  path: string;
  gitRoot?: string | undefined;
  branch?: string | null | undefined;
  incarnationId: string;
}): WorktreeRef {
  const rootPath = args.path;
  return {
    worktreeKey: rootPath,
    rootPath,
    incarnationId: args.incarnationId,
    ...(args.gitRoot ? { gitRoot: args.gitRoot } : {}),
    ...(args.branch === undefined ? {} : { branch: args.branch }),
  };
}

export function worktreeRefsEqual(a: WorktreeRef, b: WorktreeRef): boolean {
  return (
    a.worktreeKey === b.worktreeKey &&
    a.incarnationId === b.incarnationId &&
    a.rootPath === b.rootPath
  );
}

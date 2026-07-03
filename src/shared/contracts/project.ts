import { z } from "zod";

/**
 * Project — 项目实体（spec §4.2）。
 *
 * `id` 由 `crypto.randomUUID()` 生成, 跨会话稳定：panel-context / task
 * spawn / run.list 命令契约里以 `projectId` 引用同一项目, 避免绑定到
 * 易变的 filesystem 路径。
 * `rootPath` 是 gitRoot(realpath) 或 openedPath 兜底——项目内文件读取的锚点。
 * `name` 派生自 package.json / deno.json / Cargo.toml [package].name /
 * basename(rootPath), 详见 project-store.deriveProjectName。
 */
export const projectSchema = z
  .object({
    id: z.string().uuid(),
    rootPath: z.string().min(1),
    name: z.string().min(1),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();
export type Project = z.infer<typeof projectSchema>;

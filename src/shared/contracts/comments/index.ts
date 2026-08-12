/**
 * 统一评论能力契约（设计文档 2026-08-04-comments-data-model-design.md）。
 *
 * 分层（对齐 git-review/ 四文件拆分）：
 * - primitives：原子 schema（id / 时间戳 / 作者 / target kind 枚举 / 失败 / 阅读状态）
 * - base：target / thread / project store + 身份工具
 * - document：读产物（项目快照 + 项目清单）
 * - operations：CRUD 命令 request / result schema + commentsCommandSchemas
 *
 * main 侧 CommentsService 是唯一写入方；renderer 镜像 store 只读快照；
 * 插件经 RendererPluginContext.comments 门面读写。
 * schema 已注册 git-diff / git-file / markdown / canvas；code 仍仅在 kind 枚举占位。
 */

export * from "./base.ts";
export * from "./document.ts";
export * from "./operations.ts";
export * from "./primitives.ts";

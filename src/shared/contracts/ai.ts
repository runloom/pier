/**
 * AI 服务契约:main 进程复用本机已安装的 CLI agent(claude/codex/gemini 等)
 * 做一次性文本生成,renderer/插件只发任务级命令。
 * 结果统一用 status 区分成功/不可用,失败不抛异常 —— 调用方可静默降级。
 */
import { z } from "zod";
import { agentKindSchema } from "./agent.ts";

export const aiStatusResultSchema = z.object({
  /** 解析到的可用 agent;null 表示没有已安装且支持一次性调用的 agent。 */
  agent: agentKindSchema.nullable(),
  configured: z.boolean(),
  /** agent 展示名(如 "Claude"),未解析到时为空串。 */
  label: z.string(),
});
export type AiStatusResult = z.infer<typeof aiStatusResultSchema>;

export const aiSuggestBranchRequestSchema = z.object({
  text: z.string().min(1).max(2000),
});
export type AiSuggestBranchRequest = z.infer<
  typeof aiSuggestBranchRequestSchema
>;

export const aiSuggestBranchFailureReasonSchema = z.enum([
  "not_configured",
  "timeout",
  "request_failed",
  "invalid_response",
]);
export type AiSuggestBranchFailureReason = z.infer<
  typeof aiSuggestBranchFailureReasonSchema
>;

export const aiSuggestBranchResultSchema = z.discriminatedUnion("status", [
  z.object({
    /** 规整后的英文 slug(小写、连字符分隔、ASCII),不含 branch prefix。 */
    slug: z.string().min(1),
    status: z.literal("ok"),
  }),
  z.object({
    message: z.string(),
    reason: aiSuggestBranchFailureReasonSchema,
    status: z.literal("unavailable"),
  }),
]);
export type AiSuggestBranchResult = z.infer<typeof aiSuggestBranchResultSchema>;

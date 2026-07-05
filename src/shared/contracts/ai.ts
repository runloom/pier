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

export const aiGenerateTextRequestSchema = z.object({
  /**
   * 当前项目根路径。main 侧在此 cwd 下运行一次性 agent,以便 agent 自动加载
   * AGENTS.md / CLAUDE.md / GEMINI.md / Cursor rules 等项目级 AI 资产。
   */
  projectRootPath: z.string().min(1).max(4096).optional(),
  prompt: z.string().min(1).max(12_000),
});
export type AiGenerateTextRequest = z.infer<typeof aiGenerateTextRequestSchema>;

export const aiGenerateTextFailureReasonSchema = z.enum([
  "not_configured",
  "timeout",
  "request_failed",
]);
export type AiGenerateTextFailureReason = z.infer<
  typeof aiGenerateTextFailureReasonSchema
>;

export const aiGenerateTextResultSchema = z.discriminatedUnion("status", [
  z.object({
    text: z.string(),
    status: z.literal("ok"),
  }),
  z.object({
    message: z.string(),
    reason: aiGenerateTextFailureReasonSchema,
    status: z.literal("unavailable"),
  }),
]);
export type AiGenerateTextResult = z.infer<typeof aiGenerateTextResultSchema>;

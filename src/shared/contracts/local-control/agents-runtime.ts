/**
 * W3 持久运行控制：start / turn / screen / wait / watch / stop 契约。
 * screen 仅当前 viewport；turn 只 accepted；无 transcript/history。
 */
import { z } from "zod";
import { runtimeRefSchema } from "./runtime-ref.ts";

const nonEmpty = z.string().min(1);

/** screen 默认有界：行/字节上限（单一来源）。 */
export const AGENTS_SCREEN_DEFAULT_MAX_LINES = 200;
export const AGENTS_SCREEN_DEFAULT_MAX_BYTES = 65_536;
export const AGENTS_SCREEN_HARD_MAX_BYTES = 1_048_576;

// --- start ---

export const agentsStartParamsSchema = z
  .object({
    agentId: nonEmpty,
    cwd: nonEmpty.optional(),
    worktreeKey: nonEmpty.optional(),
    incarnationId: nonEmpty.optional(),
    windowId: nonEmpty.optional(),
  })
  .strict();

export type AgentsStartParams = z.infer<typeof agentsStartParamsSchema>;

export const agentsStartResultSchema = z
  .object({
    runtime: runtimeRefSchema,
    agentId: nonEmpty,
    agentRef: nonEmpty.optional(),
    panelId: nonEmpty,
    windowId: nonEmpty,
    cwd: nonEmpty.optional(),
    worktreeKey: nonEmpty.optional(),
    incarnationId: nonEmpty.optional(),
    /** 定位用绝对路径；非文件内容。 */
    canonicalPath: nonEmpty.optional(),
  })
  .strict();

export type AgentsStartResult = z.infer<typeof agentsStartResultSchema>;

// --- turn ---

export const agentsTurnParamsSchema = z
  .object({
    bootId: nonEmpty,
    runtimeId: nonEmpty,
    generation: z.number().int().nonnegative(),
    /** 一轮输入；协议层可传，不进 receipt 明文日志。 */
    text: z.string().min(1).max(AGENTS_SCREEN_HARD_MAX_BYTES),
  })
  .strict();

export type AgentsTurnParams = z.infer<typeof agentsTurnParamsSchema>;

export const agentsTurnResultSchema = z
  .object({
    accepted: z.literal(true),
    runtime: runtimeRefSchema,
  })
  .strict();

export type AgentsTurnResult = z.infer<typeof agentsTurnResultSchema>;

// --- screen ---

export const agentsScreenParamsSchema = z
  .object({
    bootId: nonEmpty,
    runtimeId: nonEmpty,
    generation: z.number().int().nonnegative(),
    maxLines: z
      .number()
      .int()
      .positive()
      .max(2000)
      .optional()
      .default(AGENTS_SCREEN_DEFAULT_MAX_LINES),
    maxBytes: z
      .number()
      .int()
      .positive()
      .max(AGENTS_SCREEN_HARD_MAX_BYTES)
      .optional()
      .default(AGENTS_SCREEN_DEFAULT_MAX_BYTES),
  })
  .strict();

export type AgentsScreenParams = z.infer<typeof agentsScreenParamsSchema>;

export const agentsScreenPayloadSchema = z
  .object({
    text: z.string(),
    capturedAt: z.number().int().nonnegative(),
    rows: z.number().int().nonnegative(),
    cols: z.number().int().nonnegative(),
    truncated: z.boolean(),
    maxLines: z.number().int().positive(),
    maxBytes: z.number().int().positive(),
  })
  .strict()
  .refine(
    (value) =>
      !("scrollback" in value || "history" in value || "cursor" in value),
    { message: "screen must not carry scrollback/history/content cursor" }
  );

export type AgentsScreenPayload = z.infer<typeof agentsScreenPayloadSchema>;

export const agentsScreenResultSchema = z
  .object({
    screen: agentsScreenPayloadSchema,
    runtime: runtimeRefSchema,
    cwd: nonEmpty.optional(),
    worktreeKey: nonEmpty.optional(),
    incarnationId: nonEmpty.optional(),
    /** 定位用绝对路径提示；非文件内容。 */
    canonicalPath: nonEmpty.optional(),
  })
  .strict();

export type AgentsScreenResult = z.infer<typeof agentsScreenResultSchema>;

// --- wait ---

export const agentsWaitUntilSchema = z.enum([
  "ready",
  "waiting",
  "exited",
  "attention",
]);

export type AgentsWaitUntil = z.infer<typeof agentsWaitUntilSchema>;

export const agentsWaitParamsSchema = z
  .object({
    bootId: nonEmpty,
    runtimeId: nonEmpty,
    generation: z.number().int().nonnegative(),
    until: agentsWaitUntilSchema,
    timeoutMs: z.number().int().positive().max(3_600_000).optional(),
  })
  .strict();

export type AgentsWaitParams = z.infer<typeof agentsWaitParamsSchema>;

export const agentsWaitResultSchema = z
  .object({
    until: agentsWaitUntilSchema,
    reached: z.boolean(),
    fact: nonEmpty.optional(),
    runtime: runtimeRefSchema,
    /** 协议 cancel / AbortSignal 中止；非观察超时 */
    cancelled: z.boolean().optional(),
  })
  .strict();

export type AgentsWaitResult = z.infer<typeof agentsWaitResultSchema>;

// --- watch（运行事实流，≠ 工作完成）---

export const agentsWatchParamsSchema = z
  .object({
    bootId: nonEmpty,
    runtimeId: nonEmpty,
    generation: z.number().int().nonnegative(),
    /** 总观察窗口；默认 30s */
    timeoutMs: z.number().int().positive().max(3_600_000).optional(),
    /** 轮询间隔；默认 100ms */
    pollMs: z.number().int().positive().max(5000).optional(),
  })
  .strict();

export type AgentsWatchParams = z.infer<typeof agentsWatchParamsSchema>;

export const agentsWatchSampleSchema = z
  .object({
    fact: nonEmpty,
    ts: z.number().int().nonnegative(),
    runtime: runtimeRefSchema,
  })
  .strict();

export type AgentsWatchSample = z.infer<typeof agentsWatchSampleSchema>;

export const agentsWatchResultSchema = z
  .object({
    ended: z.literal(true),
    reason: z.enum(["timeout", "cancelled", "exited", "gone"]),
    samples: z.array(agentsWatchSampleSchema),
    runtime: runtimeRefSchema,
  })
  .strict();

export type AgentsWatchResult = z.infer<typeof agentsWatchResultSchema>;

// --- interrupt / terminate / focus ---

export const agentsRuntimeTargetParamsSchema = z
  .object({
    bootId: nonEmpty,
    runtimeId: nonEmpty,
    generation: z.number().int().nonnegative(),
  })
  .strict();

export type AgentsRuntimeTargetParams = z.infer<
  typeof agentsRuntimeTargetParamsSchema
>;

export const agentsInterruptResultSchema = z
  .object({
    interrupted: z.literal(true),
    runtime: runtimeRefSchema,
  })
  .strict();

export const agentsTerminateResultSchema = z
  .object({
    terminated: z.literal(true),
    runtime: runtimeRefSchema,
  })
  .strict();

export const agentsFocusResultSchema = z
  .object({
    panelId: nonEmpty,
    windowId: nonEmpty,
    runtime: runtimeRefSchema,
  })
  .strict();

import { z } from "zod";
import { type AgentKind, agentKindSchema } from "./agent.ts";

/**
 * hook 事件（v1）——三 kind discriminated union（spec §4.4）。
 *
 * emit 脚本 dispatch：`$1` 位置参数选一 kind, 剩余参数填入对应 payload。
 * 两条 producer 只写 `agentEvent`（现役 Path B）；`commandStart` / `commandFinished`
 * kind 是 forward-compat 占位——未来非 ghostty native shell 需要经 JSONL 上报
 * 命令生命周期时启用。JsonlObserver 按 kind 分派到对应回调, aggregator 独立
 * 消费。
 *
 * 字段顺序（emit 脚本保序）：v → kind → ts → panelId → windowId → pid → payload。
 * panelId 跨窗口不唯一（见 terminal-panel-id.ts），windowId 必带，
 * 二者组成会话 key `${windowId}::${panelId}`。
 */
const baseHookIdentityFields = {
  ts: z.number().optional(),
  panelId: z.string().min(1).max(128),
  windowId: z.string().min(1).max(32),
  pid: z.number().optional(),
};

const v1BaseHookFields = { ...baseHookIdentityFields, v: z.literal(1) };

const commandStartEventSchema = z
  .object({
    kind: z.literal("commandStart"),
    ...v1BaseHookFields,
    commandLine: z.string().max(4096),
  })
  .strict();
export type CommandStartHookEvent = z.infer<typeof commandStartEventSchema>;

const commandFinishedEventSchema = z
  .object({
    kind: z.literal("commandFinished"),
    ...v1BaseHookFields,
    exitCode: z.number().int(),
  })
  .strict();
export type CommandFinishedHookEvent = z.infer<
  typeof commandFinishedEventSchema
>;

const agentEventPayloadV1Schema = z
  .object({
    kind: z.literal("agentEvent"),
    ...v1BaseHookFields,
    agent: agentKindSchema,
    event: z.string().min(1).max(64),
    metadataBase64: z.string().max(16_384).optional(),
    agentInstanceId: z.string().max(128).optional(),
    agentType: z.string().max(128).optional(),
    sessionId: z.string().max(128).optional(),
    toolName: z.string().max(256).optional(),
    toolUseId: z.string().max(128).optional(),
    transcriptPath: z.string().max(8192).optional(),
    turnId: z.string().max(128).optional(),
  })
  .strict();

const agentEventPayloadV2Schema = z
  .object({
    kind: z.literal("agentEvent"),
    ...baseHookIdentityFields,
    v: z.literal(2),
    agent: agentKindSchema,
    /** v1 兼容的规范事件词汇；native 字段保留原生事实供适配和诊断。 */
    event: z.string().min(1).max(64),
    nativeEvent: z.string().min(1).max(128),
    nativeState: z.string().min(1).max(64).optional(),
    actorHint: z.enum(["main", "subagent"]).optional(),
    parentSessionId: z.string().max(128).optional(),
    metadataBase64: z.string().max(16_384).optional(),
    agentInstanceId: z.string().max(128).optional(),
    agentType: z.string().max(128).optional(),
    sessionId: z.string().max(128).optional(),
    toolName: z.string().max(256).optional(),
    toolUseId: z.string().max(128).optional(),
    transcriptPath: z.string().max(8192).optional(),
    turnId: z.string().max(128).optional(),
  })
  .strict();

export type AgentHookEventPayloadV1 = z.infer<typeof agentEventPayloadV1Schema>;
export type AgentHookEventPayload =
  | AgentHookEventPayloadV1
  | z.infer<typeof agentEventPayloadV2Schema>;

export const agentHookEventSchema = z.union([
  commandStartEventSchema,
  commandFinishedEventSchema,
  agentEventPayloadV1Schema,
  agentEventPayloadV2Schema,
]);
export type AgentHookEvent = z.infer<typeof agentHookEventSchema>;

/** tab icon id 的 agent 命名空间前缀（renderer tab 头按此识别并渲染 AgentIcon）。 */
const AGENT_TAB_ICON_PREFIX = "agent:";

export function agentTabIconId(agentId: AgentKind): string {
  return `${AGENT_TAB_ICON_PREFIX}${agentId}`;
}

export function agentKindFromTabIconId(
  iconId: string | undefined
): AgentKind | null {
  if (!iconId?.startsWith(AGENT_TAB_ICON_PREFIX)) {
    return null;
  }
  const parsed = agentKindSchema.safeParse(
    iconId.slice(AGENT_TAB_ICON_PREFIX.length)
  );
  return parsed.success ? parsed.data : null;
}

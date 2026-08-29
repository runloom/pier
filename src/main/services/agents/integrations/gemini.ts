import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentHookEventPayloadV3 } from "@shared/contracts/agent/session.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import {
  createNestedJsonIntegration,
  type NestedJsonIntegrationSpec,
  pierHookCommandV3WithStdin,
  preflightPierNestedHooksInstall,
  transformJsonConfig,
  withoutPierNestedHooks,
  withPierNestedHooks,
} from "./shared.ts";

type StandardV3Event = Exclude<
  AgentHookEventPayloadV3["event"],
  "InteractionRequested" | "InteractionResolved"
>;

function geminiStandardCommand(
  event: StandardV3Event,
  nativeEvent: string
): (agentId: AgentKind) => string {
  return (agentId) =>
    pierHookCommandV3WithStdin({ agentId, event, nativeEvent });
}

/**
 * Gemini CLI hook 事件 → pier 事件名。
 * 依据 google-gemini/gemini-cli packages/core/src/hooks/types.ts：
 * Notification.ToolPermission 没有稳定请求 ID 或结果 hook；ask_user 的
 * BeforeTool 发生在权限判定之前，拒绝、取消、异常可不触发 AfterTool。
 * 两条链路均不能覆盖完整等待闭环，因此不发射交互事件；ask_user 只报告
 * ToolStart / ToolComplete，聚合器也不按工具名升 waiting。
 *
 * 已知有界 false-busy（2026-08-29 审计留档）：deny/Esc 中断路径可缺
 * AfterTool 且中断不触发 AfterAgent（本机 0.56.0 bundle：abort 直接
 * return，fireAfterAgentHookSafe 不执行）——被拒/被中断工具的匿名计数
 * 悬挂到下一次 PromptSubmit 或 TTL。上游无 turn/tool id（结构性无
 * 抢占面），矩阵 interrupted: unsupported 如实声明，接受该取舍。
 *
 * subagent 风险备忘：AfterAgent 仅在最外层调用（activeCalls===1）时触发,
 * 且按 prompt_id 去重（client.ts fireBeforeAgentHookSafe / fireAfterAgentHookSafe）。
 * 上游无独立 SubagentStart/SubagentStop 事件。若未来 subagent 使用独立
 * GeminiClient 实例, 则各自触发 BeforeAgent/AfterAgent 且无法区分主/子——
 * 上游 issue #17760 追踪 subagent hook 可配置性但尚未完成, 届时需重审本表。
 *
 * ⚠️ 单位陷阱：Gemini 把 hook 配置里的 `timeout` 字段解释为【毫秒】,
 * 不是 Claude/Grok 那种秒。工厂写入 JSON 的字段名固定为 `timeout`,
 * 取值来自本 spec 的 `timeoutSeconds`（字段名沿用 shared.ts 类型定义,
 * 不可在此处更名）。为了让 Gemini 侧真正获得 10 秒超时, 这里必须传
 * timeoutSeconds: 10_000（即 10000 毫秒), 而不是 10。
 * 如果日后有人把这个数值"修正"回 10——那会让 Gemini 侧的实际超时
 * 变成 10 毫秒, 几乎必定导致 pier hook 上报静默失败。
 */
const GEMINI_SPEC: NestedJsonIntegrationSpec = {
  agentId: "gemini",
  runtime: { stopAuthority: "advisory" },
  configPath: () => join(homedir(), ".gemini", "settings.json"),
  events: [
    {
      buildCommand: geminiStandardCommand("SessionStart", "SessionStart"),
      nativeEvent: "SessionStart",
      pierEvent: "SessionStart",
    },
    {
      buildCommand: geminiStandardCommand("SessionEnd", "SessionEnd"),
      nativeEvent: "SessionEnd",
      pierEvent: "SessionEnd",
    },
    {
      buildCommand: geminiStandardCommand("PromptSubmit", "BeforeAgent"),
      nativeEvent: "BeforeAgent",
      pierEvent: "PromptSubmit",
    },
    {
      buildCommand: geminiStandardCommand("Stop", "AfterAgent"),
      nativeEvent: "AfterAgent",
      pierEvent: "Stop",
    },
    {
      buildCommand: geminiStandardCommand("processing", "PreCompress"),
      nativeEvent: "PreCompress",
      pierEvent: "processing",
    },
    {
      buildCommand: geminiStandardCommand("ToolStart", "BeforeTool"),
      nativeEvent: "BeforeTool",
      pierEvent: "ToolStart",
    },
    {
      buildCommand: geminiStandardCommand("ToolComplete", "AfterTool"),
      nativeEvent: "AfterTool",
      pierEvent: "ToolComplete",
    },
  ],
  timeoutSeconds: 10_000,
};

export const GEMINI_HOOK_EVENTS = GEMINI_SPEC.events;

export const geminiIntegration = createNestedJsonIntegration(GEMINI_SPEC);

/** 兼容导出（沿袭 claude 集成的既有纪律；语义与工厂一致）。 */
export function withPierGeminiHooks(
  settings: Record<string, unknown>
): Record<string, unknown> {
  return withPierNestedHooks(settings, GEMINI_SPEC);
}

export function withoutPierGeminiHooks(
  settings: Record<string, unknown>
): Record<string, unknown> {
  return withoutPierNestedHooks(settings);
}

export async function installGeminiHooks(
  settingsPath: string = GEMINI_SPEC.configPath()
): Promise<void> {
  await transformJsonConfig(
    settingsPath,
    (s) => {
      if (!preflightPierNestedHooksInstall(s, GEMINI_SPEC)) {
        return s;
      }
      return withPierGeminiHooks(withoutPierGeminiHooks(s));
    },
    "gemini"
  );
}

export async function uninstallGeminiHooks(
  settingsPath: string = GEMINI_SPEC.configPath()
): Promise<void> {
  await transformJsonConfig(settingsPath, withoutPierGeminiHooks, "gemini");
}

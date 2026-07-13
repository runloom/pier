import { homedir } from "node:os";
import { join } from "node:path";
import {
  createNestedJsonIntegration,
  type NestedJsonIntegrationSpec,
  transformJsonConfig,
  withoutPierNestedHooks,
  withPierNestedHooks,
} from "./shared.ts";

/**
 * Gemini CLI hook 事件 → pier 事件名。
 * 依据 google-gemini/gemini-cli packages/core/src/hooks/types.ts：
 * HookEventName 含 Notification, NotificationType 当前仅 ToolPermission
 * （工具权限弹窗提示）——observability-only, 不能 grant/block, 但足以
 * 驱动 pier 的 "waiting" 状态, 映 PermissionRequest。
 * （此前注释断言"无权限确认类 hook"已过时——上游 docs/hooks/reference.md
 * §Notification 明确该事件在 Tool Permissions 系统提示时触发。）
 * 工具事件（BeforeTool/AfterTool）matcher 用空字符串 ""（Gemini 官方
 * 事件表约定, 区别于 grok 的 "*"）。
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
  capability: "full",
  runtime: { stopAuthority: "advisory" },
  configPath: () => join(homedir(), ".gemini", "settings.json"),
  events: [
    { nativeEvent: "SessionStart", pierEvent: "SessionStart" },
    { nativeEvent: "SessionEnd", pierEvent: "SessionEnd" },
    { nativeEvent: "BeforeAgent", pierEvent: "PromptSubmit" },
    { nativeEvent: "AfterAgent", pierEvent: "Stop" },
    { nativeEvent: "Notification", pierEvent: "PermissionRequest" },
    { nativeEvent: "PreCompress", pierEvent: "processing" },
    { matcher: "", nativeEvent: "BeforeTool", pierEvent: "ToolStart" },
    { matcher: "", nativeEvent: "AfterTool", pierEvent: "ToolComplete" },
  ],
  timeoutSeconds: 10_000,
};

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
    (s) => withPierGeminiHooks(withoutPierGeminiHooks(s)),
    "gemini"
  );
}

export async function uninstallGeminiHooks(
  settingsPath: string = GEMINI_SPEC.configPath()
): Promise<void> {
  await transformJsonConfig(settingsPath, withoutPierGeminiHooks, "gemini");
}

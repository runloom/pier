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
 * 依据 Gemini CLI hooks 文档：无权限确认类 hook（PermissionRequest 无
 * 对应原生事件）——Gemini 的授权确认在 hook 体系之外, 因此 pier 的
 * "waiting" 状态经由 hook 路径不可达（同 grok 集成的取舍）。
 * 工具事件（BeforeTool/AfterTool）matcher 用空字符串 ""（Gemini 官方
 * 事件表约定, 区别于 grok 的 "*"）。
 *
 * ⚠️ 单位陷阱：Gemini 把 hook 配置里的 `timeout` 字段解释为【毫秒】,
 * 不是 Claude/Grok 那种秒。工厂写入 JSON 的字段名固定为 `timeout`,
 * 取值来自本 spec 的 `timeoutSeconds`（字段名沿用 shared.ts 类型定义,
 * 不可在此处更名）。为了让 Gemini 侧真正获得 10 秒超时, 这里必须传
 * timeoutSeconds: 10_000（即 10000 毫秒), 而不是 10。
 * 参考：orca 的 MANAGED_HOOK_TIMEOUT_MILLISECONDS = 10000。
 * 如果日后有人把这个数值"修正"回 10——那会让 Gemini 侧的实际超时
 * 变成 10 毫秒, 几乎必定导致 pier hook 上报静默失败。
 */
const GEMINI_SPEC: NestedJsonIntegrationSpec = {
  agentId: "gemini",
  capability: "full",
  configPath: () => join(homedir(), ".gemini", "settings.json"),
  events: [
    { nativeEvent: "SessionStart", pierEvent: "SessionStart" },
    { nativeEvent: "SessionEnd", pierEvent: "SessionEnd" },
    { nativeEvent: "BeforeAgent", pierEvent: "PromptSubmit" },
    { nativeEvent: "AfterAgent", pierEvent: "Stop" },
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

import { existsSync } from "node:fs";
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
 * `$CODEX_HOME` 解析（未设置时默认 `~/.codex`）：
 * - 未设置/空 → `~/.codex`。
 * - 以 `~` 开头 → 展开为 homedir()（仅处理开头, shell tilde-expansion 语义）。
 * - 其余（绝对/相对路径）→ 原样使用。
 */
export function codexHomeDir(): string {
  const envHome = process.env.CODEX_HOME;
  if (!envHome) {
    return join(homedir(), ".codex");
  }
  if (envHome === "~") {
    return homedir();
  }
  if (envHome.startsWith("~/") || envHome.startsWith("~\\")) {
    return join(homedir(), envHome.slice(2));
  }
  return envHome;
}

const codexConfigPath = () => join(codexHomeDir(), "hooks.json");

/**
 * Codex hook 事件 → pier 事件名。
 *
 * upstream openai/codex 自 PR#13276 起已原生支持 hooks.json（官方文档
 * developers.openai.com/codex/hooks）。现代 codex 会对未信任的 hook 弹出
 * `/hooks` 信任审查警告（见 issue#21639），这是预期 UX，用户首次触发时
 * 需要在 codex 内确认信任该 hooks.json，不代表集成出错。
 *
 * 当前 Codex hook 事件全集（以发布版文档与本机 generated schema 为准）：
 * - session_start.rs → SessionStart
 * - user_prompt_submit.rs → UserPromptSubmit
 * - pre_tool_use.rs → PreToolUse
 * - post_tool_use.rs → PostToolUse
 * - permission_request.rs → PermissionRequest
 * - stop.rs → Stop
 * - compact.rs → PreCompact + PostCompact
 * - subagent_start.rs → SubagentStart
 * - subagent_stop.rs → SubagentStop
 *
 * **补装**：PreCompact/PostCompact 官方源码级存在, 先前版本漏装。
 * 都映射为 processing——避免上下文压缩期间被 30min TTL 误衰减状态。
 *
 * SessionEnd 仍未发布（openai/codex#20603 持续跟踪中）——刻意不装：装了
 * 也是死条目（不会被触发）。Pier 用进程退出时自身的 `command_finished`
 * 驱动状态兜底复位, 覆盖同样的"会话结束"语义转换, 不依赖不存在的 hook。
 *
 * Ev5 / FA `error`：hooks 表无 `StopFailure`（或等价失败 hook）；transcript
 * 对账仅补 `task_complete→TurnCompleted` 与 `turn_aborted→TurnInterrupted`
 * （用户中断 ≠ 出错）。禁止把 `Stop`/`TurnInterrupted` 假装成 `error`。
 * 结论见 `CODEX_FA_ERROR_REACHABILITY`。
 *
 * 所有事件均不写 matcher 字段（工厂默认行为：event.matcher 为
 * undefined 时不写入, 此处所有条目均不传 matcher）。
 */
const CODEX_SPEC: NestedJsonIntegrationSpec = {
  agentId: "codex",
  capability: "full",
  runtime: { stopAuthority: "advisory" },
  configPath: codexConfigPath,
  // 与 claude/gemini/grok 默认 detect（配置文件是否已存在）不同：
  // codex 的 hooks.json 通常尚不存在, 只要 CODEX_HOME 目录存在即视为
  // 已安装 codex, 应正常安装（seed）——readJsonConfig 对缺失文件返回
  // {}, install 会正常创建该文件。
  detect: () => existsSync(codexHomeDir()),
  events: [
    { nativeEvent: "SessionStart", pierEvent: "SessionStart" },
    { nativeEvent: "UserPromptSubmit", pierEvent: "PromptSubmit" },
    { nativeEvent: "PreToolUse", pierEvent: "ToolStart" },
    { nativeEvent: "PostToolUse", pierEvent: "ToolComplete" },
    { nativeEvent: "PermissionRequest", pierEvent: "PermissionRequest" },
    { nativeEvent: "PreCompact", pierEvent: "processing" },
    { nativeEvent: "PostCompact", pierEvent: "processing" },
    { nativeEvent: "SubagentStart", pierEvent: "SubagentStart" },
    { nativeEvent: "SubagentStop", pierEvent: "SubagentStop" },
    { nativeEvent: "Stop", pierEvent: "Stop" },
  ],
};

export const CODEX_HOOK_EVENTS = CODEX_SPEC.events;

/**
 * Ev5 诚实结论：codex hooks + transcript 对账均无原生回合失败 → FA `error`。
 * 证据：发布版 hooks 无 StopFailure；对账只产 TurnCompleted/TurnInterrupted。
 */
export const CODEX_FA_ERROR_REACHABILITY = "unsupported" as const;

export const codexIntegration = createNestedJsonIntegration(CODEX_SPEC);

/** 兼容导出（与 claude.ts 一致的模式；语义与工厂一致）。 */
export function withPierCodexHooks(
  settings: Record<string, unknown>
): Record<string, unknown> {
  return withPierNestedHooks(settings, CODEX_SPEC);
}

export function withoutPierCodexHooks(
  settings: Record<string, unknown>
): Record<string, unknown> {
  return withoutPierNestedHooks(settings);
}

export async function installCodexHooks(
  settingsPath: string = CODEX_SPEC.configPath()
): Promise<void> {
  // 先剔全部 pier 条目再按当前 spec 装, 与工厂 createNestedJsonIntegration
  // 保持一致——清理上一版 spec 装过但本版已移出的遗留。
  await transformJsonConfig(
    settingsPath,
    (s) => withPierCodexHooks(withoutPierCodexHooks(s)),
    "codex"
  );
}

export async function uninstallCodexHooks(
  settingsPath: string = CODEX_SPEC.configPath()
): Promise<void> {
  await transformJsonConfig(settingsPath, withoutPierCodexHooks, "codex");
}

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentKind } from "@shared/contracts/agent.ts";
import {
  commandExistsOnPath,
  isPierHookCommand,
  pierHookCommandWithStdinSessionId,
  transformJsonConfig,
} from "./shared.ts";
import type { AgentHookIntegration } from "./types.ts";

const AGENT_ID: AgentKind = "autohand";

/**
 * autohand（autohandai/code-cli）hook 事件 → pier 事件名。
 * 依据官方文档 github.com/autohandai/code-cli docs/hooks.md：
 * - 配置路径 `~/.autohand/config.json`。
 * - schema 是**扁平数组**（非 Claude 式嵌套 Event→matcher→hooks 三层）：
 *   `hooks.hooks[]`，每条 `{event, command, description?, enabled, timeout,
 *   async?, matcher?, filter?}`。与 createNestedJsonIntegration 工厂的
 *   schema 不兼容, 需自定义读写逻辑（同 goose/kimi 走文本/自定义 JSON
 *   变换路线的先例）。
 * - 事件名为 kebab-case。官方事件全集含大量非状态相关事件（automode:*,
 *   review:*, team-* 等 autohand 特有编排事件）——仅取与 pier 状态语义
 *   相关的子集：
 *     session-start → SessionStart
 *     session-end   → SessionEnd
 *     session-error → error（回合因错误终止, 对齐 claude StopFailure 语义）
 *     pre-prompt    → PromptSubmit
 *     stop          → Stop（官方 stop 与 post-response 互为别名, 取规范名
 *                     "stop"；不重复安装 post-response, 避免同一回合触发
 *                     两次 Stop 上报）
 *     permission-request → PermissionRequest
 *     pre-tool      → ToolStart
 *     post-tool     → ToolComplete
 * - `enabled` 恒写 true（pier 装的 hook 不应被配置关闭）；`async` 不设置
 *   （沿用官方默认 false, 与 pier 其余同步 hook 上报的语义一致）。
 */
const AUTOHAND_HOOK_EVENTS: ReadonlyArray<{
  nativeEvent: string;
  pierEvent: string;
}> = [
  { nativeEvent: "session-start", pierEvent: "SessionStart" },
  { nativeEvent: "session-end", pierEvent: "SessionEnd" },
  { nativeEvent: "session-error", pierEvent: "error" },
  { nativeEvent: "pre-prompt", pierEvent: "PromptSubmit" },
  { nativeEvent: "stop", pierEvent: "Stop" },
  { nativeEvent: "permission-request", pierEvent: "PermissionRequest" },
  { nativeEvent: "pre-tool", pierEvent: "ToolStart" },
  { nativeEvent: "post-tool", pierEvent: "ToolComplete" },
];

const AUTOHAND_HOOK_TIMEOUT_MS = 5000;

interface AutohandHookEntry {
  command: string;
  enabled: boolean;
  event: string;
  timeout: number;
}

function autohandHomeDir(): string {
  return join(homedir(), ".autohand");
}

export function autohandConfigPath(): string {
  return join(autohandHomeDir(), "config.json");
}

export function autohandDetect(): boolean {
  return existsSync(autohandHomeDir()) || commandExistsOnPath("autohand");
}

function hooksSection(
  settings: Record<string, unknown>
): Record<string, unknown> {
  const hooks = settings.hooks;
  return hooks && typeof hooks === "object" && !Array.isArray(hooks)
    ? { ...(hooks as Record<string, unknown>) }
    : {};
}

function hooksArray(section: Record<string, unknown>): AutohandHookEntry[] {
  const arr = section.hooks;
  return Array.isArray(arr) ? (arr as AutohandHookEntry[]) : [];
}

/** 纯函数：注入 pier hook 条目（幂等——先剔旧再加新）。 */
export function withPierAutohandHooks(
  settings: Record<string, unknown>
): Record<string, unknown> {
  const section = hooksSection(settings);
  const kept = hooksArray(section).filter(
    (entry) => !isPierHookCommand(entry?.command)
  );
  const pierEntries: AutohandHookEntry[] = AUTOHAND_HOOK_EVENTS.map(
    (event) => ({
      command: pierHookCommandWithStdinSessionId(
        AGENT_ID,
        event.pierEvent,
        event.nativeEvent
      ),
      enabled: true,
      event: event.nativeEvent,
      timeout: AUTOHAND_HOOK_TIMEOUT_MS,
    })
  );
  return {
    ...settings,
    hooks: {
      ...section,
      enabled: section.enabled ?? true,
      hooks: [...kept, ...pierEntries],
    },
  };
}

/**
 * 纯函数：剔除全部 pier hook 条目。无 pier 条目时原样返回输入引用
 * （启动期关→卸载对齐不得空写用户文件）。
 */
export function withoutPierAutohandHooks(
  settings: Record<string, unknown>
): Record<string, unknown> {
  const section = hooksSection(settings);
  const existing = hooksArray(section);
  const kept = existing.filter((entry) => !isPierHookCommand(entry?.command));
  if (kept.length === existing.length) {
    return settings;
  }
  return {
    ...settings,
    hooks: {
      ...section,
      hooks: kept,
    },
  };
}

export async function installAutohandHooks(
  configPath: string = autohandConfigPath()
): Promise<void> {
  await transformJsonConfig(configPath, withPierAutohandHooks, AGENT_ID);
}

export async function uninstallAutohandHooks(
  configPath: string = autohandConfigPath()
): Promise<void> {
  await transformJsonConfig(configPath, withoutPierAutohandHooks, AGENT_ID);
}

export const autohandIntegration: AgentHookIntegration = {
  capability: "full",
  runtime: { stopAuthority: "advisory" },
  detect: autohandDetect,
  id: AGENT_ID,
  install: () => installAutohandHooks(),
  uninstall: () => uninstallAutohandHooks(),
};

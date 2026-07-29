import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentKind } from "@shared/contracts/agent.ts";
import {
  commandExistsOnPath,
  isPierHookCommand,
  transformJsonConfig,
} from "./shared.ts";
import type { AgentHookIntegration } from "./types.ts";

const AGENT_ID: AgentKind = "crush";

/**
 * 官方 charmbracelet/crush docs/hooks/README.md：hooks 键嵌在主配置文件
 * `~/.config/crush/crush.json` 内（不是独立的 hooks.json 文件——此前版本
 * 用了一个不存在的独立文件路径，已改正）。
 */
const configPath = () => join(homedir(), ".config", "crush", "crush.json");

/**
 * Crush hook 面很小：官方原文明言 "currently supports just one hook"——
 * 只有策略型 `PreToolUse`。它发生在工具执行前，既没有执行完成事实，也可能
 * 阻止或改写工具，因此不能映射为 Pier 五态事件。此前版本装的
 * `tool_call_before`/`tool_call_after` 两个事件名均不存在于官方文档，
 * 已删除。
 *
 * schema：`hooks.PreToolUse` 是一个对象数组
 * `[{name?, matcher?, command, timeout?}]`——每个条目是扁平对象，没有
 * `type` 字段，也没有 claude 家族那种内层 `hooks: [...]` 包装。
 *
 * 当前安装入口只清理历史 Pier 条目；在上游提供观察型生命周期事件前不再写入。
 */
const CRUSH_NATIVE_EVENT = "PreToolUse";

interface CrushHookEntry {
  command: string;
  matcher?: string;
  name?: string;
  timeout?: number;
}

function hooksRecord(
  settings: Record<string, unknown>
): Record<string, unknown> {
  const hooks = settings.hooks;
  if (hooks && typeof hooks === "object" && !Array.isArray(hooks)) {
    return { ...(hooks as Record<string, unknown>) };
  }
  return {};
}

function isPierCrushEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") {
    return false;
  }
  return isPierHookCommand((entry as CrushHookEntry).command);
}

/**
 * 纯函数：安装阶段只剔除历史 Pier 条目，不再向策略 hook 写状态观察命令。
 */
export function withPierCrushHooks(
  settings: Record<string, unknown>
): Record<string, unknown> {
  return withoutPierCrushHooks(settings);
}

/**
 * 纯函数：剔除 `hooks.PreToolUse` 中的 pier 条目，空数组一并删除该键。
 * 无 pier 条目时原样返回输入引用。
 */
export function withoutPierCrushHooks(
  settings: Record<string, unknown>
): Record<string, unknown> {
  const hooks = hooksRecord(settings);
  const current = hooks[CRUSH_NATIVE_EVENT];
  const existing = Array.isArray(current) ? current : [];
  const kept = existing.filter((entry) => !isPierCrushEntry(entry));
  if (kept.length === existing.length) {
    return settings;
  }
  if (kept.length > 0) {
    hooks[CRUSH_NATIVE_EVENT] = kept;
  } else {
    delete hooks[CRUSH_NATIVE_EVENT];
  }
  return { ...settings, hooks };
}

export async function installCrushHooks(
  settingsPath: string = configPath()
): Promise<void> {
  await transformJsonConfig(settingsPath, withPierCrushHooks, AGENT_ID);
}

export async function uninstallCrushHooks(
  settingsPath: string = configPath()
): Promise<void> {
  await transformJsonConfig(settingsPath, withoutPierCrushHooks, AGENT_ID);
}

export const crushIntegration: AgentHookIntegration = {
  detect: () => existsSync(configPath()) || commandExistsOnPath("crush"),
  id: AGENT_ID,
  runtime: {
    emittedMappings: [],
    stopAuthority: "none",
  },
  install: () => installCrushHooks(),
  uninstall: () => uninstallCrushHooks(),
};

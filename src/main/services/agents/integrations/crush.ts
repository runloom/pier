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

const AGENT_ID: AgentKind = "crush";

/**
 * 官方 charmbracelet/crush docs/hooks/README.md：hooks 键嵌在主配置文件
 * `~/.config/crush/crush.json` 内（不是独立的 hooks.json 文件——此前版本
 * 用了一个不存在的独立文件路径，已改正）。
 */
const configPath = () => join(homedir(), ".config", "crush", "crush.json");

/**
 * Crush hook 面很小：官方原文明言 "currently supports just one hook"——
 * 只有 `PreToolUse`（映射 pier 的 ToolStart）。此前版本装的
 * `tool_call_before`/`tool_call_after` 两个事件名均不存在于官方文档，
 * 已删除。
 *
 * schema：`hooks.PreToolUse` 是一个对象数组
 * `[{name?, matcher?, command, timeout?}]`——每个条目是扁平对象，没有
 * `type` 字段，也没有 claude 家族那种内层 `hooks: [...]` 包装。
 *
 * capability 保持 "coarse"（单事件、粗粒度）；参见官方 FUTURE.md 中对
 * 后续扩展更多事件的路线图描述。
 */
const CRUSH_NATIVE_EVENT = "PreToolUse";
const CRUSH_PIER_EVENT = "ToolStart";

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
 * 纯函数：往 `hooks.PreToolUse` 对象数组注入一条 pier 条目（幂等——先剔旧
 * 再加新）。
 */
export function withPierCrushHooks(
  settings: Record<string, unknown>
): Record<string, unknown> {
  const hooks = hooksRecord(settings);
  const current = hooks[CRUSH_NATIVE_EVENT];
  const existing = Array.isArray(current) ? current : [];
  const kept = existing.filter((entry) => !isPierCrushEntry(entry));
  const pierEntry: CrushHookEntry = {
    command: pierHookCommandWithStdinSessionId(
      AGENT_ID,
      CRUSH_PIER_EVENT,
      CRUSH_NATIVE_EVENT
    ),
  };
  hooks[CRUSH_NATIVE_EVENT] = [...kept, pierEntry];
  return { ...settings, hooks };
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Prefer Crush transparent TUI background in Pier so cell paint does not fight
 * the host terminal default (status bar / reserved strip). Only set when unset
 * so an explicit user `false` is preserved.
 */
export function withPierCrushTerminalChrome(
  settings: Record<string, unknown>
): Record<string, unknown> {
  const options = isPlainObject(settings.options)
    ? { ...settings.options }
    : {};
  const tui = isPlainObject(options.tui) ? { ...options.tui } : {};
  if (tui.transparent !== undefined) {
    return settings;
  }
  return {
    ...settings,
    options: {
      ...options,
      tui: {
        ...tui,
        transparent: true,
      },
    },
  };
}

export async function installCrushHooks(
  settingsPath: string = configPath()
): Promise<void> {
  await transformJsonConfig(
    settingsPath,
    (settings) => withPierCrushTerminalChrome(withPierCrushHooks(settings)),
    AGENT_ID
  );
}

export async function uninstallCrushHooks(
  settingsPath: string = configPath()
): Promise<void> {
  await transformJsonConfig(settingsPath, withoutPierCrushHooks, AGENT_ID);
}

export const crushIntegration: AgentHookIntegration = {
  capability: "coarse",
  detect: () => existsSync(configPath()) || commandExistsOnPath("crush"),
  id: AGENT_ID,
  runtime: { stopAuthority: "none" },
  install: () => installCrushHooks(),
  uninstall: () => uninstallCrushHooks(),
};

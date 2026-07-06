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

const AGENT_ID: AgentKind = "cursor";
const TIMEOUT_SECONDS = 10;

const configPath = () => join(homedir(), ".cursor", "hooks.json");

/**
 * Cursor hook 事件 → pier 事件名。Cursor 与 loomdesk 双方事件表取并集后
 * 按 pier 语义映射。beforeShellExecution/beforeMCPExecution 是阻塞审批点
 * → PermissionRequest；afterAgentResponse 近似"仍在处理" → processing
 * （loomdesk running≈processing 的映射）。
 */
const CURSOR_EVENTS: ReadonlyArray<{ nativeEvent: string; pierEvent: string }> =
  [
    { nativeEvent: "sessionStart", pierEvent: "SessionStart" },
    { nativeEvent: "beforeSubmitPrompt", pierEvent: "PromptSubmit" },
    { nativeEvent: "preToolUse", pierEvent: "ToolStart" },
    { nativeEvent: "postToolUse", pierEvent: "ToolComplete" },
    { nativeEvent: "postToolUseFailure", pierEvent: "ToolComplete" },
    { nativeEvent: "beforeShellExecution", pierEvent: "PermissionRequest" },
    { nativeEvent: "beforeMCPExecution", pierEvent: "PermissionRequest" },
    { nativeEvent: "afterShellExecution", pierEvent: "ToolComplete" },
    { nativeEvent: "afterMCPExecution", pierEvent: "ToolComplete" },
    { nativeEvent: "afterAgentResponse", pierEvent: "processing" },
    { nativeEvent: "subagentStart", pierEvent: "SubagentStart" },
    { nativeEvent: "subagentStop", pierEvent: "SubagentStop" },
    { nativeEvent: "stop", pierEvent: "Stop" },
    { nativeEvent: "sessionEnd", pierEvent: "SessionEnd" },
  ];

interface CursorHookEntry {
  command: string;
  timeout?: number;
}

function hooksRecord(
  settings: Record<string, unknown>
): Record<string, unknown[]> {
  const hooks = settings.hooks;
  if (hooks && typeof hooks === "object" && !Array.isArray(hooks)) {
    return { ...(hooks as Record<string, unknown[]>) };
  }
  return {};
}

function isPierCursorEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") {
    return false;
  }
  return isPierHookCommand((entry as CursorHookEntry).command);
}

/**
 * 纯函数：注入 pier hook 条目（幂等——先剔旧再加新）。command 直接在
 * 定义对象上（非嵌套 hooks 数组，与 claude/openclaude 的 schema 不同）。
 * 顶层 version 保留已有值，缺失则写 1。
 */
export function withPierCursorHooks(
  settings: Record<string, unknown>
): Record<string, unknown> {
  const hooks = hooksRecord(settings);
  for (const event of CURSOR_EVENTS) {
    const current = hooks[event.nativeEvent];
    const existing = Array.isArray(current) ? current : [];
    const kept = existing.filter((entry) => !isPierCursorEntry(entry));
    const pierEntry: CursorHookEntry = {
      command: pierHookCommandWithStdinSessionId(AGENT_ID, event.pierEvent),
      timeout: TIMEOUT_SECONDS,
    };
    hooks[event.nativeEvent] = [...kept, pierEntry];
  }
  return {
    ...settings,
    hooks,
    version: typeof settings.version === "number" ? settings.version : 1,
  };
}

/**
 * 纯函数：剔除全部 pier hook 条目，空事件键一并删除。无 pier 条目时
 * 原样返回输入引用（卸载对齐防护）。
 */
export function withoutPierCursorHooks(
  settings: Record<string, unknown>
): Record<string, unknown> {
  const hooks = hooksRecord(settings);
  let changed = false;
  for (const key of Object.keys(hooks)) {
    const entries = Array.isArray(hooks[key]) ? hooks[key] : [];
    const kept = entries.filter((entry) => !isPierCursorEntry(entry));
    if (kept.length === entries.length) {
      continue;
    }
    changed = true;
    if (kept.length > 0) {
      hooks[key] = kept;
    } else {
      delete hooks[key];
    }
  }
  if (!changed) {
    return settings;
  }
  return { ...settings, hooks };
}

export async function installCursorHooks(
  settingsPath: string = configPath()
): Promise<void> {
  await transformJsonConfig(settingsPath, withPierCursorHooks, AGENT_ID);
}

export async function uninstallCursorHooks(
  settingsPath: string = configPath()
): Promise<void> {
  await transformJsonConfig(settingsPath, withoutPierCursorHooks, AGENT_ID);
}

export const cursorIntegration: AgentHookIntegration = {
  capability: "full",
  detect: () => existsSync(configPath()) || commandExistsOnPath("cursor-agent"),
  id: AGENT_ID,
  install: () => installCursorHooks(),
  uninstall: () => uninstallCursorHooks(),
};

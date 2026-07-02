import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentKind } from "@shared/contracts/agent.ts";
import {
  commandExistsOnPath,
  isPierHookCommand,
  pierHookCommand,
  transformJsonConfig,
} from "./shared.ts";
import type { AgentHookIntegration } from "./types.ts";

const AGENT_ID: AgentKind = "copilot";
const TIMEOUT_SECONDS = 5;

/** 专用文件（loomdesk codeisland.json / orca orca.json 同模式）。 */
const configPath = () => join(homedir(), ".copilot", "hooks", "pier.json");

/** Copilot CLI hook 事件 → pier 事件名。 */
const COPILOT_EVENTS: ReadonlyArray<{
  nativeEvent: string;
  pierEvent: string;
}> = [
  { nativeEvent: "sessionStart", pierEvent: "SessionStart" },
  { nativeEvent: "sessionEnd", pierEvent: "SessionEnd" },
  { nativeEvent: "userPromptSubmitted", pierEvent: "PromptSubmit" },
  { nativeEvent: "preToolUse", pierEvent: "ToolStart" },
  { nativeEvent: "postToolUse", pierEvent: "ToolComplete" },
  { nativeEvent: "agentStop", pierEvent: "Stop" },
  { nativeEvent: "permissionRequest", pierEvent: "PermissionRequest" },
  { nativeEvent: "subagentStart", pierEvent: "SubagentStart" },
  { nativeEvent: "subagentStop", pierEvent: "SubagentStop" },
  { nativeEvent: "errorOccurred", pierEvent: "error" },
];

interface CopilotHookEntry {
  bash: string;
  timeoutSec?: number;
  type: "command";
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

function isPierCopilotEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") {
    return false;
  }
  return isPierHookCommand((entry as CopilotHookEntry).bash);
}

/**
 * 纯函数：注入 pier hook 条目（幂等——先剔旧再加新）。字段是 bash（非
 * command）+ timeoutSec（非 timeout）+ type:"command"（macOS-only app,
 * 不需要 powershell 分支）。
 */
export function withPierCopilotHooks(
  settings: Record<string, unknown>
): Record<string, unknown> {
  const hooks = hooksRecord(settings);
  for (const event of COPILOT_EVENTS) {
    const current = hooks[event.nativeEvent];
    const existing = Array.isArray(current) ? current : [];
    const kept = existing.filter((entry) => !isPierCopilotEntry(entry));
    const pierEntry: CopilotHookEntry = {
      bash: pierHookCommand(AGENT_ID, event.pierEvent),
      timeoutSec: TIMEOUT_SECONDS,
      type: "command",
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
 * 原样返回输入引用。
 */
export function withoutPierCopilotHooks(
  settings: Record<string, unknown>
): Record<string, unknown> {
  const hooks = hooksRecord(settings);
  let changed = false;
  for (const key of Object.keys(hooks)) {
    const entries = Array.isArray(hooks[key]) ? hooks[key] : [];
    const kept = entries.filter((entry) => !isPierCopilotEntry(entry));
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

/**
 * disableAllHooks === true 时跳过安装（loomdesk 抛错，Pier 温和降级为
 * 告警跳过——不阻断其他 agent 集成的批量安装）。
 */
function installTransform(
  settings: Record<string, unknown>
): Record<string, unknown> {
  if (settings.disableAllHooks === true) {
    console.warn(
      `[agent-hooks:${AGENT_ID}] disableAllHooks=true, skip install`
    );
    return settings;
  }
  return withPierCopilotHooks(settings);
}

export async function installCopilotHooks(
  settingsPath: string = configPath()
): Promise<void> {
  await transformJsonConfig(settingsPath, installTransform, AGENT_ID);
}

export async function uninstallCopilotHooks(
  settingsPath: string = configPath()
): Promise<void> {
  await transformJsonConfig(settingsPath, withoutPierCopilotHooks, AGENT_ID);
}

export const copilotIntegration: AgentHookIntegration = {
  capability: "full",
  detect: () =>
    existsSync(join(homedir(), ".copilot")) || commandExistsOnPath("copilot"),
  id: AGENT_ID,
  install: () => installCopilotHooks(),
  uninstall: () => uninstallCopilotHooks(),
};

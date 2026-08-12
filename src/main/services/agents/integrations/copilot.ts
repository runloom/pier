import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentKind } from "@shared/contracts/agent.ts";
import {
  commandExistsOnPath,
  isPierHookCommand,
  pierHookCommandV3WithStdin,
  pierHookCommandV3WithStdinValueDispatch,
  transformJsonConfig,
} from "./shared.ts";
import type { AgentHookIntegration } from "./types.ts";

const AGENT_ID: AgentKind = "copilot";
const TIMEOUT_SECONDS = 5;

/** 专用文件（loomdesk codeisland.json 同模式）。 */
const configPath = () => join(homedir(), ".copilot", "hooks", "pier.json");

/**
 * Copilot CLI 已核验的原生事实 → Pier 规范事件名。
 * Esc 取消常写入 session-state `events.jsonl` 的 `type: abort`
 * （reason 含 user），**不一定**触发 agentStop；终态对账见
 * `transcript/copilot-reconciler.ts`。
 */
export const COPILOT_EVENTS: ReadonlyArray<{
  nativeEvent: string;
  pierEvent: string;
}> = [
  { nativeEvent: "sessionStart", pierEvent: "SessionStart" },
  { nativeEvent: "sessionEnd", pierEvent: "SessionEnd" },
  { nativeEvent: "userPromptSubmitted", pierEvent: "PromptSubmit" },
  { nativeEvent: "preToolUse", pierEvent: "ToolStart" },
  { nativeEvent: "postToolUse", pierEvent: "ToolComplete" },
  { nativeEvent: "postToolUseFailure", pierEvent: "ToolComplete" },
  { nativeEvent: "agentStop", pierEvent: "Stop" },
  { nativeEvent: "preCompact", pierEvent: "processing" },
  { nativeEvent: "subagentStart", pierEvent: "SubagentStart" },
  { nativeEvent: "subagentStop", pierEvent: "SubagentStop" },
  { nativeEvent: "errorOccurred.recoverable", pierEvent: "processing" },
  { nativeEvent: "errorOccurred", pierEvent: "error" },
];

interface CopilotHookEntry {
  bash: string;
  matcher?: string;
  timeoutSec?: number;
  type: "command";
}

interface CopilotHookSpec {
  buildCommand: () => string;
  matcher?: string;
  nativeEvent: string;
}

function standardCommand(
  event:
    | "SessionStart"
    | "SessionEnd"
    | "PromptSubmit"
    | "ToolStart"
    | "ToolComplete"
    | "Stop"
    | "processing"
    | "SubagentStart"
    | "SubagentStop",
  nativeEvent: string
): string {
  return pierHookCommandV3WithStdin({ agentId: AGENT_ID, event, nativeEvent });
}

const COPILOT_HOOK_SPECS: readonly CopilotHookSpec[] = [
  {
    buildCommand: () => standardCommand("SessionStart", "sessionStart"),
    nativeEvent: "sessionStart",
  },
  {
    buildCommand: () => standardCommand("SessionEnd", "sessionEnd"),
    nativeEvent: "sessionEnd",
  },
  {
    buildCommand: () => standardCommand("PromptSubmit", "userPromptSubmitted"),
    nativeEvent: "userPromptSubmitted",
  },
  {
    buildCommand: () => standardCommand("ToolStart", "preToolUse"),
    nativeEvent: "preToolUse",
  },
  {
    buildCommand: () => standardCommand("ToolComplete", "postToolUse"),
    nativeEvent: "postToolUse",
  },
  {
    buildCommand: () => standardCommand("ToolComplete", "postToolUseFailure"),
    nativeEvent: "postToolUseFailure",
  },
  {
    buildCommand: () => standardCommand("Stop", "agentStop"),
    nativeEvent: "agentStop",
  },
  {
    buildCommand: () => standardCommand("processing", "preCompact"),
    nativeEvent: "preCompact",
  },
  {
    buildCommand: () =>
      pierHookCommandV3WithStdin({
        actorHint: "subagent",
        agentId: AGENT_ID,
        agentTypeFields: ["agentName"],
        event: "SubagentStart",
        nativeEvent: "subagentStart",
        sessionIdAsParent: true,
      }),
    nativeEvent: "subagentStart",
  },
  {
    buildCommand: () =>
      pierHookCommandV3WithStdin({
        actorHint: "subagent",
        agentId: AGENT_ID,
        agentInstanceIdFields: ["agentId"],
        agentTypeFields: ["agentType", "agentName"],
        event: "SubagentStop",
        nativeEvent: "subagentStop",
        sessionIdAsParent: true,
      }),
    nativeEvent: "subagentStop",
  },
  {
    buildCommand: () =>
      pierHookCommandV3WithStdinValueDispatch({
        agentId: AGENT_ID,
        cases: [
          { nativeValue: "true", pierEvent: "processing" },
          { nativeValue: "false", pierEvent: "error" },
        ],
        fallbackPierEvent: "processing",
        nativeEvent: "errorOccurred",
        nativeStateFields: ["recoverable"],
      }),
    nativeEvent: "errorOccurred",
  },
];

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
  for (const nativeEvent of new Set(
    COPILOT_HOOK_SPECS.map((event) => event.nativeEvent)
  )) {
    const current = hooks[nativeEvent];
    const existing = Array.isArray(current) ? current : [];
    hooks[nativeEvent] = existing.filter((entry) => !isPierCopilotEntry(entry));
  }
  for (const event of COPILOT_HOOK_SPECS) {
    const current = hooks[event.nativeEvent];
    const existing = Array.isArray(current) ? current : [];
    const pierEntry: CopilotHookEntry = {
      bash: event.buildCommand(),
      ...(event.matcher === undefined ? {} : { matcher: event.matcher }),
      timeoutSec: TIMEOUT_SECONDS,
      type: "command",
    };
    hooks[event.nativeEvent] = [...existing, pierEntry];
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
  detect: () =>
    existsSync(join(homedir(), ".copilot")) || commandExistsOnPath("copilot"),
  id: AGENT_ID,
  runtime: {
    emittedMappings: COPILOT_EVENTS,
    stopAuthority: "advisory",
  },
  install: () => installCopilotHooks(),
  uninstall: () => uninstallCopilotHooks(),
};

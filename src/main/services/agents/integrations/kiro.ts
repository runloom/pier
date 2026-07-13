import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentKind } from "@shared/contracts/agent.ts";
import {
  commandExistsOnPath,
  isPierHookCommand,
  PIER_AGENT_HOOKS_DIR_MARK,
  pierHookCommandWithStdinSessionId,
  transformJsonConfig,
} from "./shared.ts";
import type { AgentHookIntegration } from "./types.ts";

const AGENT_ID: AgentKind = "kiro";

/**
 * AWS Kiro CLI hooks — 依据官方文档：
 * - kiro.dev/docs/cli/hooks/：五个事件 agentSpawn / userPromptSubmit /
 *   preToolUse / postToolUse / stop；hook 条目字段仅 `command`（必填）与
 *   `matcher`（可选, 仅 preToolUse/postToolUse 场景使用）。
 * - kiro.dev/docs/cli/custom-agents/configuration-reference/#hooks-field：
 *   确认 schema 为**扁平数组**——`hooks.<event>` 直接是
 *   `Array<{ command: string; matcher?: string }>`，与 Claude 家族
 *   `{matcher, hooks:[{type,command}]}` 的嵌套结构不同, 因此本文件不复用
 *   shared.ts 的 createNestedJsonIntegration/withPierNestedHooks
 *   （那套假设的是 Claude schema），改为本文件内独立的扁平数组变换。
 *
 * 关键设计题：装到哪个 agent 配置？
 * kiro.dev 的 hooks 与 custom-agents 文档均未提及任何全局 hooks 位置或
 * `default.json` 默认 agent 文件——custom-agents/configuration-reference
 * 只展示 `~/.kiro/agents/` 下用户自建的示例文件（如
 * general-assistant.json / code-reviewer.json），未说明 CLI 启动时默认
 * 加载哪一个（若干个）。既然没有可确定的单一「默认 agent」，本集成对
 * `~/.kiro/agents/` 目录下**所有既存** `*.json` 文件逐一注入 pier hooks
 * （幂等, 逐文件走 transformJsonConfig 保证损坏文件互不影响、无变化不
 * 落盘）。目录不存在或为空时 install 是 no-op——不主动新建 agent 文件,
 * 因为 kiro 尚未在该机器上配置任何 agent 时, 猜测创建一个可能与用户后续
 * 自建的 agent 语义冲突, 保守起见等用户先有 agent 配置后再介入。
 *
 * 事件映射：agentSpawn→SessionStart, userPromptSubmit→PromptSubmit,
 * preToolUse→ToolStart, postToolUse→ToolComplete, stop→Stop。
 * capability "full"——但无独立的 permission 等待事件（preToolUse 可拦截
 * 但触发时机是「工具即将执行」而非「等待用户授权」的等待态本身，kiro
 * 文档没有类似 Claude PermissionRequest 的通知钩子），所以 waiting 态在
 * kiro 集成下不可达，仍归为 full 是因为其余四个生命周期事件（会话/
 * 提示/工具起止/回合结束）齐全，仅缺 permission 这一项。
 *
 * stdin 处理：kiro 会向 hook 子进程的 stdin 写入 JSON payload（如
 * hook_event_name/cwd/session_id/tool_name 等）。Pier 消费该 payload，
 * 抽取 `session_id` 后作为 JSONL 的 `sessionId` 上报，用于重启后恢复
 * 同一个 agent 会话；读取 stdin 也避免上游因管道未消费而阻塞。
 */

const KIRO_EVENTS: ReadonlyArray<{
  matcher?: string;
  nativeEvent: string;
  pierEvent: string;
}> = [
  { nativeEvent: "agentSpawn", pierEvent: "SessionStart" },
  { nativeEvent: "userPromptSubmit", pierEvent: "PromptSubmit" },
  { matcher: "*", nativeEvent: "preToolUse", pierEvent: "ToolStart" },
  { matcher: "*", nativeEvent: "postToolUse", pierEvent: "ToolComplete" },
  { nativeEvent: "stop", pierEvent: "Stop" },
];

/** kiro 专用命令变体：消费 stdin payload 并携带 session_id 上报。 */
export function kiroHookCommand(
  pierEvent: string,
  nativeEvent: string = pierEvent
): string {
  return pierHookCommandWithStdinSessionId(AGENT_ID, pierEvent, nativeEvent);
}

interface KiroHookEntry {
  command: string;
  matcher?: string;
}

function isPierKiroEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") {
    return false;
  }
  return isPierHookCommand((entry as KiroHookEntry).command);
}

function hooksRecord(
  agentConfig: Record<string, unknown>
): Record<string, unknown[]> {
  const hooks = agentConfig.hooks;
  if (hooks && typeof hooks === "object" && !Array.isArray(hooks)) {
    return { ...(hooks as Record<string, unknown[]>) };
  }
  return {};
}

/** 纯函数：注入 pier hook 条目到单个 agent 配置（幂等——先剔旧再加新）。 */
export function withPierKiroHooks(
  agentConfig: Record<string, unknown>
): Record<string, unknown> {
  const hooks = hooksRecord(agentConfig);
  for (const event of KIRO_EVENTS) {
    const current = hooks[event.nativeEvent];
    const existing = Array.isArray(current) ? current : [];
    const kept = existing.filter((entry) => !isPierKiroEntry(entry));
    const pierEntry: KiroHookEntry = {
      command: kiroHookCommand(event.pierEvent, event.nativeEvent),
      ...(event.matcher === undefined ? {} : { matcher: event.matcher }),
    };
    hooks[event.nativeEvent] = [...kept, pierEntry];
  }
  return { ...agentConfig, hooks };
}

/**
 * 纯函数：剔除全部 pier hook 条目, 空事件键一并删除。无 pier 条目时原样
 * 返回输入引用。
 */
export function withoutPierKiroHooks(
  agentConfig: Record<string, unknown>
): Record<string, unknown> {
  const hooks = hooksRecord(agentConfig);
  let changed = false;
  for (const key of Object.keys(hooks)) {
    const entries = Array.isArray(hooks[key]) ? hooks[key] : [];
    const kept = entries.filter((entry) => !isPierKiroEntry(entry));
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
    return agentConfig;
  }
  return { ...agentConfig, hooks };
}

export function kiroAgentsDir(): string {
  return join(homedir(), ".kiro", "agents");
}

async function listAgentConfigFiles(): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(kiroAgentsDir());
  } catch {
    return [];
  }
  return entries
    .filter((name) => name.endsWith(".json"))
    .map((name) => join(kiroAgentsDir(), name));
}

export async function installKiroHooks(): Promise<void> {
  const files = await listAgentConfigFiles();
  for (const file of files) {
    await transformJsonConfig(file, withPierKiroHooks, AGENT_ID);
  }
}

export async function uninstallKiroHooks(): Promise<void> {
  const files = await listAgentConfigFiles();
  for (const file of files) {
    await transformJsonConfig(file, withoutPierKiroHooks, AGENT_ID);
  }
}

function kiroDetect(): boolean {
  return existsSync(join(homedir(), ".kiro")) || commandExistsOnPath("kiro");
}

export const kiroIntegration: AgentHookIntegration = {
  capability: "full",
  runtime: { stopAuthority: "advisory" },
  detect: kiroDetect,
  id: AGENT_ID,
  install: installKiroHooks,
  uninstall: uninstallKiroHooks,
};

/** marker 常量导出（测试断言用）。 */
export const KIRO_HOOK_MARK = PIER_AGENT_HOOKS_DIR_MARK;

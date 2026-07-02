import { existsSync } from "node:fs";
import { readdir, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentKind } from "@shared/contracts/agent.ts";
import {
  atomicWriteFile,
  commandExistsOnPath,
  pierHookCommand,
  removePierTextBlock,
  upsertPierTextBlock,
} from "./shared.ts";
import type { AgentHookIntegration } from "./types.ts";

const AGENT_ID: AgentKind = "kimi";

/**
 * kimi-cli 官方 hook 机制（main 分支源码 src/kimi_cli/hooks/config.py 为准,
 * docs/en/configuration/config-files.md#hooks 官方原文）：
 * - 载体：~/.kimi/config.toml 顶层 [[hooks]] 数组表
 *   ($KIMI_SHARE_DIR 覆盖时改到该目录下 config.toml)。
 * - 字段：event (Claude 式 CamelCase 事件名, 13 个)、command (shell)、
 *   matcher (可选正则)、timeout (秒, 1-600, 默认 30)。
 * - payload：hook 进程从 stdin 读取 JSON (Claude 式) —— 我们只做旁路
 *   fire-and-forget POST 上报, 不消费 stdin。
 *
 * 翻案记录：先前一版基于 PR#1131 ("AgentHooks for dogfooding") 改写为
 * ~/.config/agents/hooks/<name>/HOOK.md 文件制协议 —— 该 PR 已关闭未合并,
 * kimi-cli main 实际走的是本文所述 TOML 方案。回滚到 TOML 之外, uninstall 还需
 * 清理上一版误写入 ~/.config/agents/hooks/pier-<trigger>/HOOK.md 的死
 * 目录 (marker 检查后再删)。
 */

/**
 * HookEventType 官方枚举 (config.py) → pier 规范事件名。
 *
 * 官方枚举共 13 个:上面 12 个 + Notification。**不装 Notification**——
 * 与 claude 集成同理:kimisoul.py 源码里 Notification hook 触发点仅在
 * llm 通知场景(idle/auth_success 之类的 severity/type 通知), 与 agent
 * "正在做什么" 的状态语义无关, 装了会让状态栏抖动。刻意跳过。
 */
const KIMI_HOOK_EVENTS: ReadonlyArray<{
  matcher?: string;
  nativeEvent: string;
  pierEvent: string;
}> = [
  { nativeEvent: "SessionStart", pierEvent: "SessionStart" },
  { nativeEvent: "UserPromptSubmit", pierEvent: "PromptSubmit" },
  { nativeEvent: "PreToolUse", pierEvent: "ToolStart" },
  { nativeEvent: "PostToolUse", pierEvent: "ToolComplete" },
  { nativeEvent: "PostToolUseFailure", pierEvent: "ToolComplete" },
  { nativeEvent: "PreCompact", pierEvent: "processing" },
  { nativeEvent: "PostCompact", pierEvent: "processing" },
  { nativeEvent: "Stop", pierEvent: "Stop" },
  { nativeEvent: "StopFailure", pierEvent: "error" },
  { nativeEvent: "SubagentStart", pierEvent: "SubagentStart" },
  { nativeEvent: "SubagentStop", pierEvent: "SubagentStop" },
  { nativeEvent: "SessionEnd", pierEvent: "SessionEnd" },
];

/** timeout（秒, 1-600）：给 hook 上报留 5s 足够, 与 shared.pierHookCommand 的 -m 2 匹配。 */
const KIMI_HOOK_TIMEOUT_SECONDS = 5;

/** 旧文件制协议（未合并 PR）残留目录, uninstall 时清理。 */
const LEGACY_HOOK_DIR_PREFIX = "pier-";
const LEGACY_HOOK_MARKER = "# pier-agent-status:v1 (managed by Pier";

/** 真实 hook 落盘路径：$KIMI_SHARE_DIR/config.toml 优先, 否则 ~/.kimi/config.toml。 */
export function kimiConfigPath(): string {
  const shareDir = process.env.KIMI_SHARE_DIR;
  if (shareDir && shareDir.length > 0) {
    return join(shareDir, "config.toml");
  }
  return join(homedir(), ".kimi", "config.toml");
}

/** 旧 AgentHooks 目录（PR#1131 未合并方案, 遗留清理用）。 */
function legacyAgentHooksDir(): string {
  return join(homedir(), ".config", "agents", "hooks");
}

export function kimiDetect(): boolean {
  if (existsSync(kimiConfigPath())) {
    return true;
  }
  return commandExistsOnPath("kimi");
}

/**
 * 生成 pier marker 块内容（一系列 [[hooks]] 表）。marker 由 shared 的
 * pierBlockMarkers 包裹（"# >>> pier-agent-status:kimi ..."）。
 */
const TRAILING_NEWLINES_RE = /\n+$/;

function buildKimiHooksBlock(): string {
  const lines: string[] = [];
  for (const event of KIMI_HOOK_EVENTS) {
    const command = pierHookCommand(AGENT_ID, event.pierEvent);
    lines.push("[[hooks]]");
    lines.push(`event = ${JSON.stringify(event.nativeEvent)}`);
    if (event.matcher !== undefined) {
      lines.push(`matcher = ${JSON.stringify(event.matcher)}`);
    }
    lines.push(`command = ${JSON.stringify(command)}`);
    lines.push(`timeout = ${KIMI_HOOK_TIMEOUT_SECONDS}`);
    lines.push("");
  }
  return lines.join("\n").replace(TRAILING_NEWLINES_RE, "");
}

/** 纯函数：向 TOML 原文注入/替换 pier marker 块。 */
export function withPierKimiHooks(raw: string): string {
  return upsertPierTextBlock(raw, AGENT_ID, buildKimiHooksBlock());
}

/** 纯函数：从 TOML 原文剔除 pier marker 块。 */
export function withoutPierKimiHooks(raw: string): string {
  return removePierTextBlock(raw, AGENT_ID);
}

async function readTextFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function writeIfChanged(
  path: string,
  next: string,
  original: string | null
): Promise<void> {
  if (next === original) {
    return;
  }
  await atomicWriteFile(path, next);
}

export async function installKimiHooks(
  configPath: string = kimiConfigPath()
): Promise<void> {
  await cleanupLegacyAgentHooksDir();
  const original = await readTextFile(configPath);
  const raw = original ?? "";
  const next = withPierKimiHooks(raw);
  await writeIfChanged(configPath, next, original);
}

export async function uninstallKimiHooks(
  configPath: string = kimiConfigPath()
): Promise<void> {
  await cleanupLegacyAgentHooksDir();
  const original = await readTextFile(configPath);
  if (original === null) {
    return;
  }
  const next = withoutPierKimiHooks(original);
  await writeIfChanged(configPath, next, original);
}

/** 清理 PR#1131 未合并方案遗留的 ~/.config/agents/hooks/pier-<trigger> 目录（marker 检查后再删）。 */
export async function cleanupLegacyAgentHooksDir(): Promise<void> {
  const dir = legacyAgentHooksDir();
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (!name.startsWith(LEGACY_HOOK_DIR_PREFIX)) {
      continue;
    }
    const hookPath = join(dir, name, "HOOK.md");
    const content = await readTextFile(hookPath);
    if (content === null || !content.includes(LEGACY_HOOK_MARKER)) {
      continue;
    }
    await rm(join(dir, name), { force: true, recursive: true });
  }
}

export const kimiIntegration: AgentHookIntegration = {
  capability: "full",
  detect: kimiDetect,
  id: AGENT_ID,
  install: () => installKimiHooks(),
  uninstall: () => uninstallKimiHooks(),
};

/** marker 常量导出（测试断言用）。 */
export const KIMI_HOOK_TIMEOUT_SECONDS_VALUE = KIMI_HOOK_TIMEOUT_SECONDS;

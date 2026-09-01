import { existsSync } from "node:fs";
import { readdir, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentHookEventPayloadV3 } from "@shared/contracts/agent/session.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import { PIER_HOOK_COMMAND_GENERATION } from "../hooks-install.ts";
import {
  atomicWriteFile,
  commandExistsOnPath,
  isManagedPierHookCommand,
  pierBlockMarkers,
  pierHookCommandGeneration,
  pierHookCommandV3WithStdin,
  pierHookCommandV3WithStdinOutcomeDispatch,
  removePierTextBlock,
  upsertPierTextBlockUnlessNewer,
} from "./shared.ts";
import type { AgentHookIntegration } from "./types.ts";

const AGENT_ID: AgentKind = "kimi";

/**
 * Kimi Code（2026-08-29 审计；本机 0.38.0/0.39.1 binary）：
 * - 配置只读 `KIMI_CODE_HOME`（默认 `~/.kimi-code`）config.toml；`~/.kimi`
 *   只做遗留清理。载体仍是顶层 [[hooks]]（CamelCase event、timeout 秒）。
 * - 装 14 事件：原 12 项 + PermissionRequest/Result（`tool_call_id` /
 *   `toolCallId` 配对，`decision` → accepted/rejected/cancelled/failed）。
 * - 不装 TurnStarted/Interrupt：payload 用主 session_id 且带 turn_id，子
 *   智能体会抢占主 scope。不装 Notification（与状态无关）。
 * - PostToolUseFailure 的 error 在新 CLI 是对象，补 `error.message` 路径。
 *
 * 翻案：PR#1131 文件制 HOOK.md 未合并；uninstall 仍清 pier-<trigger>。
 * 孤儿：上游重写 TOML 会丢 marker，按 `isManagedPierHookCommand` 剔条目。
 * 终态：`kimi-reconciler.ts` 读 wire.jsonl TurnEnd → TurnCompleted（无法
 * 区分取消，interrupted 维持 unsupported）。
 */

const KIMI_PERMISSION_ID_FIELDS = ["tool_call_id", "toolCallId"] as const;
const KIMI_PERMISSION_OUTCOMES = [
  { interactionOutcome: "accepted" as const, nativeValue: "approved" },
  { interactionOutcome: "rejected" as const, nativeValue: "rejected" },
  { interactionOutcome: "cancelled" as const, nativeValue: "cancelled" },
  { interactionOutcome: "failed" as const, nativeValue: "error" },
];

/** HookEventType → pier 规范事件。不装 Notification / TurnStarted / Interrupt。 */
export const KIMI_HOOK_EVENTS: ReadonlyArray<{
  agentTypeFields?: readonly string[];
  matcher?: string;
  nativeStateFields?: readonly string[];
  nativeStatePaths?: readonly string[];
  nativeEvent: string;
  pierEvent: AgentHookEventPayloadV3["event"];
}> = [
  { nativeEvent: "SessionStart", pierEvent: "SessionStart" },
  { nativeEvent: "UserPromptSubmit", pierEvent: "PromptSubmit" },
  { nativeEvent: "PreToolUse", pierEvent: "ToolStart" },
  { nativeEvent: "PostToolUse", pierEvent: "ToolComplete" },
  {
    nativeEvent: "PostToolUseFailure",
    // 老 CLI error 是字符串（字段提取）；Kimi Code error 是对象
    // （toKimiErrorPayload），走 error.message 路径提取。
    nativeStateFields: ["error"],
    nativeStatePaths: ["error.message"],
    pierEvent: "ToolComplete",
  },
  {
    nativeEvent: "PermissionRequest",
    pierEvent: "InteractionRequested",
  },
  {
    nativeEvent: "PermissionResult",
    nativeStateFields: ["decision"],
    pierEvent: "InteractionResolved",
  },
  { nativeEvent: "PreCompact", pierEvent: "processing" },
  { nativeEvent: "PostCompact", pierEvent: "processing" },
  { nativeEvent: "Stop", pierEvent: "Stop" },
  {
    nativeEvent: "StopFailure",
    nativeStateFields: ["error_type", "error_message"],
    pierEvent: "error",
  },
  {
    agentTypeFields: ["agent_name"],
    nativeEvent: "SubagentStart",
    pierEvent: "SubagentStart",
  },
  {
    agentTypeFields: ["agent_name"],
    nativeEvent: "SubagentStop",
    pierEvent: "SubagentStop",
  },
  { nativeEvent: "SessionEnd", pierEvent: "SessionEnd" },
];

/** timeout（秒, 1-600）：给 hook 上报留 5s 足够, 与 shared.pierHookCommand 的 -m 2 匹配。 */
const KIMI_HOOK_TIMEOUT_SECONDS = 5;

/** 旧文件制协议（未合并 PR）残留目录, uninstall 时清理。 */
const LEGACY_HOOK_DIR_PREFIX = "pier-";
const LEGACY_HOOK_MARKER = "# pier-agent-status:v1 (managed by Pier";

/** Kimi Code home：`KIMI_CODE_HOME` 覆盖，默认 `~/.kimi-code`。 */
export function kimiCodeHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.KIMI_CODE_HOME?.trim();
  if (override) {
    return override;
  }
  return join(homedir(), ".kimi-code");
}

/** 现行 hook 落盘路径：{KIMI_CODE_HOME}/config.toml。 */
export function kimiConfigPath(): string {
  return join(kimiCodeHomeDir(), "config.toml");
}

/**
 * 老 kimi-cli 配置路径（$KIMI_SHARE_DIR 覆盖，默认 ~/.kimi/config.toml）。
 * 新 CLI 不读取；install/uninstall 都只对它做清理。
 */
export function kimiLegacyConfigPath(): string {
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
  if (existsSync(kimiCodeHomeDir()) || existsSync(kimiLegacyConfigPath())) {
    return true;
  }
  return commandExistsOnPath("kimi");
}

/**
 * 生成 pier marker 块内容（一系列 [[hooks]] 表）。marker 由 shared 的
 * pierBlockMarkers 包裹（"# >>> pier-agent-status:kimi ..."）。
 */
const TRAILING_NEWLINES_RE = /\n+$/;

function kimiManagedHookCommand(
  event: (typeof KIMI_HOOK_EVENTS)[number]
): string {
  if (event.pierEvent === "InteractionRequested") {
    return pierHookCommandV3WithStdin({
      agentId: AGENT_ID,
      event: "InteractionRequested",
      interactionIdFields: KIMI_PERMISSION_ID_FIELDS,
      interactionKind: "permission",
      nativeEvent: event.nativeEvent,
    });
  }
  if (event.pierEvent === "InteractionResolved") {
    return pierHookCommandV3WithStdinOutcomeDispatch(
      {
        agentId: AGENT_ID,
        event: "InteractionResolved",
        interactionIdFields: KIMI_PERMISSION_ID_FIELDS,
        interactionKind: "permission",
        nativeEvent: event.nativeEvent,
        nativeStateFields: event.nativeStateFields ?? ["decision"],
      },
      KIMI_PERMISSION_OUTCOMES
    );
  }
  return pierHookCommandV3WithStdin({
    agentId: AGENT_ID,
    ...(event.agentTypeFields
      ? { agentTypeFields: event.agentTypeFields }
      : {}),
    event: event.pierEvent,
    nativeEvent: event.nativeEvent,
    ...(event.nativeStateFields
      ? { nativeStateFields: event.nativeStateFields }
      : {}),
    ...(event.nativeStatePaths
      ? { nativeStatePaths: event.nativeStatePaths }
      : {}),
  });
}

function buildKimiHooksBlock(): string {
  const lines: string[] = [];
  for (const event of KIMI_HOOK_EVENTS) {
    const command = kimiManagedHookCommand(event);
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

/** 纯函数：向 TOML 原文注入/替换 pier marker 块（内含孤儿清扫防双发）。 */
export function withPierKimiHooks(raw: string): string {
  if (kimiTomlHasNewerPierOrphan(raw)) {
    return raw;
  }
  return upsertPierTextBlockUnlessNewer(
    withoutOrphanPierKimiHookEntries(raw),
    AGENT_ID,
    buildKimiHooksBlock()
  );
}

const KIMI_TABLE_HEADER_RE = /^\s*\[/;
const KIMI_HOOKS_TABLE_RE = /^\s*\[\[hooks\]\]\s*(?:#.*)?$/;
const KIMI_COMMAND_BASIC_RE =
  /^\s*command\s*=\s*("(?:[^"\\]|\\.)*")\s*(?:#.*)?$/m;
const KIMI_COMMAND_LITERAL_RE = /^\s*command\s*=\s*'([^']*)'\s*(?:#.*)?$/m;

function kimiHookCommand(entryBody: string): string | undefined {
  const basic = KIMI_COMMAND_BASIC_RE.exec(entryBody)?.[1];
  if (basic) {
    try {
      return JSON.parse(basic) as string;
    } catch {
      return;
    }
  }
  return KIMI_COMMAND_LITERAL_RE.exec(entryBody)?.[1];
}

function isPierKimiHooksEntry(entryBody: string): boolean {
  const command = kimiHookCommand(entryBody);
  return command !== undefined && isManagedPierHookCommand(command);
}

function shouldPreserveNewerPierKimiOrphan(entryBody: string): boolean {
  const command = kimiHookCommand(entryBody);
  return (
    command !== undefined &&
    pierHookCommandGeneration(command) > PIER_HOOK_COMMAND_GENERATION
  );
}

function kimiTomlHasNewerPierOrphan(raw: string): boolean {
  if (raw.includes('"""') || raw.includes("'''")) {
    return false;
  }
  const markers = pierBlockMarkers(AGENT_ID);
  let insideMarkerBlock = false;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === markers.end) {
      insideMarkerBlock = false;
      continue;
    }
    if (trimmed === markers.begin) {
      insideMarkerBlock = true;
      continue;
    }
    if (insideMarkerBlock) {
      continue;
    }
    if (kimiHookCommand(line) && shouldPreserveNewerPierKimiOrphan(line)) {
      return true;
    }
  }
  return false;
}

/**
 * 逐条目所有权清理：剔除 marker 块**外**裸露的 pier [[hooks]] 条目。
 * 实测 kimi 侧重写 TOML 会丢 marker 注释，旧 pier 条目成孤儿——卸载清不
 * 掉且每事件双发。不动用户条目（按 isManagedPierHookCommand 判所有权），
 * 也不动 marker 块内部（块由 upsert/remove 整块所有，且承担世代降级保护）。
 * 更高世代孤儿跳过（旧客户端不得降级）；含 `"""`/`'''` 时整段保守不改，
 * 避免把多行字符串里的 `[` 误判成表头。
 */
export function withoutOrphanPierKimiHookEntries(raw: string): string {
  if (raw.includes('"""') || raw.includes("'''")) {
    return raw;
  }
  const markers = pierBlockMarkers(AGENT_ID);
  const lines = raw.split("\n");
  const kept: string[] = [];
  let entry: string[] | null = null;
  let insideMarkerBlock = false;
  let changed = false;
  const flush = (): void => {
    if (!entry) {
      return;
    }
    const body = entry.join("\n");
    if (
      isPierKimiHooksEntry(body) &&
      !shouldPreserveNewerPierKimiOrphan(body)
    ) {
      changed = true;
    } else {
      kept.push(...entry);
    }
    entry = null;
  };
  for (const line of lines) {
    const trimmed = line.trim();
    if (insideMarkerBlock) {
      kept.push(line);
      if (trimmed === markers.end) {
        insideMarkerBlock = false;
      }
      continue;
    }
    if (trimmed === markers.begin) {
      flush();
      insideMarkerBlock = true;
      kept.push(line);
      continue;
    }
    if (KIMI_TABLE_HEADER_RE.test(line)) {
      flush();
      if (KIMI_HOOKS_TABLE_RE.test(line)) {
        entry = [line];
        continue;
      }
      kept.push(line);
      continue;
    }
    if (entry) {
      entry.push(line);
      continue;
    }
    kept.push(line);
  }
  flush();
  return changed ? kept.join("\n") : raw;
}

/** 纯函数：从 TOML 原文剔除 pier marker 块与块外孤儿 pier 条目。 */
export function withoutPierKimiHooks(raw: string): string {
  return withoutOrphanPierKimiHookEntries(removePierTextBlock(raw, AGENT_ID));
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

/** 老 kimi-cli config.toml 只做剔除（marker 块 + 孤儿条目），不再写入。 */
async function cleanupKimiLegacyConfig(path: string): Promise<void> {
  const original = await readTextFile(path);
  if (original === null) {
    return;
  }
  await writeIfChanged(path, withoutPierKimiHooks(original), original);
}

export async function installKimiHooks(
  configPath: string = kimiConfigPath(),
  legacyConfigPath: string = kimiLegacyConfigPath()
): Promise<void> {
  await cleanupLegacyAgentHooksDir();
  if (legacyConfigPath !== configPath) {
    await cleanupKimiLegacyConfig(legacyConfigPath);
  }
  const original = await readTextFile(configPath);
  const next = withPierKimiHooks(original ?? "");
  await writeIfChanged(configPath, next, original);
}

export async function uninstallKimiHooks(
  configPath: string = kimiConfigPath(),
  legacyConfigPath: string = kimiLegacyConfigPath()
): Promise<void> {
  await cleanupLegacyAgentHooksDir();
  if (legacyConfigPath !== configPath) {
    await cleanupKimiLegacyConfig(legacyConfigPath);
  }
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
  detect: kimiDetect,
  id: AGENT_ID,
  runtime: {
    emittedMappings: KIMI_HOOK_EVENTS.map(({ nativeEvent, pierEvent }) => ({
      nativeEvent,
      pierEvent,
    })),
    stopAuthority: "advisory",
  },
  install: () => installKimiHooks(),
  uninstall: () => uninstallKimiHooks(),
};

/** marker 常量导出（测试断言用）。 */
export const KIMI_HOOK_TIMEOUT_SECONDS_VALUE = KIMI_HOOK_TIMEOUT_SECONDS;

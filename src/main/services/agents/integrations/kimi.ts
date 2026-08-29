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
  removePierTextBlock,
  upsertPierTextBlockUnlessNewer,
} from "./shared.ts";
import type { AgentHookIntegration } from "./types.ts";

const AGENT_ID: AgentKind = "kimi";

/**
 * Kimi Code（2026-08-29 审计换代重接；本机 0.38.0 binary 一手证据）：
 * - 上游已从 Python kimi-cli 换代为 JS 实现的 Kimi Code。配置只读
 *   `KIMI_CODE_HOME`（默认 `~/.kimi-code`）下的 config.toml；老家目录
 *   `~/.kimi` 只剩迁移提示（binary："Old data kept at ~/.kimi/"），
 *   `$KIMI_SHARE_DIR` 在新 CLI 中已不存在——老路径仅保留清理。
 * - 载体仍是 config.toml 顶层 [[hooks]] 数组表（binary schema：
 *   `hooks: readHooks(raw["hooks"], …)`；本机 Orca 写入的 [[hooks]] 在新
 *   路径生效佐证）。字段：event（CamelCase）、command、matcher、
 *   timeout（秒，新 schema 默认 30，5 合法）。
 * - 现装 12 事件的名称与字段在新 CLI 全部有效（binary 逐字段核对：
 *   `agent_name` camelToSnake ✓、StopFailure `error_type/error_message` ✓、
 *   工具 `tool_call_id/tool_name` 默认别名 ✓）。PostToolUseFailure 的
 *   error 在新 CLI 是对象（toKimiErrorPayload：{code,message,name,…}），
 *   故补 `error.message` 路径提取；老 CLI 字符串 error 仍走字段提取。
 * - **刻意不装的新事件**（binary 20 事件枚举）：
 *   - `TurnStarted`/`Interrupt` 带 turn_id 且 hooks 服务按 agent 实例化
 *     （contributeAgentService）、payload 全用主 session_id 无 agent 区分
 *     字段——子智能体的 turn_id 会以外来回合抢占主 scope（cursor Task
 *     同款模式），Interrupt 还会在子智能体被取消时误封主回合。上游给
 *     payload 加 agent 身份字段前不得安装。
 *   - `PermissionRequest`/`PermissionResult`：fire-and-forget 且未证实
 *     配对 id 与 Result 必达；waiting 卡死代价高于收益，不装。
 *   - `Notification`：与 claude 集成同理，通知语义与状态无关。
 *
 * 翻案记录：先前一版基于 PR#1131 ("AgentHooks for dogfooding") 改写为
 * ~/.config/agents/hooks/<name>/HOOK.md 文件制协议 —— 该 PR 已关闭未合并。
 * uninstall 仍清理该版误写入的 pier-<trigger>/HOOK.md 死目录。
 *
 * 孤儿条目清理：实测 kimi 侧工具重写 TOML 时会丢弃 marker 注释行，Pier
 * 再装时找不到 marker 便追加新块，旧条目成无 marker 孤儿（本机
 * ~/.kimi/config.toml 实证 12 条块内 + 12 条孤儿）。因此清理不能只依赖
 * 文本 marker：`withoutPierKimiHooks` 同时按 `isManagedPierHookCommand` 逐
 * [[hooks]] 条目剔除（对齐 JSON 系集成的条目所有权模式）。
 *
 * 终态对账：`transcript/kimi-reconciler.ts` 读 sessions 下 wire.jsonl 的
 * `TurnEnd`（v1 `<sid>/wire.jsonl` 与 v2 `<sid>/agents/main/wire.jsonl`
 * 双布局，roots 覆盖新老家目录），映射 TurnCompleted（payload 空，无法
 * 区分取消，interrupted 维持 unsupported；UI 回 ready 即可）。
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
  agentTypeFields?: readonly string[];
  matcher?: string;
  nativeStateFields?: readonly string[];
  nativeStatePaths?: readonly string[];
  nativeEvent: string;
  pierEvent: Exclude<
    AgentHookEventPayloadV3["event"],
    "InteractionRequested" | "InteractionResolved"
  >;
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

function buildKimiHooksBlock(): string {
  const lines: string[] = [];
  for (const event of KIMI_HOOK_EVENTS) {
    const command = pierHookCommandV3WithStdin({
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

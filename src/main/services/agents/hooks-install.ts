import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  chmod,
  lstat,
  mkdir,
  readFile,
  readlink,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  type AgentHooksInstallLockOptions,
  withAgentHooksInstallLock,
} from "./hooks-install-lock.ts";
import { buildExtractStdinMetaScript } from "./hooks-stdin-script.ts";
import {
  buildDeriveClaudeSessionTitleScript,
  PIER_HOOK_COMMAND_GENERATION,
} from "./hooks-title-script.ts";

export {
  AgentHooksInstallLockBusy,
  type AgentHooksInstallLockOptions,
  withAgentHooksInstallLock,
} from "./hooks-install-lock.ts";
export { buildExtractStdinMetaScript } from "./hooks-stdin-script.ts";
export {
  buildDeriveClaudeSessionTitleScript,
  PIER_HOOK_COMMAND_GENERATION,
} from "./hooks-title-script.ts";

/**
 * 实例私有事件日志目录名（相对 userData）。
 * 仅 events.jsonl / offset 落在此；可执行 hook 脚本不在此（见 pierHooksHomeDir）。
 */
export const AGENT_HOOKS_DIR_NAME = "agent-hooks";

/** emit 脚本文件名。 */
export const EMIT_SCRIPT_NAME = "emit";

/**
 * stdin → metadataBase64 提取脚本（含 promptSnippet）。
 * hooks.json 经 `${PIER_AGENT_HOOKS_DIR}/extract-stdin-meta` 调用。
 */
export const EXTRACT_STDIN_META_SCRIPT_NAME = "extract-stdin-meta";

/**
 * Claude UserPromptSubmit 会话标题派生脚本。
 * hooks.json 只引用 `${PIER_AGENT_HOOKS_DIR}/derive-claude-session-title`。
 */
export const DERIVE_CLAUDE_SESSION_TITLE_SCRIPT_NAME =
  "derive-claude-session-title";

/** events.jsonl 文件名（实例私有，在 userData/agent-hooks/）。 */
export const EVENTS_JSONL_NAME = "events.jsonl";

/** 用户级共享 hooks 运行时根：`~/.pier/hooks`。 */
export const PIER_HOOKS_HOME_SEGMENTS = [".pier", "hooks"] as const;

/** 世代指针文件名（内容为十进制世代号）。 */
export const PIER_HOOKS_GENERATION_FILE = "GENERATION";

/** 当前运行时 symlink 名 → `v{N}`。 */
export const PIER_HOOKS_CURRENT_NAME = "current";

/**
 * emit 脚本内容——保留 v1 / v2 位置参数，并为新配置提供严格 v3 发射。
 *
 * 位置参数：
 * - `$1` = kind（commandStart | commandFinished | agentEvent | agentEventV2 |
 *   agentEventV3）
 * - commandStart: `$2` = 命令行文本
 * - commandFinished: `$2` = 退出码（整数字符串）
 * - agentEvent（旧协议）: `$2` = agent id，`$3` = pierEvent 名，`$4..$11`
 *   为身份字段；继续写 v1，保证升级期间旧配置调用新脚本不发生参数错位。
 * - agentEventV2: `$2` = agent id，`$3` = pierEvent 名，`$4` = 原生事件名，
 *   `$5..$12` 依次为
 *   sessionId / turnId / toolUseId / toolName / agentInstanceId / agentType /
 *   transcriptPath / 已筛选身份元数据的 base64（均可为空，不含 prompt/tool input）。
 * - agentEventV3: `$2..$12` 与 v2 相同；`$13..$19` 依次为
 *   parentSessionId / actorHint / nativeState / interactionId /
 *   interactionKind / interactionOutcome / promptSnippet。
 *   可选字段为空时不写入 JSON，避免空字符串绕过严格 v3 schema。
 *
 * 要点：
 * - PIER_PANEL_ID / PIER_WINDOW_ID 缺失时 exit 0（非 Pier 启动的 agent 静默跳过）
 * - macOS 默认 date 不支持 %N，fallback 到 %s000000000
 * - `_var` 下划线前缀避免污染宿主 shell 变量命名空间
 * - 未知 kind → case 无匹配 → 静默 no-op
 *
 * commandStart 命令行清洗（避免破坏 JSONL 行结构）：
 *   1. `head -c 4096` 先按原文截断（避免 escape 后再截切在 `\"` 中间造成孤立 `\`）
 *   2. `LC_ALL=C tr -d '\000-\037\177'` 剥掉所有 C0 控制字符（含 \t \n \r 与 NUL 与 DEL）
 *      —— cmdline 里带真实换行会让 observer 按 `\n` split 拆行，破坏 JSON 结构。
 *      语义损失（多行命令折成一行）可接受：cmdline 只用于显示。
 *   3. `sed 's/\\/\\\\/g; s/"/\\"/g'` 转义 `\` 与 `"` 以嵌入 JSON string。
 */
const EMIT_SCRIPT = `#!/bin/sh
[ -z "$PIER_PANEL_ID" ] && exit 0
[ -z "$PIER_WINDOW_ID" ] && exit 0
[ -z "$PIER_AGENT_EVENT_LOG" ] && PIER_AGENT_EVENT_LOG="\${HOME}/.pier/agent-events.jsonl"
mkdir -p "$(dirname "$PIER_AGENT_EVENT_LOG")"
_ts=$(date +%s%N 2>/dev/null || date +%s000000000)
_lock="\${PIER_AGENT_EVENT_LOG}.lock"
_lock_token="$$.$_ts"
_lock_candidate="$_lock.$_lock_token"
printf '%s' "$_lock_token" > "$_lock_candidate" || exit 0
_lock_attempt=0
while ! ln "$_lock_candidate" "$_lock" 2>/dev/null; do
  _lock_attempt=$((_lock_attempt + 1))
  if [ "$_lock_attempt" -ge 500 ]; then
    rm -f "$_lock_candidate"
    exit 0
  fi
  sleep 0.01
done
rm -f "$_lock_candidate"
trap '[ "$(cat "$_lock" 2>/dev/null || true)" = "$_lock_token" ] && rm -f "$_lock"; rm -f "$_lock_candidate"' EXIT HUP INT TERM
_pier_json_string() {
  printf '%s' "$1" | head -c "$2" | iconv -c -f UTF-8 -t UTF-8 2>/dev/null | LC_ALL=C tr -d '\\000-\\037\\177' | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g'
}
case "$1" in
  commandStart)
    _cmd=$(printf '%s' "$2" | head -c 4096 | LC_ALL=C tr -d '\\000-\\037\\177' | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')
    printf '{"v":1,"kind":"commandStart","ts":%s,"panelId":"%s","windowId":"%s","pid":%s,"commandLine":"%s"}\\n' \\
      "$_ts" "$PIER_PANEL_ID" "$PIER_WINDOW_ID" "$$" "$_cmd" >> "$PIER_AGENT_EVENT_LOG"
    ;;
  commandFinished)
    printf '{"v":1,"kind":"commandFinished","ts":%s,"panelId":"%s","windowId":"%s","pid":%s,"exitCode":%s}\\n' \\
      "$_ts" "$PIER_PANEL_ID" "$PIER_WINDOW_ID" "$$" "$2" >> "$PIER_AGENT_EVENT_LOG"
    ;;
  agentEvent)
    _sid=$(printf '%s' "$4" | head -c 128 | LC_ALL=C tr -d '\\000-\\037\\177' | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')
    _turn=$(printf '%s' "$5" | head -c 128 | LC_ALL=C tr -d '\\000-\\037\\177' | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')
    _tool_id=$(printf '%s' "$6" | head -c 128 | LC_ALL=C tr -d '\\000-\\037\\177' | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')
    _tool_name=$(printf '%s' "$7" | head -c 256 | LC_ALL=C tr -d '\\000-\\037\\177' | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')
    _agent_instance=$(printf '%s' "$8" | head -c 128 | LC_ALL=C tr -d '\\000-\\037\\177' | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')
    _agent_type=$(printf '%s' "$9" | head -c 128 | LC_ALL=C tr -d '\\000-\\037\\177' | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')
    _transcript=$(printf '%s' "\${10}" | head -c 8192 | LC_ALL=C tr -d '\\000-\\037\\177' | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')
    _metadata_b64=$(printf '%s' "\${11}" | head -c 16384 | LC_ALL=C tr -cd 'A-Za-z0-9+/=')
    printf '{"v":1,"kind":"agentEvent","ts":%s,"panelId":"%s","windowId":"%s","pid":%s,"agent":"%s","event":"%s","sessionId":"%s","turnId":"%s","toolUseId":"%s","toolName":"%s","agentInstanceId":"%s","agentType":"%s","transcriptPath":"%s","metadataBase64":"%s"}\\n' \\
      "$_ts" "$PIER_PANEL_ID" "$PIER_WINDOW_ID" "$$" "$2" "$3" "$_sid" "$_turn" "$_tool_id" "$_tool_name" "$_agent_instance" "$_agent_type" "$_transcript" "$_metadata_b64" >> "$PIER_AGENT_EVENT_LOG"
    ;;
  agentEventV2)
    _native=$(printf '%s' "$4" | head -c 128 | LC_ALL=C tr -d '\\000-\\037\\177' | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')
    _sid=$(printf '%s' "$5" | head -c 128 | LC_ALL=C tr -d '\\000-\\037\\177' | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')
    _turn=$(printf '%s' "$6" | head -c 128 | LC_ALL=C tr -d '\\000-\\037\\177' | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')
    _tool_id=$(printf '%s' "$7" | head -c 128 | LC_ALL=C tr -d '\\000-\\037\\177' | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')
    _tool_name=$(printf '%s' "$8" | head -c 256 | LC_ALL=C tr -d '\\000-\\037\\177' | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')
    _agent_instance=$(printf '%s' "$9" | head -c 128 | LC_ALL=C tr -d '\\000-\\037\\177' | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')
    _agent_type=$(printf '%s' "\${10}" | head -c 128 | LC_ALL=C tr -d '\\000-\\037\\177' | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')
    _transcript=$(printf '%s' "\${11}" | head -c 8192 | LC_ALL=C tr -d '\\000-\\037\\177' | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')
    _metadata_b64=$(printf '%s' "\${12}" | head -c 16384 | LC_ALL=C tr -cd 'A-Za-z0-9+/=')
    printf '{"v":2,"kind":"agentEvent","ts":%s,"panelId":"%s","windowId":"%s","pid":%s,"agent":"%s","event":"%s","nativeEvent":"%s","sessionId":"%s","turnId":"%s","toolUseId":"%s","toolName":"%s","agentInstanceId":"%s","agentType":"%s","transcriptPath":"%s","metadataBase64":"%s"}\\n' \\
      "$_ts" "$PIER_PANEL_ID" "$PIER_WINDOW_ID" "$$" "$2" "$3" "$_native" "$_sid" "$_turn" "$_tool_id" "$_tool_name" "$_agent_instance" "$_agent_type" "$_transcript" "$_metadata_b64" >> "$PIER_AGENT_EVENT_LOG"
    ;;
  agentEventV3)
    _agent=$(_pier_json_string "$2" 64)
    _event=$(_pier_json_string "$3" 64)
    _native=$(_pier_json_string "$4" 128)
    _sid=$(_pier_json_string "$5" 128)
    _turn=$(_pier_json_string "$6" 128)
    _tool_id=$(_pier_json_string "$7" 128)
    _tool_name=$(_pier_json_string "$8" 256)
    _agent_instance=$(_pier_json_string "$9" 128)
    _agent_type=$(_pier_json_string "\${10}" 128)
    _transcript=$(_pier_json_string "\${11}" 8192)
    _metadata_b64=$(printf '%s' "\${12}" | head -c 16384 | LC_ALL=C tr -cd 'A-Za-z0-9+/=')
    _parent_sid=$(_pier_json_string "\${13}" 128)
    _actor_hint=$(_pier_json_string "\${14}" 16)
    _native_state=$(_pier_json_string "\${15}" 64)
    _interaction_id=$(_pier_json_string "\${16}" 128)
    _interaction_kind=$(_pier_json_string "\${17}" 32)
    _interaction_outcome=$(_pier_json_string "\${18}" 32)
    _prompt_snippet=$(_pier_json_string "\${19}" 512)
    _json=$(printf '{"v":3,"kind":"agentEvent","ts":%s,"panelId":"%s","windowId":"%s","pid":%s,"agent":"%s","event":"%s","nativeEvent":"%s"' \\
      "$_ts" "$PIER_PANEL_ID" "$PIER_WINDOW_ID" "$$" "$_agent" "$_event" "$_native")
    [ -n "$_sid" ] && _json="\${_json},\\"sessionId\\":\\"\${_sid}\\""
    [ -n "$_turn" ] && _json="\${_json},\\"turnId\\":\\"\${_turn}\\""
    [ -n "$_tool_id" ] && _json="\${_json},\\"toolUseId\\":\\"\${_tool_id}\\""
    [ -n "$_tool_name" ] && _json="\${_json},\\"toolName\\":\\"\${_tool_name}\\""
    [ -n "$_agent_instance" ] && _json="\${_json},\\"agentInstanceId\\":\\"\${_agent_instance}\\""
    [ -n "$_agent_type" ] && _json="\${_json},\\"agentType\\":\\"\${_agent_type}\\""
    [ -n "$_transcript" ] && _json="\${_json},\\"transcriptPath\\":\\"\${_transcript}\\""
    [ -n "$_metadata_b64" ] && _json="\${_json},\\"metadataBase64\\":\\"\${_metadata_b64}\\""
    [ -n "$_parent_sid" ] && _json="\${_json},\\"parentSessionId\\":\\"\${_parent_sid}\\""
    [ -n "$_actor_hint" ] && _json="\${_json},\\"actorHint\\":\\"\${_actor_hint}\\""
    [ -n "$_native_state" ] && _json="\${_json},\\"nativeState\\":\\"\${_native_state}\\""
    case "$3" in
      InteractionRequested)
        [ -n "$_interaction_id" ] && _json="\${_json},\\"interactionId\\":\\"\${_interaction_id}\\""
        [ -n "$_interaction_kind" ] && _json="\${_json},\\"interactionKind\\":\\"\${_interaction_kind}\\""
        ;;
      InteractionResolved)
        [ -n "$_interaction_id" ] && _json="\${_json},\\"interactionId\\":\\"\${_interaction_id}\\""
        [ -n "$_interaction_kind" ] && _json="\${_json},\\"interactionKind\\":\\"\${_interaction_kind}\\""
        [ -n "$_interaction_outcome" ] && _json="\${_json},\\"interactionOutcome\\":\\"\${_interaction_outcome}\\""
        ;;
    esac
    [ -n "$_prompt_snippet" ] && _json="\${_json},\\"promptSnippet\\":\\"\${_prompt_snippet}\\""
    printf '%s}\\n' "$_json" >> "$PIER_AGENT_EVENT_LOG"
    ;;
esac
[ "$(cat "$_lock" 2>/dev/null || true)" = "$_lock_token" ] && rm -f "$_lock"
trap - EXIT HUP INT TERM
`;

export interface InstallAgentHooksOptions {
  /**
   * 共享运行时根目录。默认 `~/.pier/hooks`。
   * 测试可注入临时目录，避免污染开发机 home。
   */
  hooksHome?: string;
  /** 安装锁策略；仅测试注入 delay/时钟，生产使用默认跨进程文件锁。 */
  lockOptions?: AgentHooksInstallLockOptions;
}

export type InstallAgentHooksResult = "installed" | "skipped-newer";

/** 用户级共享 hooks 运行时根目录。 */
export function pierHooksHomeDir(home: string = homedir()): string {
  return join(home, ...PIER_HOOKS_HOME_SEGMENTS);
}

/** `current` 目录（symlink 到 `v{N}`）；PTY 的 PIER_AGENT_HOOKS_DIR 指向此路径。 */
export function pierHooksCurrentDir(
  hooksHome: string = pierHooksHomeDir()
): string {
  return join(hooksHome, PIER_HOOKS_CURRENT_NAME);
}

/** 版本化运行时目录 `…/v{N}`。 */
export function pierHooksVersionDir(
  generation: number,
  hooksHome: string = pierHooksHomeDir()
): string {
  return join(hooksHome, `v${generation}`);
}

/**
 * 实例私有 agent-hooks 目录（仅事件日志等）。
 * 可执行脚本请用 pierHooksCurrentDir / emitScriptPath(hooksHome)。
 */
export function agentHooksDir(userData: string): string {
  return join(userData, AGENT_HOOKS_DIR_NAME);
}

/** emit 脚本路径（经 current）。 */
export function emitScriptPath(hooksHome: string = pierHooksHomeDir()): string {
  return join(pierHooksCurrentDir(hooksHome), EMIT_SCRIPT_NAME);
}

/** extract-stdin-meta 路径（经 current）。 */
export function extractStdinMetaScriptPath(
  hooksHome: string = pierHooksHomeDir()
): string {
  return join(pierHooksCurrentDir(hooksHome), EXTRACT_STDIN_META_SCRIPT_NAME);
}

/** derive-claude-session-title 路径（经 current）。 */
export function deriveClaudeSessionTitleScriptPath(
  hooksHome: string = pierHooksHomeDir()
): string {
  return join(
    pierHooksCurrentDir(hooksHome),
    DERIVE_CLAUDE_SESSION_TITLE_SCRIPT_NAME
  );
}

/** 返回实例私有 events.jsonl 绝对路径。 */
export function eventsJsonlPath(userData: string): string {
  return join(agentHooksDir(userData), EVENTS_JSONL_NAME);
}

/** 读取磁盘上已安装的共享运行时世代；缺失/损坏 → 0。 */
export async function readInstalledHookRuntimeGeneration(
  hooksHome: string = pierHooksHomeDir()
): Promise<number> {
  const [generationFile, currentTarget] = await Promise.all([
    readFile(join(hooksHome, PIER_HOOKS_GENERATION_FILE), "utf8").catch(
      () => ""
    ),
    readlink(pierHooksCurrentDir(hooksHome)).catch(() => ""),
  ]);
  const generationValue = Number(generationFile.trim());
  const generation =
    Number.isFinite(generationValue) && generationValue > 0
      ? Math.floor(generationValue)
      : 0;
  const currentMatch = /^v(\d+)$/.exec(currentTarget);
  const current = currentMatch ? Number(currentMatch[1]) : 0;
  // current 先于 GENERATION 发布；崩溃窗口内取两者最大值，旧进程也不能回退。
  return Math.max(generation, current);
}

async function atomicWrite(
  path: string,
  body: string,
  mode?: number
): Promise<void> {
  const staging = `${path}.tmp.${process.pid}.${randomUUID()}`;
  try {
    await writeFile(staging, body, mode === undefined ? "utf8" : { mode });
    if (mode !== undefined) {
      await chmod(staging, mode);
    }
    await rename(staging, path);
  } finally {
    await rm(staging, { force: true });
  }
}

/** 内容相同则跳过字节写入，但仍确保 +x（同 gen 多实例 / 自愈可恢复权限）。 */
async function writeExecutableIfChanged(
  path: string,
  body: string
): Promise<void> {
  try {
    const existing = await readFile(path, "utf8");
    if (existing === body) {
      await chmod(path, 0o755);
      return;
    }
  } catch {
    // missing → write
  }
  await atomicWrite(path, body, 0o755);
}

async function assertRuntimeFileReady(
  path: string,
  expectedBody: string
): Promise<void> {
  const [actualBody, fileStat] = await Promise.all([
    readFile(path, "utf8"),
    stat(path),
    access(path, constants.X_OK),
  ]);
  if (actualBody !== expectedBody || !fileStat.isFile()) {
    throw new Error(`agent hook runtime file is incomplete: ${path}`);
  }
}

/**
 * 将 `current` 原子切换为指向相对目标（如 `v5`）。
 * staging + rename，避免半更新。
 */
export async function atomicReplaceSymlink(
  linkPath: string,
  relativeTarget: string
): Promise<void> {
  const staging = `${linkPath}.tmp.${process.pid}.${Date.now()}`;
  await symlink(relativeTarget, staging);
  try {
    await rename(staging, linkPath);
  } catch {
    // 目标若为非空目录等无法 rename 覆盖，先移除再换。
    await rm(linkPath, { force: true, recursive: true });
    await rename(staging, linkPath);
  }
}

/**
 * 安装共享 hook 运行时 + 确保实例事件日志目录存在。
 *
 * 布局：
 * ```
 * ~/.pier/hooks/
 *   GENERATION          # 当前世代
 *   v6/emit             # 纯 shell
 *   v6/extract-…        # #!/usr/bin/env node（无 Electron 路径）
 *   v6/derive-…         # #!/usr/bin/env node
 *   current → v6        # PTY 注入 PIER_AGENT_HOOKS_DIR
 * {userData}/agent-hooks/events.jsonl   # 实例私有日志
 * ```
 *
 * 只前进规则：
 * - 磁盘世代 > 本进程 → 跳过（旧客户端不得降级）
 * - 磁盘世代 < 本进程 → 写入 `v{本世代}`、切换 current、更新 GENERATION
 * - 磁盘世代 == 本进程 → 仅当脚本内容变化时重写（同 gen 多实例内容相同则零 IO）
 */
async function installAgentHooksRuntimeUnderLock(
  hooksHome: string
): Promise<InstallAgentHooksResult> {
  const gen = PIER_HOOK_COMMAND_GENERATION;
  const installedUnderLock =
    await readInstalledHookRuntimeGeneration(hooksHome);
  if (installedUnderLock > gen) {
    return "skipped-newer";
  }

  const versionDir = pierHooksVersionDir(gen, hooksHome);
  await mkdir(versionDir, { recursive: true });

  const extractBody = buildExtractStdinMetaScript();
  const deriveBody = buildDeriveClaudeSessionTitleScript();
  await writeExecutableIfChanged(
    join(versionDir, EMIT_SCRIPT_NAME),
    EMIT_SCRIPT
  );
  await writeExecutableIfChanged(
    join(versionDir, EXTRACT_STDIN_META_SCRIPT_NAME),
    extractBody
  );
  await writeExecutableIfChanged(
    join(versionDir, DERIVE_CLAUDE_SESSION_TITLE_SCRIPT_NAME),
    deriveBody
  );

  // 所有脚本内容与执行位完整后，才允许发布 current/GENERATION。
  await Promise.all([
    assertRuntimeFileReady(join(versionDir, EMIT_SCRIPT_NAME), EMIT_SCRIPT),
    assertRuntimeFileReady(
      join(versionDir, EXTRACT_STDIN_META_SCRIPT_NAME),
      extractBody
    ),
    assertRuntimeFileReady(
      join(versionDir, DERIVE_CLAUDE_SESSION_TITLE_SCRIPT_NAME),
      deriveBody
    ),
  ]);

  await atomicReplaceSymlink(pierHooksCurrentDir(hooksHome), `v${gen}`);
  if (installedUnderLock !== gen) {
    await atomicWrite(join(hooksHome, PIER_HOOKS_GENERATION_FILE), `${gen}\n`);
  }
  return "installed";
}

/**
 * 在共享运行时安装锁内完成 runtime 发布与依赖它的后续操作。
 * callback 仅在本进程世代仍可写时执行，且直到 callback 完成才释放锁。
 */
export async function withInstalledAgentHooksRuntime(
  userData: string,
  operation: () => Promise<void>,
  options: InstallAgentHooksOptions = {}
): Promise<InstallAgentHooksResult> {
  const hooksHome = options.hooksHome ?? pierHooksHomeDir();
  const gen = PIER_HOOK_COMMAND_GENERATION;

  // 实例私有日志目录（observer / PIER_AGENT_EVENT_LOG）
  await mkdir(agentHooksDir(userData), { recursive: true });

  const installed = await readInstalledHookRuntimeGeneration(hooksHome);
  if (installed > gen) {
    return "skipped-newer";
  }

  return await withAgentHooksInstallLock(
    hooksHome,
    async () => {
      // 跨进程等待后必须重读：等待期间可能已有更高世代完成发布。
      const runtimeResult = await installAgentHooksRuntimeUnderLock(hooksHome);
      if (runtimeResult === "skipped-newer") {
        return runtimeResult;
      }
      await operation();
      return runtimeResult;
    },
    options.lockOptions
  );
}

export async function installAgentHooksEmitScript(
  userData: string,
  options: InstallAgentHooksOptions = {}
): Promise<InstallAgentHooksResult> {
  return await withInstalledAgentHooksRuntime(
    userData,
    async () => undefined,
    options
  );
}

/** 测试/诊断：current 是否为指向 vN 的 symlink。 */
export async function isPierHooksCurrentSymlink(
  hooksHome: string = pierHooksHomeDir()
): Promise<boolean> {
  try {
    const st = await lstat(pierHooksCurrentDir(hooksHome));
    return st.isSymbolicLink();
  } catch {
    return false;
  }
}

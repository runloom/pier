import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * emit 脚本安装目录名（相对 userData）。
 * hooks.json command 模板、PTY env、observer 均引用此常量。
 */
export const AGENT_HOOKS_DIR_NAME = "agent-hooks";

/** emit 脚本文件名。 */
export const EMIT_SCRIPT_NAME = "emit";

/**
 * stdin → metadataBase64 提取脚本（含 promptSnippet）。
 * hooks.json 经 `${PIER_AGENT_HOOKS_DIR}/extract-stdin-meta` 调用，能力跟
 * **当前 Pier 的 userData** 走，避免全局 hooks 被旧 worktree 覆盖后丢命名字段。
 */
export const EXTRACT_STDIN_META_SCRIPT_NAME = "extract-stdin-meta";

/** events.jsonl 文件名。 */
export const EVENTS_JSONL_NAME = "events.jsonl";

/**
 * hooks 命令世代：嵌入 extract-stdin-meta / stdin 命令，安装时拒绝用更低世代覆盖。
 * 2 = PromptSubmit 命名所需的 prompt → promptSnippet。
 * 3 = 世代标记改为赋值（禁止 `#` 注释，避免 `;` 拼接后整行被注释掉）。
 */
export const PIER_HOOK_COMMAND_GENERATION = 3;
/**
 * emit 脚本内容——保留 v1 agentEvent，并以 agentEventV2 承载新协议。
 *
 * 位置参数：
 * - `$1` = kind（commandStart | commandFinished | agentEvent | agentEventV2）
 * - commandStart: `$2` = 命令行文本
 * - commandFinished: `$2` = 退出码（整数字符串）
 * - agentEvent（旧协议）: `$2` = agent id，`$3` = pierEvent 名，`$4..$11`
 *   为身份字段；继续写 v1，保证升级期间旧配置调用新脚本不发生参数错位。
 * - agentEventV2: `$2` = agent id，`$3` = pierEvent 名，`$4` = 原生事件名，
 *   `$5..$12` 依次为
 *   sessionId / turnId / toolUseId / toolName / agentInstanceId / agentType /
 *   transcriptPath / 已筛选身份元数据的 base64（均可为空，不含 prompt/tool input）。
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
esac
[ "$(cat "$_lock" 2>/dev/null || true)" = "$_lock_token" ] && rm -f "$_lock"
trap - EXIT HUP INT TERM
`;

/** 返回 agent-hooks 目录绝对路径。 */
export function agentHooksDir(userData: string): string {
  return join(userData, AGENT_HOOKS_DIR_NAME);
}

/** 返回 emit 脚本绝对路径。 */
export function emitScriptPath(userData: string): string {
  return join(agentHooksDir(userData), EMIT_SCRIPT_NAME);
}

/** 返回 extract-stdin-meta 脚本绝对路径。 */
export function extractStdinMetaScriptPath(userData: string): string {
  return join(agentHooksDir(userData), EXTRACT_STDIN_META_SCRIPT_NAME);
}

/** 返回 events.jsonl 绝对路径。 */
export function eventsJsonlPath(userData: string): string {
  return join(agentHooksDir(userData), EVENTS_JSONL_NAME);
}

function shellDoubleQuote(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("$", "\\$")
    .replaceAll("`", "\\`");
}

/**
 * 安装期生成 extract-stdin-meta：用当前 Electron 以 node 模式跑内联提取。
 * 输出：stdin JSON → stdout base64(metadata)，含 promptSnippet（≤512）。
 */
export function buildExtractStdinMetaScript(
  electronExecutable: string = process.execPath
): string {
  const nodeExecutable = shellDoubleQuote(electronExecutable);
  // JS 内避免单引号，便于包进 sh -e '...'。
  const extractJs =
    'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const p=JSON.parse(s),o={};for(const k of ["session_id","sessionId","turn_id","tool_use_id","tool_name","agent_id","agent_type","transcript_path"])if(typeof p[k]==="string")o[k]=p[k];const prompt=[p.prompt,p.user_prompt,p.content,p.message].find(v=>typeof v==="string");if(typeof prompt==="string"&&prompt.trim())o.promptSnippet=prompt.slice(0,512);process.stdout.write(Buffer.from(JSON.stringify(o)).toString("base64"))}catch{}})';
  return `#!/bin/sh
# pier-hook-gen=${PIER_HOOK_COMMAND_GENERATION}
ELECTRON_RUN_AS_NODE=1 "${nodeExecutable}" -e '${extractJs}'
`;
}

/**
 * 幂等安装 emit + extract-stdin-meta 到 `${userData}/agent-hooks/`。
 * 每次启动覆盖写入（内容随版本演进），chmod 755。
 */
export async function installAgentHooksEmitScript(
  userData: string
): Promise<void> {
  const dir = agentHooksDir(userData);
  await mkdir(dir, { recursive: true });
  await writeFile(emitScriptPath(userData), EMIT_SCRIPT, { mode: 0o755 });
  await writeFile(
    extractStdinMetaScriptPath(userData),
    buildExtractStdinMetaScript(),
    { mode: 0o755 }
  );
}

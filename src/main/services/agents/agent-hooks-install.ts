import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * emit 脚本安装目录名（相对 userData）。
 * hooks.json command 模板、PTY env、observer 均引用此常量。
 */
export const AGENT_HOOKS_DIR_NAME = "agent-hooks";

/** emit 脚本文件名。 */
export const EMIT_SCRIPT_NAME = "emit";

/** events.jsonl 文件名。 */
export const EVENTS_JSONL_NAME = "events.jsonl";

/**
 * emit 脚本内容——spec §4.4 三 kind 模板（commandStart / commandFinished / agentEvent）。
 *
 * 位置参数：
 * - `$1` = kind（commandStart | commandFinished | agentEvent）
 * - commandStart: `$2` = 命令行文本（反斜杠双转义 + 双引号转义 + 4096 截断）
 * - commandFinished: `$2` = 退出码（整数字符串）
 * - agentEvent: `$2` = agent id，`$3` = pierEvent 名
 *
 * 要点：
 * - PIER_PANEL_ID / PIER_WINDOW_ID 缺失时 exit 0（非 Pier 启动的 agent 静默跳过）
 * - macOS 默认 date 不支持 %N，fallback 到 %s000000000
 * - `_var` 下划线前缀避免污染宿主 shell 变量命名空间
 * - 未知 kind → case 无匹配 → 静默 no-op
 */
const EMIT_SCRIPT = `#!/bin/sh
[ -z "$PIER_PANEL_ID" ] && exit 0
[ -z "$PIER_WINDOW_ID" ] && exit 0
[ -z "$PIER_AGENT_EVENT_LOG" ] && PIER_AGENT_EVENT_LOG="\${HOME}/.pier/agent-events.jsonl"
mkdir -p "$(dirname "$PIER_AGENT_EVENT_LOG")"
_ts=$(date +%s%N 2>/dev/null || date +%s000000000)
case "$1" in
  commandStart)
    _cmd=$(printf '%s' "$2" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g' | head -c 4096)
    printf '{"v":1,"kind":"commandStart","ts":%s,"panelId":"%s","windowId":"%s","pid":%s,"commandLine":"%s"}\\n' \\
      "$_ts" "$PIER_PANEL_ID" "$PIER_WINDOW_ID" "$$" "$_cmd" >> "$PIER_AGENT_EVENT_LOG"
    ;;
  commandFinished)
    printf '{"v":1,"kind":"commandFinished","ts":%s,"panelId":"%s","windowId":"%s","pid":%s,"exitCode":%s}\\n' \\
      "$_ts" "$PIER_PANEL_ID" "$PIER_WINDOW_ID" "$$" "$2" >> "$PIER_AGENT_EVENT_LOG"
    ;;
  agentEvent)
    printf '{"v":1,"kind":"agentEvent","ts":%s,"panelId":"%s","windowId":"%s","pid":%s,"agent":"%s","event":"%s"}\\n' \\
      "$_ts" "$PIER_PANEL_ID" "$PIER_WINDOW_ID" "$$" "$2" "$3" >> "$PIER_AGENT_EVENT_LOG"
    ;;
esac
`;

/** 返回 agent-hooks 目录绝对路径。 */
export function agentHooksDir(userData: string): string {
  return join(userData, AGENT_HOOKS_DIR_NAME);
}

/** 返回 emit 脚本绝对路径。 */
export function emitScriptPath(userData: string): string {
  return join(agentHooksDir(userData), EMIT_SCRIPT_NAME);
}

/** 返回 events.jsonl 绝对路径。 */
export function eventsJsonlPath(userData: string): string {
  return join(agentHooksDir(userData), EVENTS_JSONL_NAME);
}

/**
 * 幂等安装 emit 脚本到 `${userData}/agent-hooks/emit`。
 * 每次启动覆盖写入（内容随版本演进），chmod 755。
 */
export async function installAgentHooksEmitScript(
  userData: string
): Promise<void> {
  const dir = agentHooksDir(userData);
  await mkdir(dir, { recursive: true });
  const scriptPath = emitScriptPath(userData);
  await writeFile(scriptPath, EMIT_SCRIPT, { mode: 0o755 });
}

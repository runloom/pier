import type { AgentKind } from "@shared/contracts/agent.ts";
import { PIER_HOOK_COMMAND_GENERATION } from "../agent-hooks-install.ts";

/**
 * pier hook 命令的识别标记（新格式——JSONL emit 脚本方式）。
 * hooks.json command 模板引用此环境变量名。
 */
export const PIER_AGENT_HOOKS_DIR_MARK = "PIER_AGENT_HOOKS_DIR";

/** 嵌入 hook 命令的世代标记（勿用 `#` 注释——命令经 `;` 拼成单行）。 */
export const PIER_HOOK_GEN_MARK = `pier-hook-gen=${PIER_HOOK_COMMAND_GENERATION}`;

/** 从 hook command 文本解析世代；无标记视为 1（旧 stdin 内联提取）。 */
export function pierHookCommandGeneration(command: string): number {
  const match = /pier-hook-gen=(\d+)/.exec(command);
  if (!match) {
    return 1;
  }
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : 1;
}

/**
 * 生成静态 hook 命令（spec §4.4）：通过 emit 脚本写 JSONL，取代旧版 curl。
 * PTY 注入 PIER_AGENT_HOOKS_DIR 环境变量，Pier 外启动的 agent 因变量
 * 缺失直接短路（emit 脚本内部 guard）。
 * 尾部 `|| true` 保证 hook 永远 exit 0，不干扰 agent 本体。
 *
 * 第一个位置参数固定 `agentEventV2`（emit 脚本 kind dispatch），随后是
 * agent id 与 pier 事件名——见 EMIT_SCRIPT 三 kind 契约。
 */
export function pierHookCommand(
  agentId: AgentKind,
  pierEvent: string,
  nativeEvent: string = pierEvent,
  ...payloadShellExpressions: string[]
): string {
  const payloadArgs = payloadShellExpressions
    .map((expression) => ` "${expression}"`)
    .join("");
  return (
    `[ -x "\${${PIER_AGENT_HOOKS_DIR_MARK}}/emit" ] && ` +
    `"\${${PIER_AGENT_HOOKS_DIR_MARK}}/emit" "agentEventV2" "${agentId}" "${pierEvent}" "${nativeEvent}"${payloadArgs} || true`
  );
}

/**
 * 识别 pier hook 命令。判据仅依赖 PIER_AGENT_HOOKS_DIR marker——HTTP
 * 通路整个删除后, 新旧格式收敛为单一 marker。
 */
export function isPierHookCommand(command: unknown): boolean {
  return (
    typeof command === "string" && command.includes(PIER_AGENT_HOOKS_DIR_MARK)
  );
}

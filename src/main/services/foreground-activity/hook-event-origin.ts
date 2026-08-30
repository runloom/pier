import type { AgentKind } from "@shared/contracts/agent.ts";

/**
 * hook 事件来源甄别（ctty 门）。
 *
 * 背景：从 Pier 终端启动的 GUI（如 `cursor .` 打开 Cursor IDE）继承
 * PIER_PANEL_ID / PIER_WINDOW_ID / PIER_AGENT_EVENT_LOG；IDE 内的 agent
 * 触发共享 hook 配置（`~/.cursor/hooks.json` 等 IDE/CLI 一体）时，事件
 * 会伪装成该终端面板的 agent 活动（面板凭空「思考中」，并污染 resume
 * 恢复索引）。gen16 起 v3 emit 随事件上报自身控制终端（`ps -o tty=`）。
 *
 * 判据（多模型评审后收敛）：**只拒「无控制终端（`??`/`?`）且面板未被
 * OSC 点亮为同一 agent」的事件**。
 * - GUI 进程树在 Unix 会话模型下拿不到控制终端（需 setsid+TIOCSCTTY 且
 *   GUI 会话无 tty 可拿），IDE 泄漏必然 `??` —— 主 bug 全量命中；
 * - 带任何真实 ctty 的事件（面板自身 PTY、tmux/screen pane 的 pts、
 *   嵌套终端）一律放行——不做「必须等于面板 tty」的比对，避免误杀
 *   multiplexer 内的真 agent，也去掉对面板侧 tty 解析的状态依赖
 *   （面板转移 / 非 darwin / ps 背压 全部无关）；
 * - OSC 豁免只认**命令层**（`panelCommandOwnedAgent`），不认已有 hook
 *   层——hook 层可能正是 fail-open 泄漏事件自立的，认它会把一次放行
 *   变成永久豁免；detached（无 ctty）hook 的 agent 依赖 OSC 点亮兜底；
 * - 证据不足恒放行：旧脚本 / JS 扩展系事件无 tty 字段。
 */
export function shouldRejectForeignTtyAgentEvent(args: {
  eventAgent: AgentKind;
  eventTty: string | undefined;
  oscOwnedAgent: AgentKind | null;
}): boolean {
  if (!isControllingTerminalAbsent(args.eventTty)) {
    return false;
  }
  return args.oscOwnedAgent !== args.eventAgent;
}

/** `??`（macOS ps）/ `?`（Linux ps）= emit 进程无控制终端。 */
function isControllingTerminalAbsent(tty: string | undefined): boolean {
  return tty === "??" || tty === "?";
}

/** v1/v2 事件无 tty 字段；v3 才携带。 */
export function agentEventTty(event: {
  v: 1 | 2 | 3;
  tty?: string | undefined;
}): string | undefined {
  return event.v === 3 ? event.tty : undefined;
}

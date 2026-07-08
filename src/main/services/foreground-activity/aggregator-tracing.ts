import type { AgentKind } from "@shared/contracts/agent.ts";
import type { ActivityStatus } from "@shared/contracts/foreground-activity.ts";
import { createLogger } from "@shared/logger.ts";
import type { HookLayer, HookScope } from "./entry.ts";
import { refreshHookProjection, setHookScopeStatus } from "./entry.ts";

/**
 * aggregator 模块的日志辅助函数。
 *
 * 抽出来独立模块避免 aggregator.ts 触发 file-size hard cap (500 行)。
 * 日志逻辑集中在此处便于后续调整 level / ctx 字段。
 */
const log = createLogger("foreground-activity.aggregator");

/** ingestAgentEvent 入口的 routing 日志。 */
export function logRouting(
  event: string,
  agent: AgentKind,
  panelId: string,
  hook: HookLayer | null
): void {
  log.debug("ingestAgentEvent:routing", {
    agent,
    event,
    panelId,
    found: !!hook,
    prevStatus: hook?.status,
  });
}

/** ingestAgentEvent 各 drop 路径统一日志（用 reason 区分）。 */
export function logAgentEventDropped(
  reason:
    | "suppressed-panel-cooldown"
    | "suppressed-hook-cooldown"
    | "ghost-rejected"
    | "absorbed"
    | "status-null",
  panelId: string,
  event: string,
  extra?: { frozenStatus?: ActivityStatus }
): void {
  log.debug(`ingestAgentEvent:${reason}`, {
    panelId,
    event,
    ...(extra?.frozenStatus === undefined
      ? {}
      : { frozenStatus: extra.frozenStatus }),
  });
}

/**
 * 更新 hook status 并在变化时记日志（setHookStatus 的日志包装）。
 * 抽出来避免 ingestAgentEvent 内嵌套过深触发复杂度上限。
 */
export function setHookScopeStatusWithLog(
  key: string,
  hook: HookLayer,
  scope: HookScope,
  status: ActivityStatus,
  at: number,
  agent: AgentKind
): void {
  const prevStatus = hook.status;
  setHookScopeStatus(hook, scope, status, at);
  if (prevStatus !== hook.status) {
    log.debug("hook-status-change", {
      panelId: key,
      agent,
      prev: prevStatus,
      next: hook.status,
    });
  }
}

export function refreshHookProjectionWithLog(
  key: string,
  hook: HookLayer,
  at: number,
  agent: AgentKind
): void {
  const prevStatus = hook.status;
  refreshHookProjection(hook, at);
  if (prevStatus !== hook.status) {
    log.debug("hook-status-change", {
      panelId: key,
      agent,
      prev: prevStatus,
      next: hook.status,
    });
  }
}

/** SessionEnd 清理 hook 层时记日志。 */
export function logEndHookSession(panelId: string, agent: AgentKind): void {
  log.debug("end-hook-session", { panelId, agent });
}

/** agentLaunched 异 agent 清旧 hook 时记日志。 */
export function logClearForeignHook(
  panelId: string,
  prevAgent: AgentKind,
  newAgent: AgentKind
): void {
  log.debug("agent-launched:clear-foreign-hook", {
    panelId,
    prevAgent,
    newAgent,
  });
}

/** ingestCommandFinished 退出时记日志。 */
export function logCommandFinished(panelId: string, exitCode?: number): void {
  log.debug("command-finished", {
    panelId,
    ...(exitCode === undefined ? {} : { exitCode }),
  });
}

/** ptyExited 走 task 保留路径时记日志。 */
export function logPtyExitedTaskRetain(panelId: string): void {
  log.debug("pty-exited:task-retain", { panelId });
}

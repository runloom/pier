import type { ForegroundActivity } from "@shared/contracts/foreground-activity.ts";
import type { PanelSlot } from "./entry.ts";

/**
 * slot → 对外 activity 投影（纯函数）。
 * 优先级：task > hook(可见) > agent-launch(可见) > shell。
 * hook 证据优先于 launch 先验——`fg` 覆盖 command 层后 agent 会话照常呈现;
 * launch 先验投影**不带 status**, renderer 只出品牌图标。
 */
export function projectSlot(
  panelId: string,
  slot: PanelSlot
): ForegroundActivity | null {
  const { command, hook } = slot;
  if (command?.kind === "task") {
    return {
      kind: "task",
      label: command.label,
      panelId,
      spawnedAt: command.spawnedAt,
      taskId: command.taskId,
      runId: command.runId,
      updatedAt: command.updatedAt,
      windowId: command.windowId,
    };
  }
  if (hook && !hook.hidden) {
    return {
      agentId: hook.agentId,
      kind: "agent",
      panelId,
      source: "hook",
      ...hook.identity,
      spawnedAt: hook.spawnedAt,
      ...(hook.status === undefined
        ? {}
        : { stateStartedAt: hook.stateStartedAt, status: hook.status }),
      subagentCount: hook.subagentCount,
      updatedAt: hook.updatedAt,
      windowId: hook.windowId,
      ...(slot.sessionTitle === undefined
        ? {}
        : { sessionTitle: slot.sessionTitle }),
      ...(slot.sessionTitleSource === undefined
        ? {}
        : { sessionTitleSource: slot.sessionTitleSource }),
    };
  }
  // launch 先验没有任何 hook 事实 → 不带身份字段（缺席即证据不足，
  // 消费方按主会话处理）。不得从 launch 命令行反推会话号。
  if (command?.kind === "agent-launch" && !command.hidden) {
    return {
      agentId: command.agentId,
      kind: "agent",
      panelId,
      source: "launch",
      spawnedAt: command.spawnedAt,
      subagentCount: 0,
      updatedAt: command.updatedAt,
      windowId: command.windowId,
      ...(slot.sessionTitle === undefined
        ? {}
        : { sessionTitle: slot.sessionTitle }),
      ...(slot.sessionTitleSource === undefined
        ? {}
        : { sessionTitleSource: slot.sessionTitleSource }),
    };
  }
  if (command?.kind === "shell") {
    return {
      commandLine: command.commandLine,
      kind: "shell",
      panelId,
      spawnedAt: command.spawnedAt,
      updatedAt: command.updatedAt,
      windowId: command.windowId,
    };
  }
  return null;
}

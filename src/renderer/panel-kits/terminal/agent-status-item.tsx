import { getAgentCatalogEntry } from "@shared/agent-catalog.ts";
import type {
  AgentActivity,
  ForegroundActivity,
} from "@shared/contracts/foreground-activity.ts";
import { AgentIcon } from "@/components/agent-icons/index.tsx";
import { AgentStatusLabel } from "@/components/agent-status/agent-status-label.tsx";
import { useForegroundActivityStore } from "@/stores/foreground-activity.store.ts";
import { CORE_AGENT_STATUS_ITEM_ID } from "./core-terminal-status-items.ts";
import { terminalStatusItemRegistry } from "./terminal-status-bar.tsx";

function isAgentActivity(
  activity: ForegroundActivity | undefined
): activity is AgentActivity {
  return activity?.kind === "agent";
}

/**
 * 终端状态栏 agent item —— 结构对齐 loomdesk status-bar-activity-item：
 * [品牌图标(20px 容器内 12px)] [badge 文案(11px): 状态词 (+ · N 个子代理)] [sr-only agent 名]
 * 无状态点、无 agent 名可见文本、无计时（loomdesk 的 dot 属 session-manager,
 * duration 在其状态栏 badge 中被显式忽略）。文案/shimmer 走共享 AgentStatusLabel。
 */
function AgentStatusItemView({ panelId }: { panelId: string }) {
  const activity = useForegroundActivityStore((s) => s.activities[panelId]);
  const agent = isAgentActivity(activity) ? activity : null;

  if (!agent) {
    return null;
  }
  const agentLabel =
    getAgentCatalogEntry(agent.agentId)?.label ?? agent.agentId;
  // 无 hook 证据（launch 先验）→ icon-only。
  if (agent.status === undefined) {
    return (
      <span
        className="inline-flex shrink-0 items-center gap-1"
        data-agent-status="none"
        data-testid="agent-status-item"
      >
        <span className="inline-flex size-5 shrink-0 items-center justify-center">
          <AgentIcon agentId={agent.agentId} size={12} />
        </span>
        <span className="sr-only">{agentLabel}</span>
      </span>
    );
  }

  return (
    <span
      className="inline-flex shrink-0 items-center gap-1"
      data-agent-status={agent.status}
      data-testid="agent-status-item"
    >
      <span className="inline-flex size-5 shrink-0 items-center justify-center">
        <AgentIcon agentId={agent.agentId} size={12} />
      </span>
      <AgentStatusLabel
        spawnedAt={agent.spawnedAt}
        stateStartedAt={agent.stateStartedAt}
        status={agent.status}
        subagentCount={agent.subagentCount}
      />
      <span className="sr-only">{agentLabel}</span>
    </span>
  );
}

/**
 * 注册核心 agent 状态栏 item。
 * isVisible 按面板是否有 agent kind 的 activity 门控——否则每个终端都会为空状态
 * 预留状态栏高度(违反"未启用/无 agent 时零影响")。getState 为非响应式读取;
 * 响应性由调用方(foreground-activity-bridge)在 activity key 集合变化时重新
 * register 驱动。
 *
 * id 与默认 order/alignment 来自 core-terminal-status-items.ts 声明表(单一真相源);
 * 用户覆盖(hidden/order/alignment)由合并层从 prefs 读取。
 */
export function registerAgentStatusItem(): () => void {
  return terminalStatusItemRegistry.register({
    id: CORE_AGENT_STATUS_ITEM_ID,
    isVisible: (ctx) => {
      const activity =
        useForegroundActivityStore.getState().activities[ctx.panelId];
      return activity?.kind === "agent";
    },
    render: (ctx) => <AgentStatusItemView panelId={ctx.panelId} />,
  });
}

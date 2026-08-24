import { AgentIcon } from "@plugins/api/components/agent-icons/index.tsx";
import { getAgentCatalogEntry } from "@shared/agent-catalog.ts";
import type {
  AgentActivity,
  ForegroundActivity,
} from "@shared/contracts/foreground-activity.ts";
import { AgentStatusLabel } from "@/components/agent-status/label.tsx";
import { useT } from "@/i18n/use-t.ts";
import { useForegroundActivityStore } from "@/stores/foreground-activity.store.ts";
import { CORE_AGENT_STATUS_ITEM_ID } from "../core-terminal-status-items.ts";
import { terminalStatusItemRegistry } from "../status-bar.tsx";

function isAgentActivity(
  activity: ForegroundActivity | undefined
): activity is AgentActivity {
  return activity?.kind === "agent";
}

/**
 * 终端状态栏 agent item —— 结构对齐 loomdesk status-bar-activity-item：
 * [品牌图标(20px 容器内 12px)] [badge 文案(11px): 状态词 / 启动文案 (+ · N 个子代理)]
 * [sr-only agent 名]
 * FA 为 agent 时必须可见可读：有 hook 状态走五态文案；无状态时用 catalog 名，
 * 无 catalog 时用短「启动中…」（禁止仅 icon + sr-only，也禁止直出 raw agentId）。
 * 无状态点、无计时。文案/shimmer 走共享 AgentStatusLabel。
 */
function AgentStatusItemView({ panelId }: { panelId: string }) {
  const t = useT();
  const activity = useForegroundActivityStore((s) => s.activities[panelId]);
  const agent = isAgentActivity(activity) ? activity : null;

  if (!agent) {
    return null;
  }
  const catalogLabel = getAgentCatalogEntry(agent.agentId)?.label;
  const a11yName = catalogLabel ?? agent.agentId;
  // 可见 fallback：优先 catalog 产品名；无 catalog 时用短启动文案，不直出 id。
  const fallbackLabel = catalogLabel ?? t("terminal.agentStatus.starting");
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 font-mono"
      data-agent-status={agent.status ?? "none"}
      data-testid="agent-status-item"
    >
      <span className="inline-flex size-5 shrink-0 items-center justify-center">
        <AgentIcon agentId={agent.agentId} size={12} />
      </span>
      <AgentStatusLabel
        fallbackLabel={fallbackLabel}
        status={agent.status}
        subagentCount={agent.subagentCount}
      />
      <span className="sr-only">{a11yName}</span>
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

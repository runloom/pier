import { getAgentCatalogEntry } from "@shared/agent-catalog.ts";
import { useEffect, useState } from "react";
import { AgentIcon } from "@/components/agent-icons/index.tsx";
import { useT } from "@/i18n/use-t.ts";
import { useAgentSessionStore } from "@/stores/agent-session.store.ts";
import { AgentShimmerText } from "./agent-shimmer-text.tsx";
import {
  agentStatusTextKey,
  longRunLevel,
  shouldShimmer,
  statusColorVar,
} from "./agent-status-visual.ts";
import { terminalStatusItemRegistry } from "./terminal-status-bar.tsx";

const LONG_RUN_TICK_MS = 250;

/**
 * 终端状态栏 agent item —— 结构对齐 loomdesk status-bar-activity-item：
 * [品牌图标(20px 容器内 12px)] [badge 文案(11px): 状态词 (+ · N 个子代理)] [sr-only agent 名]
 * 无状态点、无 agent 名可见文本、无计时（loomdesk 的 dot 属 session-manager,
 * duration 在其状态栏 badge 中被显式忽略）。250ms ticker 仅驱动长跑色。
 */
function AgentStatusItemView({ panelId }: { panelId: string }) {
  const t = useT();
  const session = useAgentSessionStore((s) => s.sessions[panelId]);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const shimmer = session ? shouldShimmer(session.status) : false;
  useEffect(() => {
    if (!shimmer) {
      return;
    }
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), LONG_RUN_TICK_MS);
    return () => clearInterval(id);
  }, [shimmer]);

  if (!session) {
    return null;
  }
  // ready 也可见（loomdesk："等待输入"）——item 的隐藏只由会话不存在决定。
  const level = shimmer
    ? longRunLevel(Math.max(0, nowMs - session.stateStartedAt))
    : null;
  const colorVar = statusColorVar(session.status, level);
  const label = t(agentStatusTextKey(session.status));
  const badge =
    session.subagentCount > 0
      ? `${label} · ${t("terminal.agentStatus.subagentCount", {
          count: session.subagentCount,
        })}`
      : label;
  const agentLabel = session.agentId
    ? (getAgentCatalogEntry(session.agentId)?.label ?? session.agentId)
    : "agent";

  return (
    <span
      className="inline-flex shrink-0 items-center gap-1"
      data-agent-status={session.status}
      data-testid="agent-status-item"
    >
      <span className="inline-flex size-5 shrink-0 items-center justify-center">
        <AgentIcon agentId={session.agentId} size={12} />
      </span>
      <span className="whitespace-nowrap text-[11px]" data-activity-badge>
        {shimmer ? (
          <AgentShimmerText colorVar={colorVar} text={badge} />
        ) : (
          <span data-activity-badge-text>{badge}</span>
        )}
      </span>
      <span className="sr-only">{agentLabel}</span>
    </span>
  );
}

/**
 * 注册核心 agent 状态栏 item。
 * isVisible 按面板是否存在会话门控——否则每个终端都会为空状态预留状态栏高度
 * （违反"未启用/无会话时零影响"）。getState 为非响应式读取；响应性由调用方
 * （agent-sessions-bridge）在会话 key 集合变化时重新 register 驱动。
 */
export function registerAgentStatusItem(): () => void {
  return terminalStatusItemRegistry.register({
    id: "core.agent-status",
    isVisible: (ctx) =>
      Boolean(useAgentSessionStore.getState().sessions[ctx.panelId]),
    order: -10,
    render: (ctx) => <AgentStatusItemView panelId={ctx.panelId} />,
  });
}

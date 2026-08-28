/**
 * S1 会话页：terminal.screen 前台轮询 + waiting 态审批条。
 * agentRef 组装复用 @shared makeAgentRef（windowId\0panelId），不得自造格式。
 */
import { makeAgentRef } from "@shared/contracts/agent/runtime-index.ts";
import { useEffect, useState } from "react";
import { ApprovalBar, type ApprovalKey } from "../components/approval-bar.tsx";
import { TerminalScreen } from "../components/terminal-screen.tsx";
import { TopBar } from "../components/top-bar.tsx";
import { PierMobileClientError } from "../lib/client-types.ts";
import { useHashRoute } from "../lib/routes.ts";
import { getMobileClient, refreshSnapshot } from "../lib/session.ts";
import { useMobileWebStore } from "../lib/store.ts";

export function SessionPage() {
  const route = useHashRoute();
  const snapshot = useMobileWebStore((state) => state.snapshot);
  const [stale, setStale] = useState(false);
  const [respondError, setRespondError] = useState<string | null>(null);

  const agent =
    route.page === "session"
      ? (snapshot?.agents.find((entry) => entry.agentId === route.agentId) ??
        null)
      : null;
  const activity =
    agent !== null && snapshot !== null
      ? (snapshot.activity.find(
          (entry) =>
            entry.panelId === agent.panelId && entry.windowId === agent.windowId
        ) ?? null)
      : null;
  const waiting = activity?.status === "waiting";
  const interactionId = activity?.pendingInteractionId ?? null;
  const revision = useMobileWebStore((state) => state.revision);
  // 新快照的 pendingInteractionId / revision 变化 → 旧 stale 判定过期，自动复位。
  // biome-ignore lint/correctness/useExhaustiveDependencies: 复位触发器，体不读取依赖
  useEffect(() => {
    setStale(false);
  }, [interactionId, revision]);

  if (agent === null) {
    return (
      <div className="flex min-h-dvh flex-col bg-neutral-950 text-neutral-100">
        <TopBar back={{ page: "host" }} title="会话" />
        <main className="flex flex-1 items-center justify-center px-6">
          <p className="text-center text-neutral-500 text-sm">
            会话不在当前快照中，返回工作台重试
          </p>
        </main>
      </div>
    );
  }

  const onRespond = (key: ApprovalKey) => {
    if (interactionId === null) {
      return;
    }
    setRespondError(null);
    getMobileClient()
      .command({
        agentRef: makeAgentRef(agent.windowId, agent.panelId),
        interactionId,
        key,
        type: "agent.attention.respond",
      })
      .then(() => {
        setStale(false);
      })
      .catch((error: unknown) => {
        if (
          error instanceof PierMobileClientError &&
          error.code === "interaction_stale"
        ) {
          setStale(true);
          refreshSnapshot().catch(() => undefined);
          return;
        }
        setRespondError("回写失败，请稍后重试");
      });
  };

  return (
    <div className="flex min-h-dvh flex-col bg-neutral-950 text-neutral-100">
      <TopBar back={{ page: "host" }} title={agent.agentId} />
      <TerminalScreen
        client={getMobileClient()}
        panelId={agent.panelId}
        windowId={agent.windowId}
      />
      {respondError !== null && (
        <p className="px-4 py-2 text-red-400 text-xs" role="alert">
          {respondError}
        </p>
      )}
      <ApprovalBar
        interactionId={interactionId}
        onRespond={onRespond}
        stale={stale}
        waiting={waiting === true}
      />
    </div>
  );
}

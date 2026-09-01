/**
 * S1 会话页：terminal.screen 前台轮询 + waiting 态审批条（仅智能体）。
 * 寻址按 panelId + windowId（panelId 跨窗不唯一）；深链缺 window 时须恰好一命中。
 * 变更 / 文件入口携带该会话 cwd（三面共用身份）。
 */
import { useEffect, useState } from "react";
import { ApprovalBar, type ApprovalKey } from "../components/approval-bar.tsx";
import { TerminalScreen } from "../components/terminal-screen.tsx";
import { TopBar } from "../components/top-bar.tsx";
import { PierMobileClientError } from "../lib/client-types.ts";
import { openChangesSynced } from "../lib/open-changes.ts";
import { findUniqueScoped } from "../lib/panel-scope.ts";
import {
  isTerminalComponent,
  terminalProjectionLabel,
} from "../lib/projectable-panels.ts";
import { navigate, useHashRoute } from "../lib/routes.ts";
import { getMobileClient, refreshSnapshot } from "../lib/session.ts";
import { useMobileWebStore } from "../lib/store.ts";
import { pickWorktreeCwd } from "../lib/worktree-scope.ts";

export function SessionPage() {
  const route = useHashRoute();
  const snapshot = useMobileWebStore((state) => state.snapshot);
  const [stale, setStale] = useState(false);
  const [respondError, setRespondError] = useState<string | null>(null);

  const panelId = route.page === "session" ? route.panelId : null;
  const routeWindowId = route.page === "session" ? route.windowId : undefined;
  const agent =
    panelId === null
      ? null
      : findUniqueScoped(
          snapshot?.agents ?? [],
          panelId,
          routeWindowId,
          (entry) => entry
        );
  const panel =
    panelId === null
      ? null
      : findUniqueScoped(
          snapshot?.panels ?? [],
          panelId,
          routeWindowId,
          (entry) => entry
        );
  const isPlainTerminal =
    agent === null && panel !== null && isTerminalComponent(panel.component);
  const sessionOk = agent !== null || isPlainTerminal;
  const sessionWindowId = agent?.windowId ?? panel?.windowId;

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

  const sessionCwd =
    agent?.cwd ??
    panel?.cwd ??
    panel?.canonicalPath ??
    panel?.worktreeKey ??
    pickWorktreeCwd(snapshot);
  // 与 PC 一致：变更入口只在会话目录属于 git 仓库时出现（快照 gitRoot 门控）。
  const sessionGitRoot = panel?.gitRoot ?? null;
  const title = terminalProjectionLabel({
    agentId: agent?.agentId ?? null,
    cwd: sessionCwd,
    tabShort: panel?.title,
  });

  if (!sessionOk || panelId === null) {
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
    if (interactionId === null || agent === null) {
      return;
    }
    setRespondError(null);
    getMobileClient()
      .command({
        // 裸 panelId + windowId：panelId 跨窗不唯一。
        agentRef: agent.panelId,
        interactionId,
        key,
        type: "agent.attention.respond",
        windowId: agent.windowId,
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

  const sessionOrigin =
    sessionWindowId === undefined
      ? { panelId }
      : { panelId, windowId: sessionWindowId };

  return (
    <div className="flex min-h-dvh flex-col bg-neutral-950 text-neutral-100">
      <TopBar back={{ page: "host" }} title={title} />
      <nav className="flex gap-2 border-neutral-800 border-b px-4 py-2">
        {sessionGitRoot !== null && (
          <button
            className="min-h-10 flex-1 rounded-md border border-neutral-700 text-neutral-200 text-sm active:bg-neutral-800"
            data-testid="session-nav-changes"
            onClick={() => {
              openChangesSynced(sessionGitRoot, sessionOrigin);
            }}
            type="button"
          >
            变更
          </button>
        )}
        <button
          className="min-h-10 flex-1 rounded-md border border-neutral-700 text-neutral-200 text-sm active:bg-neutral-800"
          data-testid="session-nav-files"
          onClick={() => {
            navigate({
              page: "files",
              from: sessionOrigin,
              ...(sessionCwd === null ? {} : { root: sessionCwd }),
            });
          }}
          type="button"
        >
          文件
        </button>
      </nav>
      <TerminalScreen
        client={getMobileClient()}
        panelId={panelId}
        {...(sessionWindowId === undefined
          ? {}
          : { windowId: sessionWindowId })}
      />
      {respondError !== null && (
        <p className="px-4 py-2 text-red-400 text-xs" role="alert">
          {respondError}
        </p>
      )}
      {agent !== null && (
        <ApprovalBar
          interactionId={interactionId}
          onRespond={onRespond}
          stale={stale}
          waiting={waiting === true}
        />
      )}
    </div>
  );
}

/**
 * S1 会话页：terminal.screen 前台轮询 + waiting 态审批条（仅智能体）。
 * 寻址一律按 panelId：先查 agents，未命中回退终端族 panels。
 * 变更 / 文件入口携带该会话 cwd（三面共用身份）。
 */
import { useEffect, useState } from "react";
import { ApprovalBar, type ApprovalKey } from "../components/approval-bar.tsx";
import { TerminalScreen } from "../components/terminal-screen.tsx";
import { TopBar } from "../components/top-bar.tsx";
import { PierMobileClientError } from "../lib/client-types.ts";
import { openChangesSynced } from "../lib/open-changes.ts";
import { isTerminalComponent } from "../lib/projectable-panels.ts";
import { navigate, useHashRoute } from "../lib/routes.ts";
import { getMobileClient, refreshSnapshot } from "../lib/session.ts";
import { useMobileWebStore } from "../lib/store.ts";
import { pathLeaf, pickWorktreeCwd } from "../lib/worktree-scope.ts";

export function SessionPage() {
  const route = useHashRoute();
  const snapshot = useMobileWebStore((state) => state.snapshot);
  const [stale, setStale] = useState(false);
  const [respondError, setRespondError] = useState<string | null>(null);

  const panelId = route.page === "session" ? route.panelId : null;
  const agent =
    panelId === null
      ? null
      : (snapshot?.agents.find((entry) => entry.panelId === panelId) ?? null);
  const panel =
    panelId === null
      ? null
      : (snapshot?.panels.find((entry) => entry.panelId === panelId) ?? null);
  const isPlainTerminal =
    agent === null && panel !== null && isTerminalComponent(panel.component);
  const sessionOk = agent !== null || isPlainTerminal;

  const activity =
    agent !== null && snapshot !== null
      ? (snapshot.activity.find((entry) => entry.panelId === agent.panelId) ??
        null)
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
  const title =
    agent?.agentId ??
    panel?.title ??
    (sessionCwd === null ? null : pathLeaf(sessionCwd)) ??
    "会话";

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
        // 面板寻址：裸 panelId，宿主解析当前窗口（respond 契约两形态之一）。
        agentRef: agent.panelId,
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
      <TopBar back={{ page: "host" }} title={title} />
      <nav className="flex gap-2 border-neutral-800 border-b px-4 py-2">
        {sessionGitRoot !== null && (
          <button
            className="min-h-10 flex-1 rounded-md border border-neutral-700 text-neutral-200 text-sm active:bg-neutral-800"
            data-testid="session-nav-changes"
            onClick={() => {
              openChangesSynced(sessionGitRoot);
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
            navigate(
              sessionCwd === null
                ? { page: "files" }
                : { page: "files", root: sessionCwd }
            );
          }}
          type="button"
        >
          文件
        </button>
      </nav>
      <TerminalScreen client={getMobileClient()} panelId={panelId} />
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

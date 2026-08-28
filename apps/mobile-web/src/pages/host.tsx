/**
 * H2 工作台：connect + control.watch 快照驱动。agents/activity 投影为
 * 会话列表，附 ready/processing/tool/waiting/error 状态过滤。
 */
import type { ControlSnapshotPayload } from "@shared/contracts/local-control/control-snapshot.ts";
import { type ReactNode, useMemo, useState } from "react";
import { TopBar } from "../components/top-bar.tsx";
import { navigate } from "../lib/routes.ts";
import { useMobileWebStore } from "../lib/store.ts";

type ControlSnapshot = ControlSnapshotPayload | null;

const STATUS_FILTERS = [
  "ready",
  "processing",
  "tool",
  "waiting",
  "error",
] as const;

const STATUS_FILTER_LABEL: Record<(typeof STATUS_FILTERS)[number], string> = {
  error: "错误",
  processing: "运行中",
  ready: "就绪",
  tool: "工具",
  waiting: "需要你处理",
};

export interface AgentRow {
  activityStatus: string | null;
  agentId: string;
  cwd: string | null;
  pendingInteractionId: string | null;
  worktreeKey: string | null;
}

/** agent 条目按 panelId+windowId 关联 activity 摘要（status/pendingInteractionId）。 */
export function buildAgentRows(snapshot: ControlSnapshot): AgentRow[] {
  if (snapshot === null) {
    return [];
  }
  return snapshot.agents.map((agent) => {
    const activity = snapshot.activity.find(
      (entry) =>
        entry.panelId === agent.panelId && entry.windowId === agent.windowId
    );
    return {
      activityStatus: activity?.status ?? null,
      agentId: agent.agentId,
      cwd: agent.cwd ?? null,
      pendingInteractionId: activity?.pendingInteractionId ?? null,
      worktreeKey: agent.worktreeKey ?? null,
    };
  });
}

export function HostPage() {
  const snapshot = useMobileWebStore((state) => state.snapshot);
  const revision = useMobileWebStore((state) => state.revision);
  const [filter, setFilter] = useState<(typeof STATUS_FILTERS)[number] | "all">(
    "all"
  );

  const rows = useMemo(() => buildAgentRows(snapshot), [snapshot]);
  const visible =
    filter === "all"
      ? rows
      : rows.filter((row) => row.activityStatus === filter);

  let agentList: ReactNode;
  if (snapshot === null) {
    agentList = (
      <p className="mt-8 text-center text-neutral-500 text-sm">
        等待快照…（未连接时请先在主机列表进入）
      </p>
    );
  } else if (visible.length === 0) {
    agentList = (
      <p className="mt-8 text-center text-neutral-500 text-sm">
        没有该状态的会话
      </p>
    );
  } else {
    agentList = (
      <ul className="flex flex-col gap-2">
        {visible.map((row) => (
          <li key={row.agentId}>
            <button
              className="w-full rounded border border-neutral-800 bg-neutral-900/60 p-3 text-left"
              data-testid={`agent-${row.agentId}`}
              onClick={() => {
                navigate({ agentId: row.agentId, page: "session" });
              }}
              type="button"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm">{row.agentId}</span>
                <span
                  className={`text-xs ${
                    row.activityStatus === "waiting"
                      ? "text-amber-400"
                      : "text-neutral-400"
                  }`}
                >
                  {row.activityStatus === null
                    ? "未知"
                    : (STATUS_FILTER_LABEL[
                        row.activityStatus as (typeof STATUS_FILTERS)[number]
                      ] ?? row.activityStatus)}
                </span>
              </div>
              <p className="mt-0.5 text-[10px] text-neutral-500">
                {row.worktreeKey ?? row.cwd ?? "—"}
                {row.activityStatus === "waiting" &&
                  row.pendingInteractionId !== null &&
                  " · 去处理"}
              </p>
            </button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-neutral-950 text-neutral-100">
      <TopBar back={{ page: "hosts" }} title="工作台" />
      <main className="flex flex-1 flex-col px-4 py-4">
        <p
          className="mb-3 text-neutral-500 text-xs"
          data-testid="host-revision"
        >
          快照 revision {revision}
        </p>
        <div className="mb-3 flex flex-wrap gap-2" data-testid="host-filters">
          <button
            className={`rounded-full border px-3 py-1 text-xs ${
              filter === "all"
                ? "border-emerald-600 text-emerald-400"
                : "border-neutral-700 text-neutral-400"
            }`}
            onClick={() => {
              setFilter("all");
            }}
            type="button"
          >
            全部 {rows.length}
          </button>
          {STATUS_FILTERS.map((status) => {
            const count = rows.filter(
              (row) => row.activityStatus === status
            ).length;
            return (
              <button
                className={`rounded-full border px-3 py-1 text-xs ${
                  filter === status
                    ? "border-emerald-600 text-emerald-400"
                    : "border-neutral-700 text-neutral-400"
                }`}
                key={status}
                onClick={() => {
                  setFilter(status);
                }}
                type="button"
              >
                {STATUS_FILTER_LABEL[status]} {count}
              </button>
            );
          })}
        </div>
        {agentList}
        <nav className="mt-4 flex gap-3 border-neutral-800 border-t pt-3 text-xs">
          <button
            className="text-neutral-300 underline"
            data-testid="host-nav-changes"
            onClick={() => {
              navigate({ page: "changes" });
            }}
            type="button"
          >
            变更
          </button>
          <button
            className="text-neutral-300 underline"
            data-testid="host-nav-files"
            onClick={() => {
              navigate({ page: "files" });
            }}
            type="button"
          >
            文件
          </button>
          <button
            className="text-neutral-300 underline"
            data-testid="host-nav-notifications"
            onClick={() => {
              navigate({ page: "notifications" });
            }}
            type="button"
          >
            通知
          </button>
        </nav>
      </main>
    </div>
  );
}

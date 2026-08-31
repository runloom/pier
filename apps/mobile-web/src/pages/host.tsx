/**
 * H2 工作台：可投影面板统一列表（终端 / 变更 / 文档）。
 * 状态过滤只作用于终端组；waiting 置顶。无投影协议的面板类型不列。
 */
import { type ReactNode, useMemo, useState } from "react";
import { TopBar } from "../components/top-bar.tsx";
import { openChangesSynced } from "../lib/open-changes.ts";
import {
  buildProjectableGroups,
  type ProjectablePanelRow,
} from "../lib/projectable-panels.ts";
import { navigate } from "../lib/routes.ts";
import { useMobileWebStore } from "../lib/store.ts";

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

function statusText(row: ProjectablePanelRow): string {
  if (row.group !== "terminal") {
    return row.statusLabel;
  }
  if (row.agentId === null) {
    return "终端";
  }
  if (row.activityStatus === null) {
    return "未知";
  }
  return (
    STATUS_FILTER_LABEL[
      row.activityStatus as (typeof STATUS_FILTERS)[number]
    ] ?? row.activityStatus
  );
}

function openRow(row: ProjectablePanelRow): void {
  if (row.group === "changes") {
    // PC 同步：show-or-focus 桌面审查面板后进入投影。
    openChangesSynced(row.cwd);
    return;
  }
  if (row.group === "docs") {
    const root = row.sourceRoot ?? row.cwd;
    navigate({
      page: "files",
      ...(root === null ? {} : { root }),
      ...(row.sourcePath === null ? {} : { path: row.sourcePath }),
    });
    return;
  }
  navigate({ page: "session", panelId: row.panelId });
}

function PanelList(props: { rows: ProjectablePanelRow[]; testId: string }) {
  return (
    <ul className="flex flex-col gap-2" data-testid={props.testId}>
      {props.rows.map((row) => (
        <li key={row.panelId}>
          <button
            className="w-full rounded border border-neutral-800 bg-neutral-900/60 p-3 text-left"
            data-testid={`panel-${row.panelId}`}
            onClick={() => {
              openRow(row);
            }}
            type="button"
          >
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm">{row.label}</span>
              <span
                className={`text-xs ${
                  row.activityStatus === "waiting"
                    ? "text-amber-400"
                    : "text-neutral-400"
                }`}
              >
                {statusText(row)}
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

export function HostPage() {
  const snapshot = useMobileWebStore((state) => state.snapshot);
  const revision = useMobileWebStore((state) => state.revision);
  const [filter, setFilter] = useState<(typeof STATUS_FILTERS)[number] | "all">(
    "all"
  );

  const groups = useMemo(() => buildProjectableGroups(snapshot), [snapshot]);
  const visibleTerminals =
    filter === "all"
      ? groups.terminals
      : groups.terminals.filter((row) => row.activityStatus === filter);

  let body: ReactNode;
  if (snapshot === null) {
    body = (
      <p className="mt-8 text-center text-neutral-500 text-sm">
        等待快照…（未连接时请先在主机列表进入）
      </p>
    );
  } else if (
    visibleTerminals.length === 0 &&
    groups.changes.length === 0 &&
    groups.docs.length === 0
  ) {
    body = (
      <p className="mt-8 text-center text-neutral-500 text-sm">
        {filter === "all" ? "没有可投影的面板" : "没有该状态的会话"}
      </p>
    );
  } else {
    body = (
      <div className="flex flex-col gap-6">
        {(visibleTerminals.length > 0 || groups.terminals.length > 0) && (
          <section>
            <h2 className="mb-2 text-neutral-400 text-xs">终端</h2>
            {visibleTerminals.length === 0 ? (
              <p className="text-neutral-500 text-sm">没有该状态的会话</p>
            ) : (
              <PanelList
                rows={visibleTerminals}
                testId="host-group-terminals"
              />
            )}
          </section>
        )}
        {groups.changes.length > 0 && (
          <section>
            <h2 className="mb-2 text-neutral-400 text-xs">变更</h2>
            <PanelList rows={groups.changes} testId="host-group-changes" />
          </section>
        )}
        {groups.docs.length > 0 && (
          <section>
            <h2 className="mb-2 text-neutral-400 text-xs">文档</h2>
            <PanelList rows={groups.docs} testId="host-group-docs" />
          </section>
        )}
      </div>
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
            全部 {groups.terminals.length}
          </button>
          {STATUS_FILTERS.map((status) => {
            const count = groups.terminals.filter(
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
        {body}
        <nav className="mt-4 flex gap-3 border-neutral-800 border-t pt-3 text-xs">
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

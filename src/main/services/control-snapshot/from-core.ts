/**
 * 从 PierCoreServices 构造 ControlSnapshotSources（单一接线，避免 app.snapshot 与
 * local-control 漏字段）。
 */
import type { ControlSnapshotPayload } from "@shared/contracts/local-control/control-snapshot.ts";
import type { PierCoreServices } from "../../app-core/command-router-services.ts";
import { listPanels } from "../../app-core/commands/panel.ts";
import { peekNotificationCenterService } from "../../ipc/notification-center.ts";
import type { ControlSnapshotSources } from "./service.ts";

function mapNotificationPointer(item: {
  id: string;
  kind: string;
  severity: string;
  title: string;
  read: boolean;
  ts: number;
  agentRef?: string | undefined;
  panelRef?: { panelId: string } | undefined;
}) {
  return {
    id: item.id,
    kind: item.kind,
    severity: item.severity,
    title: item.title,
    read: item.read,
    ts: item.ts,
    ...(item.agentRef ? { agentRef: item.agentRef } : {}),
    ...(item.panelRef?.panelId ? { panelId: item.panelRef.panelId } : {}),
  };
}

type WorktreeSnap = ControlSnapshotPayload["worktrees"][number];

function agentIdFromParams(
  params: Record<string, unknown> | undefined
): string | undefined {
  if (!params) {
    return;
  }
  const raw = params.agentId;
  if (typeof raw === "string" && raw.length > 0) {
    return raw;
  }
  const launch = params.launch;
  if (launch && typeof launch === "object" && !Array.isArray(launch)) {
    const nested = (launch as { agentId?: unknown }).agentId;
    if (typeof nested === "string" && nested.length > 0) {
      return nested;
    }
  }
  return;
}

function anchorPathsFromRecent(
  recent: Array<{
    projectRootPath?: string | undefined;
    gitRoot?: string | undefined;
    cwd?: string | undefined;
  }>
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const ctx of recent) {
    const anchor = ctx.projectRootPath ?? ctx.gitRoot ?? ctx.cwd;
    if (!anchor || seen.has(anchor)) {
      continue;
    }
    seen.add(anchor);
    out.push(anchor);
  }
  return out;
}

export function controlSnapshotSourcesFromCore(
  services: PierCoreServices,
  bootId: string
): ControlSnapshotSources {
  return {
    bootId,
    listAgents: () => services.agentRuntimeIndex.listMachine(),
    listWindows: () => services.window.list(),
    listPanels: async () => {
      const listed = await listPanels(
        { type: "panel.list" },
        services as never
      );
      return listed.panels.map((p) => {
        const params = p.params as Record<string, unknown> | undefined;
        const agentId = agentIdFromParams(params);
        return {
          id: p.id,
          windowId: p.windowId,
          component: p.component,
          active: p.active,
          context: p.context,
          params: agentId ? { ...params, agentId } : params,
        };
      });
    },
    listWorktrees: async () => {
      try {
        const recent = await services.panelContexts.listRecent();
        const anchors = anchorPathsFromRecent(recent);
        if (anchors.length === 0) {
          return [];
        }
        const byPath = new Map<string, WorktreeSnap>();
        for (const anchor of anchors) {
          const listed = await services.worktrees.list({ path: anchor });
          if (listed.status !== "available") {
            continue;
          }
          for (const w of listed.worktrees) {
            const key = w.canonicalPath ?? w.path;
            if (byPath.has(key)) {
              continue;
            }
            byPath.set(key, {
              path: w.path,
              ...(w.canonicalPath ? { canonicalPath: w.canonicalPath } : {}),
              ...(w.worktreeRef ? { worktreeRef: w.worktreeRef } : {}),
              isMain: w.isMain,
              branch: w.branch,
            });
          }
        }
        return [...byPath.values()];
      } catch {
        return [];
      }
    },
    listTasks: () => {
      const snap = services.tasks.runsSnapshot();
      return Object.values(snap.runs).map((r) => ({
        runId: r.runId,
        status: r.status,
        projectRootPath: r.projectRootPath,
        rootTaskId: r.rootTaskId,
      }));
    },
    listActivity: () => {
      // W5-S4：优先 FA 全貌（agent/task/shell）；缺注入时回退 Runtime Index agent 投影。
      try {
        const fa = services.foregroundActivity?.snapshot();
        if (fa) {
          return fa.activities
            .filter((a) => a.kind !== "idle")
            .map((a) => ({
              kind: a.kind,
              ...("status" in a && a.status ? { status: a.status } : {}),
              panelId: a.panelId,
              windowId: a.windowId,
            }));
        }
      } catch {
        /* fall through */
      }
      try {
        return services.agentRuntimeIndex.listMachine().entries.map((e) => ({
          kind: "agent",
          status: e.status,
          panelId: e.panelId,
          windowId: e.windowId,
        }));
      } catch {
        return [];
      }
    },
    listNotifications: () => {
      try {
        const ncs =
          services.notificationCenter ?? peekNotificationCenterService();
        if (!ncs) {
          return [];
        }
        return ncs.snapshot().items.map(mapNotificationPointer);
      } catch {
        return [];
      }
    },
    listRuntimes: () => {
      try {
        return services.controlRuntimes?.listRuntimeSummaries() ?? [];
      } catch {
        return [];
      }
    },
  };
}

/**
 * 顶层 control.snapshot 聚合器（W4-S3）。
 * 字段摘要化；不读文件/Git 内容。
 * revision 仅在业务摘要 digest 变化时递增（避免 watch 轮询伪变更）。
 */
import { createHash } from "node:crypto";
import {
  CONTROL_SNAPSHOT_NOTIFICATIONS_LIMIT,
  type ControlSnapshotPayload,
} from "@shared/contracts/local-control/control-snapshot.ts";

export interface ControlSnapshotSources {
  bootId: string;
  listActivity: () => Array<{
    kind: string;
    status?: string | undefined;
    panelId?: string | undefined;
    windowId?: string | undefined;
  }>;
  listAgents: () => {
    entries: Array<{
      agentId: string;
      panelId: string;
      windowId: string;
      status?: string | undefined;
      worktreeKey?: string | undefined;
      cwd?: string | undefined;
      projectRootPath?: string | undefined;
    }>;
  };
  listNotifications?: () => Array<{
    id: string;
    kind: string;
    severity: string;
    title: string;
    read: boolean;
    ts: number;
    panelId?: string | undefined;
    agentRef?: string | undefined;
  }>;
  listPanels: () => Promise<
    Array<{
      id: string;
      windowId: string;
      component?: string | undefined;
      active?: boolean | undefined;
      context?:
        | {
            projectRootPath?: string | undefined;
            worktreeKey?: string | undefined;
          }
        | undefined;
      params?: Record<string, unknown> | undefined;
    }>
  >;
  /** E11：RuntimeControl 精确运行摘要（可选；缺省空）。 */
  listRuntimes?: () => Array<{
    bootId: string;
    runtimeId: string;
    generation: number;
    agentId: string;
    panelId: string;
    windowId: string;
    fact: string;
    closed: boolean;
    worktreeKey?: string | undefined;
    cwd?: string | undefined;
  }>;
  listTasks: () => Array<{
    runId: string;
    status: string;
    projectRootPath: string;
    rootTaskId?: string | undefined;
  }>;
  listWindows: () => Array<{
    id: string;
    recordId?: string | undefined;
    focused?: boolean | undefined;
  }>;
  listWorktrees?: () => Promise<
    Array<{
      path: string;
      canonicalPath?: string | undefined;
      isMain?: boolean | undefined;
      branch?: string | null | undefined;
      worktreeRef?: ControlSnapshotPayload["worktrees"][number]["worktreeRef"];
    }>
  >;
  nowMs?: () => number;
}

/** 未读优先，再按 ts 新→旧，截断到 snapshot 预算。 */
export function selectSnapshotNotifications<
  T extends { read: boolean; ts: number },
>(items: readonly T[], limit = CONTROL_SNAPSHOT_NOTIFICATIONS_LIMIT): T[] {
  const sorted = [...items].sort((a, b) => {
    if (a.read !== b.read) {
      return a.read ? 1 : -1;
    }
    return b.ts - a.ts;
  });
  return sorted.slice(0, limit);
}

export interface ControlSnapshotService {
  /** 单调 revision（进程内；仅 digest 变时 +1） */
  currentRevision(): number;
  snapshot(): Promise<ControlSnapshotPayload>;
}

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

function digestBody(
  body: Omit<ControlSnapshotPayload, "revision" | "capturedAt">
): string {
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

export function createControlSnapshotService(
  sources: ControlSnapshotSources
): ControlSnapshotService {
  let revision = 0;
  let lastDigest: string | null = null;
  let chain: Promise<unknown> = Promise.resolve();
  const nowMs = sources.nowMs ?? (() => Date.now());

  async function buildSnapshot(): Promise<ControlSnapshotPayload> {
    const agents = sources.listAgents().entries.map((e) => ({
      agentId: e.agentId,
      panelId: e.panelId,
      windowId: e.windowId,
      ...(e.status ? { status: e.status } : {}),
      ...(e.worktreeKey ? { worktreeKey: e.worktreeKey } : {}),
      ...(e.cwd ? { cwd: e.cwd } : {}),
      ...(e.projectRootPath ? { projectRootPath: e.projectRootPath } : {}),
    }));
    const windows = sources.listWindows().map((w) => ({
      windowId: w.id,
      ...(w.recordId ? { recordId: w.recordId } : {}),
      ...(w.focused === undefined ? {} : { focused: w.focused }),
    }));
    const rawPanels = await sources.listPanels();
    const panels = rawPanels.map((p) => {
      const path =
        p.context?.projectRootPath ?? p.context?.worktreeKey ?? undefined;
      const agentId = agentIdFromParams(p.params);
      return {
        panelId: p.id,
        windowId: p.windowId,
        ...(p.component ? { component: p.component } : {}),
        ...(p.active === undefined ? {} : { active: p.active }),
        ...(path ? { canonicalPath: path } : {}),
        ...(p.context?.worktreeKey
          ? { worktreeKey: p.context.worktreeKey }
          : {}),
        ...(agentId ? { agentId } : {}),
      };
    });
    const worktrees = sources.listWorktrees
      ? (await sources.listWorktrees()).map((w) => ({
          path: w.path,
          ...(w.canonicalPath ? { canonicalPath: w.canonicalPath } : {}),
          ...(w.worktreeRef ? { worktreeRef: w.worktreeRef } : {}),
          ...(w.isMain === undefined ? {} : { isMain: w.isMain }),
          ...(w.branch === undefined ? {} : { branch: w.branch }),
        }))
      : [];
    const tasks = sources.listTasks().map((t) => ({
      runId: t.runId,
      status: t.status,
      projectRootPath: t.projectRootPath,
      ...(t.rootTaskId ? { rootTaskId: t.rootTaskId } : {}),
    }));
    const activity = sources.listActivity();
    const notifications = selectSnapshotNotifications(
      sources.listNotifications?.() ?? []
    ).map((n) => ({
      id: n.id,
      kind: n.kind,
      severity: n.severity,
      title: n.title,
      read: n.read,
      ts: n.ts,
      ...(n.panelId ? { panelId: n.panelId } : {}),
      ...(n.agentRef ? { agentRef: n.agentRef } : {}),
    }));
    const runtimes = (sources.listRuntimes?.() ?? []).map((r) => ({
      bootId: r.bootId,
      runtimeId: r.runtimeId,
      generation: r.generation,
      agentId: r.agentId,
      panelId: r.panelId,
      windowId: r.windowId,
      fact: r.fact,
      closed: r.closed,
      ...(r.worktreeKey ? { worktreeKey: r.worktreeKey } : {}),
      ...(r.cwd ? { cwd: r.cwd } : {}),
    }));
    const body = {
      bootId: sources.bootId,
      agents,
      activity,
      windows,
      panels,
      worktrees,
      tasks,
      notifications,
      runtimes,
    };
    const digest = digestBody(body);
    if (lastDigest === null || digest !== lastDigest) {
      revision += 1;
      lastDigest = digest;
    }
    return {
      ...body,
      revision,
      capturedAt: nowMs(),
    };
  }

  return {
    currentRevision() {
      return revision;
    },
    async snapshot() {
      // 单飞：并发 snapshot 串行，保证 revision 单调
      const run = chain.then(() => buildSnapshot());
      chain = run.then(
        () => undefined,
        () => undefined
      );
      return run;
    },
  };
}

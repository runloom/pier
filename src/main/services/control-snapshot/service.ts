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
            cwd?: string | undefined;
            gitRoot?: string | undefined;
            projectRootPath?: string | undefined;
            worktreeKey?: string | undefined;
            worktreeRoot?: string | undefined;
          }
        | undefined;
      display?: { short?: string | undefined } | undefined;
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
  /**
   * M1：waiting 态 agent 摘要附未决交互 id（审批条 interactionId 数据源）。
   * 返回 undefined → 该条目缺省字段；缺省整个解析器 → 全部缺省。
   */
  resolvePendingInteractionId?: (target: {
    panelId: string;
    windowId: string;
  }) => string | undefined;
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

const GIT_CHANGES_PANEL_COMPONENT = "pier.git.changes";
const FILES_FILE_PANEL_COMPONENT = "pier.files.filePanel";

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
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

/** files 文档面板：params.source.{kind:disk,root,path}；tab 标题只是叶子名。 */
function filesDiskSourceFromParams(
  params: Record<string, unknown> | undefined
): { sourcePath: string; sourceRoot: string } | undefined {
  if (!params) {
    return;
  }
  const source = params.source;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return;
  }
  const record = source as Record<string, unknown>;
  if (record.kind !== undefined && record.kind !== "disk") {
    return;
  }
  const rawPath = nonEmptyString(record.path);
  const rawRoot = nonEmptyString(record.root);
  if (!(rawPath && rawRoot)) {
    return;
  }
  const sourcePath = rawPath
    .replaceAll("\\", "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  const sourceRoot = rawRoot.replaceAll("\\", "/").replace(/\/+$/, "") || "/";
  if (sourcePath.length === 0) {
    return;
  }
  return { sourcePath, sourceRoot };
}

function gitRootFromReviewParams(
  params: Record<string, unknown> | undefined
): string | undefined {
  if (!params) {
    return;
  }
  const source = params.source;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return;
  }
  if (!("gitRootPath" in source)) {
    return;
  }
  return nonEmptyString(source.gitRootPath);
}

function panelPathFields(p: {
  component?: string | undefined;
  context?:
    | {
        cwd?: string | undefined;
        gitRoot?: string | undefined;
        projectRootPath?: string | undefined;
        worktreeKey?: string | undefined;
        worktreeRoot?: string | undefined;
      }
    | undefined;
  params?: Record<string, unknown> | undefined;
}): {
  canonicalPath?: string;
  cwd?: string;
  gitRoot?: string;
  sourcePath?: string;
  sourceRoot?: string;
  worktreeKey?: string;
} {
  const reviewRoot = gitRootFromReviewParams(p.params);
  const gitRoot = reviewRoot ?? p.context?.gitRoot ?? p.context?.worktreeRoot;
  const filesSource =
    p.component === FILES_FILE_PANEL_COMPONENT
      ? filesDiskSourceFromParams(p.params)
      : undefined;
  const shellCwd = p.context?.cwd;
  const cwd =
    p.component === GIT_CHANGES_PANEL_COMPONENT
      ? (gitRoot ?? shellCwd)
      : (filesSource?.sourceRoot ?? shellCwd);
  const canonicalPath =
    cwd ?? gitRoot ?? p.context?.projectRootPath ?? p.context?.worktreeKey;
  const worktreeKey = p.context?.worktreeKey ?? gitRoot;
  return {
    ...(cwd ? { cwd } : {}),
    ...(canonicalPath ? { canonicalPath } : {}),
    ...(gitRoot ? { gitRoot } : {}),
    ...(worktreeKey ? { worktreeKey } : {}),
    ...(filesSource
      ? {
          sourcePath: filesSource.sourcePath,
          sourceRoot: filesSource.sourceRoot,
        }
      : {}),
  };
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
      const agentId = agentIdFromParams(p.params);
      const title = p.display?.short;
      return {
        panelId: p.id,
        windowId: p.windowId,
        ...(p.component ? { component: p.component } : {}),
        ...(p.active === undefined ? {} : { active: p.active }),
        ...(title ? { title } : {}),
        ...panelPathFields(p),
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
    const activity = sources.listActivity().map((entry) => {
      if (
        entry.kind !== "agent" ||
        entry.status !== "waiting" ||
        !entry.panelId ||
        !entry.windowId
      ) {
        return entry;
      }
      const pendingInteractionId = sources.resolvePendingInteractionId?.({
        panelId: entry.panelId,
        windowId: entry.windowId,
      });
      return pendingInteractionId ? { ...entry, pendingInteractionId } : entry;
    });
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

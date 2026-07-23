/**
 * Agent Runtime Index — FA `kind:"agent"` 的本机投影契约。
 * 语义唯一源仍是 ForegroundActivity；本模块只做投影 / 排序 / agentRef，不自算 status。
 * @see docs/superpowers/specs/2026-07-15-agent-runtime-index-and-attention-design.md
 */
import { z } from "zod";
import { agentKindSchema } from "./agent.ts";
import {
  activityStatusSchema,
  type ForegroundActivity,
} from "./foreground-activity.ts";

const AGENT_REF_SEPARATOR = "\0";

export const agentRuntimeIndexEntrySchema = z
  .object({
    agentId: agentKindSchema,
    agentRef: z.string().min(1),
    panelId: z.string().min(1),
    source: z.enum(["hook", "launch"]),
    status: activityStatusSchema.optional(),
    stateStartedAt: z.number().int().nonnegative().optional(),
    updatedAt: z.number().int().nonnegative(),
    windowId: z.string().min(1).max(32),
    /** 尽力摘要；P1 可缺省。 */
    cwd: z.string().min(1).optional(),
    projectRootPath: z.string().min(1).optional(),
    worktreeKey: z.string().min(1).optional(),
    /** 产品会话名（透传 FA；≠ OSC）。P0 通常缺席。 */
    sessionTitle: z.string().min(1).max(40).optional(),
    sessionTitleSource: z.enum(["user", "auto"]).optional(),
  })
  .strict();

export type AgentRuntimeIndexEntry = z.infer<
  typeof agentRuntimeIndexEntrySchema
>;

export const agentRuntimeIndexSnapshotSchema = z
  .object({
    entries: z.array(agentRuntimeIndexEntrySchema),
    /** 与 FA broadcast.ts 对齐的单调序号，供 renderer 乱序守卫。 */
    ts: z.number().int().positive(),
  })
  .strict();

export type AgentRuntimeIndexSnapshot = z.infer<
  typeof agentRuntimeIndexSnapshotSchema
>;

export const agentRuntimeFocusResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ok") }).strict(),
  z.object({ status: z.literal("empty") }).strict(),
  z.object({ status: z.literal("panel_gone") }).strict(),
  z.object({ status: z.literal("window_gone") }).strict(),
  z
    .object({
      message: z.string().min(1),
      status: z.literal("error"),
    })
    .strict(),
]);

export type AgentRuntimeFocusResult = z.infer<
  typeof agentRuntimeFocusResultSchema
>;

/** 仅 main 解析；renderer / 插件不得依赖分隔符。 */
export function makeAgentRef(windowId: string, panelId: string): string {
  return `${windowId}${AGENT_REF_SEPARATOR}${panelId}`;
}

export function parseAgentRef(
  agentRef: string
): { panelId: string; windowId: string } | null {
  const sep = agentRef.indexOf(AGENT_REF_SEPARATOR);
  if (sep <= 0 || sep === agentRef.length - 1) {
    return null;
  }
  const windowId = agentRef.slice(0, sep);
  const panelId = agentRef.slice(sep + AGENT_REF_SEPARATOR.length);
  if (!(windowId && panelId)) {
    return null;
  }
  return { panelId, windowId };
}

export interface AgentIndexContextSummary {
  cwd?: string;
  projectRootPath?: string;
  worktreeKey?: string;
}

export interface ProjectAgentActivitiesOptions {
  /**
   * 尽力摘要：windowId 为 FA 的 electron windowId。
   * 不得把 context 写回 FA；lookup 失败则字段缺省。
   */
  resolveContext?(
    windowId: string,
    panelId: string
  ): AgentIndexContextSummary | null | undefined;
}

export function projectAgentActivities(
  activities: readonly ForegroundActivity[],
  options: ProjectAgentActivitiesOptions = {}
): AgentRuntimeIndexEntry[] {
  const entries: AgentRuntimeIndexEntry[] = [];
  for (const activity of activities) {
    if (activity.kind !== "agent") {
      continue;
    }
    const context = options.resolveContext?.(
      activity.windowId,
      activity.panelId
    );
    entries.push({
      agentId: activity.agentId,
      agentRef: makeAgentRef(activity.windowId, activity.panelId),
      panelId: activity.panelId,
      source: activity.source,
      updatedAt: activity.updatedAt,
      windowId: activity.windowId,
      ...(activity.status === undefined ? {} : { status: activity.status }),
      ...(activity.stateStartedAt === undefined
        ? {}
        : { stateStartedAt: activity.stateStartedAt }),
      ...(activity.sessionTitle === undefined
        ? {}
        : { sessionTitle: activity.sessionTitle }),
      ...(activity.sessionTitleSource === undefined
        ? {}
        : { sessionTitleSource: activity.sessionTitleSource }),
      ...(context?.cwd ? { cwd: context.cwd } : {}),
      ...(context?.projectRootPath
        ? { projectRootPath: context.projectRootPath }
        : {}),
      ...(context?.worktreeKey ? { worktreeKey: context.worktreeKey } : {}),
    });
  }
  return entries;
}

export type AgentIndexNeedsYouKind = "waiting" | "error";

export function isAgentIndexNeedsYou(
  status: AgentRuntimeIndexEntry["status"]
): status is AgentIndexNeedsYouKind {
  return status === "waiting" || status === "error";
}

export function isAgentIndexRunning(
  status: AgentRuntimeIndexEntry["status"]
): boolean {
  return status === undefined || status === "processing" || status === "tool";
}

function needsYouRank(status: AgentRuntimeIndexEntry["status"]): number {
  if (status === "waiting") {
    return 0;
  }
  if (status === "error") {
    return 1;
  }
  if (status === undefined || status === "processing" || status === "tool") {
    return 2;
  }
  return 3; // ready
}

export interface SortAgentIndexEntriesOptions {
  /** 当前锚点 projectRootPath；同窗内略优先。 */
  preferredProjectRootPath?: string | undefined;
  /** 当前前台 windowId；同刻度略优先。 */
  preferredWindowId?: string | undefined;
}

/**
 * Needs you → running → ready；组内 updatedAt 新→旧；
 * 可选 preferredWindowId / preferredProjectRootPath 轻微加权。
 * 唯一排序实现——main list 与 UI 预览共用。
 */
export function sortAgentIndexEntries(
  entries: readonly AgentRuntimeIndexEntry[],
  options: SortAgentIndexEntriesOptions = {}
): AgentRuntimeIndexEntry[] {
  const preferredWindowId = options.preferredWindowId;
  const preferredProjectRootPath = options.preferredProjectRootPath;
  return [...entries].sort((a, b) => {
    const rankDiff = needsYouRank(a.status) - needsYouRank(b.status);
    if (rankDiff !== 0) {
      return rankDiff;
    }
    if (b.updatedAt !== a.updatedAt) {
      return b.updatedAt - a.updatedAt;
    }
    if (preferredWindowId) {
      const aWin = a.windowId === preferredWindowId ? 0 : 1;
      const bWin = b.windowId === preferredWindowId ? 0 : 1;
      if (aWin !== bWin) {
        return aWin - bWin;
      }
    }
    if (preferredProjectRootPath) {
      const aProj = a.projectRootPath === preferredProjectRootPath ? 0 : 1;
      const bProj = b.projectRootPath === preferredProjectRootPath ? 0 : 1;
      if (aProj !== bProj) {
        return aProj - bProj;
      }
    }
    return a.agentRef.localeCompare(b.agentRef);
  });
}

/**
 * 本机 Index 计数（标题栏）。与本窗 FA `activityCounts` 有意分叉：
 * - running 含 launch（无 status）与 processing/tool
 * - needsYou 含 waiting + error
 * 本窗 overview 的 waiting 不含 error、running 不计 launch。
 */
export function agentIndexCounts(entries: readonly AgentRuntimeIndexEntry[]): {
  needsYou: number;
  running: number;
  ready: number;
} {
  let needsYou = 0;
  let running = 0;
  let ready = 0;
  for (const entry of entries) {
    if (isAgentIndexNeedsYou(entry.status)) {
      needsYou += 1;
    } else if (isAgentIndexRunning(entry.status)) {
      running += 1;
    } else {
      ready += 1;
    }
  }
  return { needsYou, ready, running };
}

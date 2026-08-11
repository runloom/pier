/**
 * W5-S1：协作视图纯 VM — 只投影 Runtime Index + FA + NCS 指针。
 * 不持有任务台账；不含 one-shot 回复内容。
 */
import {
  type AgentRuntimeIndexEntry,
  isAgentIndexNeedsYou,
} from "@shared/contracts/agent/runtime-index.ts";
import type { ForegroundActivity } from "@shared/contracts/foreground-activity.ts";
import type { AppNotification } from "@shared/contracts/notification-center.ts";

export type CollaborationStatusKey =
  | "agents.section.needsYou"
  | "agents.section.running"
  | "agents.section.readyHint"
  | "agents.collab.statusUnknown";

export interface CollaborationSessionVm {
  agentId: string;
  agentRef: string;
  cwd?: string;
  locationKey:
    | "agents.collab.locationThisWindow"
    | "agents.collab.locationWindow";
  locationParams?: { id: string };
  needsYou: boolean;
  panelId: string;
  projectRootPath?: string;
  statusKey: CollaborationStatusKey;
  title: string;
  windowId: string;
  worktreeKey?: string;
}

export interface CollaborationAttentionVm {
  agentRef?: string;
  nextKey: string;
  notificationId?: string;
  panelId?: string;
  reason?: string;
  titleKey: string;
}

export interface CollaborationFactVm {
  detail?: string;
  /** 可 i18n 的 detail 键（优先于 detail 字面量） */
  detailKey?: string;
  factKey: string;
  sourceKey: string;
}

export interface CollaborationViewModel {
  attention: CollaborationAttentionVm | null;
  contentBoundaryKey: string;
  empty: boolean;
  facts: CollaborationFactVm[];
  metaKey: string;
  metaParams: { agents: number; needsYou: number };
  selected: CollaborationSessionVm | null;
  sessions: CollaborationSessionVm[];
  titleKey: string;
}

function statusKeyFor(entry: AgentRuntimeIndexEntry): CollaborationStatusKey {
  if (entry.status && isAgentIndexNeedsYou(entry.status)) {
    return "agents.section.needsYou";
  }
  if (entry.status === "processing" || entry.status === "tool") {
    return "agents.section.running";
  }
  if (entry.status === "ready") {
    return "agents.section.readyHint";
  }
  return "agents.collab.statusUnknown";
}

function sessionTitle(entry: AgentRuntimeIndexEntry): string {
  const product = entry.sessionTitle?.trim();
  if (product) {
    return product;
  }
  return entry.agentId;
}

export function buildCollaborationSession(
  entry: AgentRuntimeIndexEntry,
  currentWindowId: string | null
): CollaborationSessionVm {
  const sameWindow =
    currentWindowId !== null && entry.windowId === currentWindowId;
  return {
    agentId: entry.agentId,
    agentRef: entry.agentRef,
    panelId: entry.panelId,
    windowId: entry.windowId,
    title: sessionTitle(entry),
    needsYou: Boolean(entry.status && isAgentIndexNeedsYou(entry.status)),
    statusKey: statusKeyFor(entry),
    ...(sameWindow
      ? { locationKey: "agents.collab.locationThisWindow" as const }
      : {
          locationKey: "agents.collab.locationWindow" as const,
          locationParams: { id: entry.windowId },
        }),
    ...(entry.worktreeKey ? { worktreeKey: entry.worktreeKey } : {}),
    ...(entry.cwd ? { cwd: entry.cwd } : {}),
    ...(entry.projectRootPath
      ? { projectRootPath: entry.projectRootPath }
      : {}),
  };
}

function pickAttention(
  sessions: CollaborationSessionVm[],
  notifications: readonly AppNotification[]
): CollaborationAttentionVm | null {
  const unreadAttention = notifications.find(
    (n) =>
      !n.read &&
      (n.kind === "agent.attention" || n.kind === "agent.runtime") &&
      Boolean(n.agentRef || n.panelRef?.panelId)
  );
  if (unreadAttention) {
    return {
      titleKey: "agents.collab.attentionTitle",
      nextKey: "agents.collab.attentionNext",
      ...(unreadAttention.body ? { reason: unreadAttention.body } : {}),
      ...(unreadAttention.id ? { notificationId: unreadAttention.id } : {}),
      ...(unreadAttention.agentRef
        ? { agentRef: unreadAttention.agentRef }
        : {}),
      ...(unreadAttention.panelRef?.panelId
        ? { panelId: unreadAttention.panelRef.panelId }
        : {}),
    };
  }
  const needs = sessions.find((s) => s.needsYou);
  if (needs) {
    return {
      titleKey: "agents.collab.attentionTitle",
      nextKey: "agents.collab.attentionNext",
      agentRef: needs.agentRef,
      panelId: needs.panelId,
    };
  }
  return null;
}

function activityKindDetailKey(kind: string): string | undefined {
  if (kind === "agent") {
    return "agents.collab.activityKindAgent";
  }
  if (kind === "task") {
    return "agents.collab.activityKindTask";
  }
  if (kind === "shell") {
    return "agents.collab.activityKindShell";
  }
  return;
}

function buildFacts(
  selected: CollaborationSessionVm | null,
  activities: readonly ForegroundActivity[]
): CollaborationFactVm[] {
  const facts: CollaborationFactVm[] = [];
  if (!selected) {
    return facts;
  }
  facts.push({
    factKey: "agents.collab.factRuntime",
    sourceKey: "agents.collab.sourceIndex",
    detail: selected.agentId,
  });
  const worktreeDetail =
    selected.worktreeKey ?? selected.projectRootPath ?? selected.cwd;
  if (worktreeDetail) {
    facts.push({
      factKey: "agents.collab.factWorktree",
      sourceKey: "agents.collab.sourceWorktree",
      detail: worktreeDetail,
    });
  }
  // panelId alone is window-scoped; always pair with windowId.
  const activity = activities.find(
    (a) =>
      a.panelId === selected.panelId &&
      a.windowId === selected.windowId &&
      a.kind !== "idle"
  );
  if (activity) {
    const detailKey = activityKindDetailKey(activity.kind);
    facts.push({
      factKey: "agents.collab.factActivity",
      sourceKey: "agents.collab.sourceFa",
      ...(detailKey ? { detailKey } : { detail: activity.kind }),
    });
  }
  if (selected.needsYou) {
    facts.push({
      factKey: "agents.collab.factNeedsYou",
      sourceKey: "agents.collab.sourceStatus",
    });
  }
  return facts;
}

function pickSelected(
  sessions: CollaborationSessionVm[],
  selectedAgentRef: string | null | undefined,
  attention: CollaborationAttentionVm | null
): CollaborationSessionVm | null {
  if (selectedAgentRef) {
    const explicit = sessions.find((s) => s.agentRef === selectedAgentRef);
    if (explicit) {
      return explicit;
    }
  }
  if (attention?.agentRef) {
    const byRef = sessions.find((s) => s.agentRef === attention.agentRef);
    if (byRef) {
      return byRef;
    }
  }
  if (attention?.panelId) {
    const byPanel = sessions.filter((s) => s.panelId === attention.panelId);
    // panelId alone is ambiguous across windows — only use unique match.
    if (byPanel.length === 1) {
      return byPanel[0] ?? null;
    }
  }
  return sessions.find((s) => s.needsYou) ?? sessions[0] ?? null;
}

export function buildCollaborationViewModel(input: {
  activities: readonly ForegroundActivity[];
  currentWindowId: string | null;
  entries: readonly AgentRuntimeIndexEntry[];
  notifications?: readonly AppNotification[];
  selectedAgentRef?: string | null;
}): CollaborationViewModel {
  const sessions = input.entries.map((entry) =>
    buildCollaborationSession(entry, input.currentWindowId)
  );
  const attention = pickAttention(sessions, input.notifications ?? []);
  const selected = pickSelected(sessions, input.selectedAgentRef, attention);
  const needsYou = sessions.filter((s) => s.needsYou).length;
  return {
    titleKey: "agents.collab.title",
    metaKey: "agents.collab.meta",
    metaParams: { agents: sessions.length, needsYou },
    contentBoundaryKey: "agents.collab.contentBoundary",
    empty: sessions.length === 0,
    sessions,
    selected,
    attention,
    facts: buildFacts(selected, input.activities),
  };
}

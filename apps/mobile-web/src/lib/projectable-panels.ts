/**
 * H2 可投影面板并集：终端族 / git 变更 / files 文档。
 * 无投影协议的 component（Canvas / 设置 / Web 等）不列。
 */
import { getAgentCatalogEntry } from "@shared/agent-catalog.ts";
import { agentKindSchema } from "@shared/contracts/agent.ts";
import type { ControlSnapshotPayload } from "@shared/contracts/local-control/control-snapshot.ts";
import { panelScopeKey } from "./panel-scope.ts";
import { pathLeaf } from "./worktree-scope.ts";

export const GIT_CHANGES_PANEL_COMPONENT = "pier.git.changes";
export const FILES_FILE_PANEL_COMPONENT = "pier.files.filePanel";

export type ProjectableGroup = "changes" | "docs" | "terminal";

export interface ProjectablePanelRow {
  activityStatus: string | null;
  agentId: string | null;
  cwd: string | null;
  group: ProjectableGroup;
  label: string;
  panelId: string;
  pendingInteractionId: string | null;
  sourcePath: string | null;
  sourceRoot: string | null;
  statusLabel: string;
  windowId: string;
  worktreeKey: string | null;
}

export interface ProjectableGroups {
  changes: ProjectablePanelRow[];
  docs: ProjectablePanelRow[];
  terminals: ProjectablePanelRow[];
}

export function isTerminalComponent(component: string | undefined): boolean {
  if (!component) {
    return false;
  }
  return component === "terminal" || component.startsWith("terminal-");
}

export function isGitChangesComponent(component: string | undefined): boolean {
  return component === GIT_CHANGES_PANEL_COMPONENT;
}

export function isFilesDocumentComponent(
  component: string | undefined
): boolean {
  return component === FILES_FILE_PANEL_COMPONENT;
}

function agentCatalogLabel(agentId: string): string | null {
  const parsed = agentKindSchema.safeParse(agentId);
  if (!parsed.success) {
    return null;
  }
  return getAgentCatalogEntry(parsed.data)?.label ?? null;
}

/**
 * 终端族行标题 = 桌面 tab short。快照 `title` 已是 display.short；
 * 缺席时按 tab 优先级降级：cwd 叶子 → catalog 标签。禁止用产品 id。
 */
export function terminalProjectionLabel(args: {
  agentId?: string | null;
  cwd: string | null;
  tabShort?: string | null;
}): string {
  const tabShort = args.tabShort?.trim();
  if (tabShort) {
    return tabShort;
  }
  if (args.cwd !== null && args.cwd.length > 0) {
    const leaf = pathLeaf(args.cwd);
    if (leaf.length > 0) {
      return leaf;
    }
  }
  const agentId = args.agentId?.trim();
  if (agentId) {
    return agentCatalogLabel(agentId) ?? "终端";
  }
  return "终端";
}

function scopePath(panel: {
  canonicalPath?: string | undefined;
  cwd?: string | undefined;
  worktreeKey?: string | undefined;
}): string | null {
  return panel.cwd ?? panel.canonicalPath ?? panel.worktreeKey ?? null;
}

/** 变更行作用域：gitRoot 是唯一 git 事实源，快照缺席时才退回路径链。 */
function changesScopePath(panel: {
  canonicalPath?: string | undefined;
  cwd?: string | undefined;
  gitRoot?: string | undefined;
  worktreeKey?: string | undefined;
}): string | null {
  return (
    panel.gitRoot ??
    panel.worktreeKey ??
    panel.cwd ??
    panel.canonicalPath ??
    null
  );
}

export function buildProjectableGroups(
  snapshot: ControlSnapshotPayload | null
): ProjectableGroups {
  const empty: ProjectableGroups = { changes: [], docs: [], terminals: [] };
  if (snapshot === null) {
    return empty;
  }
  const agentByPanel = new Map(
    snapshot.agents.map((agent) => [
      panelScopeKey(agent.windowId, agent.panelId),
      agent,
    ])
  );
  const activityByPanel = new Map(
    snapshot.activity.flatMap((entry) =>
      entry.panelId === undefined || entry.windowId === undefined
        ? []
        : [[panelScopeKey(entry.windowId, entry.panelId), entry] as const]
    )
  );
  const groups: ProjectableGroups = { changes: [], docs: [], terminals: [] };
  const seen = new Set<string>();

  for (const panel of snapshot.panels) {
    const scopeKey = panelScopeKey(panel.windowId, panel.panelId);
    seen.add(scopeKey);
    const agent = agentByPanel.get(scopeKey);
    const activity = activityByPanel.get(scopeKey);
    const cwd = panel.cwd ?? agent?.cwd ?? null;
    const worktreeKey = panel.worktreeKey ?? agent?.worktreeKey ?? null;
    if (isTerminalComponent(panel.component) || agent !== undefined) {
      groups.terminals.push({
        activityStatus: activity?.status ?? null,
        agentId: agent?.agentId ?? null,
        cwd,
        group: "terminal",
        label: terminalProjectionLabel({
          agentId: agent?.agentId ?? null,
          cwd,
          tabShort: panel.title,
        }),
        panelId: panel.panelId,
        windowId: panel.windowId,
        pendingInteractionId: activity?.pendingInteractionId ?? null,
        sourcePath: null,
        sourceRoot: null,
        statusLabel:
          agent === undefined ? "终端" : (activity?.status ?? "未知"),
        worktreeKey,
      });
      continue;
    }
    if (isGitChangesComponent(panel.component)) {
      const scope = changesScopePath(panel);
      groups.changes.push({
        activityStatus: null,
        agentId: null,
        cwd: scope,
        group: "changes",
        label: `变更 · ${scope === null ? "工作树" : pathLeaf(scope)}`,
        panelId: panel.panelId,
        windowId: panel.windowId,
        pendingInteractionId: null,
        sourcePath: null,
        sourceRoot: null,
        statusLabel: "变更",
        worktreeKey,
      });
      continue;
    }
    if (isFilesDocumentComponent(panel.component)) {
      groups.docs.push({
        activityStatus: null,
        agentId: null,
        cwd: panel.sourceRoot ?? scopePath(panel),
        group: "docs",
        label: panel.title ?? "文档",
        panelId: panel.panelId,
        windowId: panel.windowId,
        pendingInteractionId: null,
        sourcePath: panel.sourcePath ?? null,
        sourceRoot: panel.sourceRoot ?? null,
        statusLabel: "文档",
        worktreeKey,
      });
    }
  }

  // agents 表有行但 panels 尚未枚举到（短暂不同步）：仍列入终端组。
  for (const agent of snapshot.agents) {
    if (seen.has(panelScopeKey(agent.windowId, agent.panelId))) {
      continue;
    }
    const activity = activityByPanel.get(
      panelScopeKey(agent.windowId, agent.panelId)
    );
    groups.terminals.push({
      activityStatus: activity?.status ?? null,
      agentId: agent.agentId,
      cwd: agent.cwd ?? null,
      group: "terminal",
      label: terminalProjectionLabel({
        agentId: agent.agentId,
        cwd: agent.cwd ?? null,
      }),
      panelId: agent.panelId,
      windowId: agent.windowId,
      pendingInteractionId: activity?.pendingInteractionId ?? null,
      sourcePath: null,
      sourceRoot: null,
      statusLabel: activity?.status ?? "未知",
      worktreeKey: agent.worktreeKey ?? null,
    });
  }

  groups.terminals.sort((left, right) => {
    const leftWaiting = left.activityStatus === "waiting" ? 0 : 1;
    const rightWaiting = right.activityStatus === "waiting" ? 0 : 1;
    return leftWaiting - rightWaiting;
  });
  return groups;
}

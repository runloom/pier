/**
 * Human-readable labels for multi-window pickers (move/copy panel).
 * Prefer workspace basename + active tab title over bare "Window N".
 */

import type { WindowInfo } from "@shared/contracts/events.ts";
import type { PanelSnapshot } from "@shared/contracts/panel.ts";

export interface WindowDisplay {
  description?: string;
  detail?: string;
  id: string;
  label: string;
  recordId: string;
  searchTerms: readonly string[];
}

export interface WindowDisplayCopy {
  /** Fallback when nothing better is known (numbered). */
  emptyWindow: (index: number) => string;
  /** Secondary line when the window has no panels / no titles. */
  emptyWindowDescription: string;
  /** Disambiguate same labels: "pier" → "pier · 2". */
  sameNameIndex: (index: number) => string;
  /** e.g. "3 tabs" when no active title. */
  tabCount: (count: number) => string;
}

export function pathBasename(path: string): string {
  if (path === "" || path === "/" || path === "\\") {
    return path === "" ? "" : path;
  }
  const normalized = path.replaceAll("\\", "/");
  const trimmed = normalized.endsWith("/")
    ? normalized.slice(0, -1)
    : normalized;
  const idx = trimmed.lastIndexOf("/");
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

function pathParentBasename(path: string): string | null {
  const normalized = path.replaceAll("\\", "/");
  const trimmed = normalized.endsWith("/")
    ? normalized.slice(0, -1)
    : normalized;
  const idx = trimmed.lastIndexOf("/");
  if (idx <= 0) {
    return null;
  }
  return pathBasename(trimmed.slice(0, idx)) || null;
}

function panelsForWindow(
  panels: readonly PanelSnapshot[],
  windowId: string
): PanelSnapshot[] {
  return panels.filter((panel) => panel.windowId === windowId);
}

function pickActivePanel(
  windowPanels: readonly PanelSnapshot[]
): PanelSnapshot | null {
  if (windowPanels.length === 0) {
    return null;
  }
  return (
    windowPanels.find((panel) => panel.active === true) ??
    windowPanels[0] ??
    null
  );
}

function projectPathOf(panel: PanelSnapshot | null): string | undefined {
  const root = panel?.context?.projectRootPath?.trim();
  return root && root.length > 0 ? root : undefined;
}

function firstProjectPath(
  windowPanels: readonly PanelSnapshot[]
): string | undefined {
  for (const panel of windowPanels) {
    const root = projectPathOf(panel);
    if (root) {
      return root;
    }
  }
  return;
}

function activeTitleOf(panel: PanelSnapshot | null): string | undefined {
  if (!panel) {
    return;
  }
  const short = panel.display?.short?.trim();
  if (short) {
    return short;
  }
  const terminal = panel.display?.terminalTitle?.trim();
  if (terminal) {
    return terminal;
  }
  const long = panel.display?.long?.trim();
  return long || undefined;
}

interface Draft {
  baseLabel: string;
  description?: string;
  detail?: string;
  id: string;
  projectPath?: string;
  recordId: string;
  searchTerms: string[];
}

function buildDraft(
  window: WindowInfo,
  windowPanels: readonly PanelSnapshot[],
  index: number,
  copy: WindowDisplayCopy
): Draft {
  const active = pickActivePanel(windowPanels);
  const projectPath = projectPathOf(active) ?? firstProjectPath(windowPanels);
  const projectName = projectPath ? pathBasename(projectPath) : "";
  const title = activeTitleOf(active);
  const tabCount = windowPanels.length;

  let baseLabel: string;
  if (projectName.length > 0) {
    baseLabel = projectName;
  } else if (title) {
    baseLabel = title;
  } else {
    baseLabel = copy.emptyWindow(index + 1);
  }

  let description: string | undefined;
  if (projectName.length > 0 && title) {
    description = title;
  } else if (projectName.length > 0 && tabCount > 0) {
    description = copy.tabCount(tabCount);
  } else if (tabCount === 0) {
    description = copy.emptyWindowDescription;
  } else if (!title && tabCount > 1) {
    description = copy.tabCount(tabCount);
  }

  const searchTerms = [
    baseLabel,
    window.id,
    window.recordId,
    ...(projectPath ? [projectPath] : []),
    ...(title ? [title] : []),
    ...windowPanels
      .map((panel) => panel.display?.short)
      .filter((value): value is string => typeof value === "string"),
  ];

  return {
    baseLabel,
    id: window.id,
    recordId: window.recordId,
    searchTerms,
    ...(description ? { description } : {}),
    ...(projectPath ? { projectPath, detail: projectPath } : {}),
  };
}

/**
 * Disambiguate identical base labels among a draft list.
 * Prefer parent-folder basename when project paths differ; else " · 2".
 */
export function disambiguateWindowLabels(
  drafts: readonly Draft[],
  copy: WindowDisplayCopy
): WindowDisplay[] {
  const groups = new Map<string, number[]>();
  drafts.forEach((draft, index) => {
    const key = draft.baseLabel;
    const list = groups.get(key);
    if (list) {
      list.push(index);
    } else {
      groups.set(key, [index]);
    }
  });

  const labels = drafts.map((draft) => draft.baseLabel);

  for (const indices of groups.values()) {
    if (indices.length < 2) {
      continue;
    }
    const parents = indices.map((index) => {
      const path = drafts[index]?.projectPath;
      return path ? pathParentBasename(path) : null;
    });
    const uniqueParents = new Set(
      parents.filter(
        (value): value is string => value != null && value.length > 0
      )
    );
    if (uniqueParents.size === indices.length) {
      for (let i = 0; i < indices.length; i++) {
        const index = indices[i];
        const parent = parents[i];
        const draft = index === undefined ? undefined : drafts[index];
        if (index === undefined || !draft || !parent) {
          continue;
        }
        labels[index] = `${draft.baseLabel} · ${parent}`;
      }
      continue;
    }
    // Fall back to stable index among the group (1-based for the 2nd+).
    for (let i = 0; i < indices.length; i++) {
      const index = indices[i];
      const draft = index === undefined ? undefined : drafts[index];
      if (index === undefined || !draft) {
        continue;
      }
      if (i === 0) {
        labels[index] = draft.baseLabel;
      } else {
        labels[index] = `${draft.baseLabel}${copy.sameNameIndex(i + 1)}`;
      }
    }
  }

  return drafts.map((draft, index) => ({
    id: draft.id,
    label: labels[index] ?? draft.baseLabel,
    recordId: draft.recordId,
    searchTerms: [
      ...draft.searchTerms,
      ...(labels[index] && labels[index] !== draft.baseLabel
        ? [labels[index] as string]
        : []),
    ],
    ...(draft.description ? { description: draft.description } : {}),
    ...(draft.detail ? { detail: draft.detail } : {}),
  }));
}

/**
 * Build picker rows for windows, using panel snapshots for workspace + tab titles.
 * Caller should filter out the current window and sort as desired.
 */
export function buildWindowDisplays(
  windows: readonly WindowInfo[],
  panels: readonly PanelSnapshot[],
  copy: WindowDisplayCopy
): WindowDisplay[] {
  const drafts = windows.map((window, index) =>
    buildDraft(window, panelsForWindow(panels, window.id), index, copy)
  );
  return disambiguateWindowLabels(drafts, copy);
}

export function windowDisplayCopyFromI18n(
  t: (key: string, options?: Record<string, number | string>) => string
): WindowDisplayCopy {
  return {
    emptyWindow: (index) =>
      t("workspace.panelTransfer.windowLabel", { n: index }),
    emptyWindowDescription: t("workspace.panelTransfer.emptyWindowDescription"),
    sameNameIndex: (index) =>
      t("workspace.panelTransfer.sameNameIndex", { n: index }),
    tabCount: (count) => t("workspace.panelTransfer.tabCount", { count }),
  };
}

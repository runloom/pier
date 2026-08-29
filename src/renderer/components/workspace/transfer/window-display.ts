/**
 * Human-readable rows for multi-window pickers (move/copy panel).
 *
 * Slot contract matches QuickPickDefaultRow:
 * - label: workspace folder leaf (the scan key)
 * - description: short qualifier only — distinct branch, else distinct tab
 *   title, else empty-window copy. Never echo the leaf. Never a path.
 * - detail: identity path
 */

import type { WindowInfo } from "@shared/contracts/events.ts";
import type { PanelSnapshot } from "@shared/contracts/panel.ts";

export type WindowDisplayIconKind = "folder" | "git";

export interface WindowDisplay {
  description?: string;
  detail?: string;
  iconKind?: WindowDisplayIconKind;
  id: string;
  label: string;
  recordId: string;
  searchTerms: readonly string[];
}

export interface WindowDisplayCopy {
  /** Fallback when nothing better is known (numbered). */
  emptyWindow: (index: number) => string;
  /** Right-side qualifier when the window has no panels. */
  emptyWindowDescription: string;
  /** Disambiguate same labels: "pier" → "pier · 2". */
  sameNameIndex: (index: number) => string;
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

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function normalizeIdentity(value: string): string {
  return value
    .trim()
    .replaceAll("\\", "/")
    .replaceAll("/", "-")
    .replaceAll(/-+/g, "-")
    .toLowerCase();
}

/**
 * True when `candidate` can sit in the right column without echoing `identity`.
 * Slash vs dash (`feat/foo` vs `feat-foo`) counts as the same visual identity.
 * Last-segment path echoes are handled by `shortTitleQualifier`, not here —
 * a branch `feat/foo` must stay distinct from folder leaf `foo`.
 */
export function isDistinctQualifier(
  candidate: string,
  identity: string
): boolean {
  const trimmed = candidate.trim();
  const leaf = identity.trim();
  if (trimmed.length === 0 || leaf.length === 0) {
    return trimmed.length > 0;
  }
  return normalizeIdentity(trimmed) !== normalizeIdentity(leaf);
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

function identityPathOf(panel: PanelSnapshot | null): string | undefined {
  if (!panel?.context) {
    return;
  }
  return (
    nonEmpty(panel.context.worktreeRoot) ??
    nonEmpty(panel.context.projectRootPath) ??
    nonEmpty(panel.context.cwd)
  );
}

function branchOf(panel: PanelSnapshot | null): string | undefined {
  return nonEmpty(panel?.context?.branch);
}

function hasGitAnchor(panel: PanelSnapshot): boolean {
  return Boolean(
    nonEmpty(panel.context?.gitRoot) || nonEmpty(panel.context?.worktreeRoot)
  );
}

function firstFromPanels(
  windowPanels: readonly PanelSnapshot[],
  pick: (panel: PanelSnapshot) => string | undefined
): string | undefined {
  for (const panel of windowPanels) {
    const value = pick(panel);
    if (value) {
      return value;
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

/** Right-column tab title: basename if the title looks like a path. */
function shortTitleQualifier(
  title: string,
  identity: string
): string | undefined {
  const candidate =
    title.includes("/") || title.includes("\\")
      ? pathBasename(title)
      : title.trim();
  if (candidate.length === 0 || !isDistinctQualifier(candidate, identity)) {
    return;
  }
  return candidate;
}

interface Draft {
  baseLabel: string;
  description?: string;
  detail?: string;
  iconKind?: WindowDisplayIconKind;
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
  const identityPath =
    identityPathOf(active) ?? firstFromPanels(windowPanels, identityPathOf);
  const folderName = identityPath ? pathBasename(identityPath) : "";
  const title = activeTitleOf(active);
  const branch = branchOf(active) ?? firstFromPanels(windowPanels, branchOf);

  let baseLabel: string;
  if (folderName.length > 0) {
    baseLabel = folderName;
  } else if (title) {
    baseLabel = title;
  } else {
    baseLabel = copy.emptyWindow(index + 1);
  }

  let description: string | undefined;
  if (branch && isDistinctQualifier(branch, baseLabel)) {
    description = branch;
  } else if (title) {
    description = shortTitleQualifier(title, baseLabel);
  }
  if (!description && windowPanels.length === 0) {
    description = copy.emptyWindowDescription;
  }

  let iconKind: WindowDisplayIconKind | undefined;
  if (windowPanels.some((panel) => hasGitAnchor(panel))) {
    iconKind = "git";
  } else if (identityPath) {
    iconKind = "folder";
  }

  const searchTerms = [
    baseLabel,
    window.id,
    window.recordId,
    ...(identityPath ? [identityPath] : []),
    ...(branch ? [branch] : []),
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
    ...(iconKind ? { iconKind } : {}),
    ...(identityPath
      ? { projectPath: identityPath, detail: identityPath }
      : {}),
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

  return drafts.map((draft, index) => {
    const label = labels[index] ?? draft.baseLabel;
    const description =
      draft.description && isDistinctQualifier(draft.description, label)
        ? draft.description
        : undefined;
    const disambiguated = label === draft.baseLabel ? undefined : label;
    return {
      id: draft.id,
      label,
      recordId: draft.recordId,
      searchTerms: [
        ...draft.searchTerms,
        ...(disambiguated ? [disambiguated] : []),
      ],
      ...(description ? { description } : {}),
      ...(draft.detail ? { detail: draft.detail } : {}),
      ...(draft.iconKind ? { iconKind: draft.iconKind } : {}),
    };
  });
}

/**
 * Build picker rows for windows, using panel snapshots for workspace identity.
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
  };
}

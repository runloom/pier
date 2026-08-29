/**
 * Human-readable rows for multi-window pickers and single-line menus.
 *
 * Picker columns (label + description):
 * - label: workspace folder leaf (the scan key), disambiguated on collision
 * - description: short qualifier — distinct branch, else distinct tab title,
 *   else empty-window copy. Never echo the leaf. Never a path.
 * - detail: identity path
 *
 * Single-line menu (menuLabel): leaf only. A qualifier is appended only when
 * that leaf collides among the listed windows, cheapest first: branch, parent
 * folder, tab title, then " · N".
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
  /** Single-line label for native menus; qualifier only on identity collision. */
  menuLabel: string;
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
  branch?: string;
  description?: string;
  detail?: string;
  iconKind?: WindowDisplayIconKind;
  id: string;
  projectPath?: string;
  recordId: string;
  searchTerms: string[];
  tabQualifier?: string;
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
  const branchName =
    branchOf(active) ?? firstFromPanels(windowPanels, branchOf);

  let baseLabel: string;
  if (folderName.length > 0) {
    baseLabel = folderName;
  } else if (title) {
    baseLabel = title;
  } else {
    baseLabel = copy.emptyWindow(index + 1);
  }

  const branch =
    branchName && isDistinctQualifier(branchName, baseLabel)
      ? branchName
      : undefined;
  const tabQualifier = title
    ? shortTitleQualifier(title, baseLabel)
    : undefined;

  let description: string | undefined = branch ?? tabQualifier;
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
    ...(branchName ? [branchName] : []),
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
    ...(branch ? { branch } : {}),
    ...(tabQualifier ? { tabQualifier } : {}),
    ...(description ? { description } : {}),
    ...(iconKind ? { iconKind } : {}),
    ...(identityPath
      ? { projectPath: identityPath, detail: identityPath }
      : {}),
  };
}

function uniqueQualifiers(
  drafts: readonly Draft[],
  indices: readonly number[],
  pick: (draft: Draft) => string | undefined
): string[] | null {
  const values: string[] = [];
  for (const index of indices) {
    const draft = drafts[index];
    if (!draft) {
      return null;
    }
    const value = pick(draft)?.trim();
    if (!(value && isDistinctQualifier(value, draft.baseLabel))) {
      return null;
    }
    values.push(value);
  }
  if (new Set(values).size !== values.length) {
    return null;
  }
  return values;
}

function withQualifier(identity: string, qualifier: string): string {
  return `${identity} · ${qualifier}`;
}

/**
 * Single-line menu names: identity only, then the cheapest unique qualifier
 * among windows that share that identity.
 */
function computeMenuLabels(
  drafts: readonly Draft[],
  disambiguatedLabels: readonly string[]
): string[] {
  const groups = new Map<string, number[]>();
  drafts.forEach((draft, index) => {
    const list = groups.get(draft.baseLabel);
    if (list) {
      list.push(index);
    } else {
      groups.set(draft.baseLabel, [index]);
    }
  });

  const menuLabels = drafts.map((draft) => draft.baseLabel);
  for (const indices of groups.values()) {
    if (indices.length === 1) {
      continue;
    }
    const branches = uniqueQualifiers(drafts, indices, (draft) => draft.branch);
    if (branches) {
      indices.forEach((index, offset) => {
        const draft = drafts[index];
        const qualifier = branches[offset];
        if (draft && qualifier) {
          menuLabels[index] = withQualifier(draft.baseLabel, qualifier);
        }
      });
      continue;
    }
    const parents = uniqueQualifiers(drafts, indices, (draft) =>
      draft.projectPath
        ? (pathParentBasename(draft.projectPath) ?? undefined)
        : undefined
    );
    if (parents) {
      indices.forEach((index, offset) => {
        const draft = drafts[index];
        const qualifier = parents[offset];
        if (draft && qualifier) {
          menuLabels[index] = withQualifier(draft.baseLabel, qualifier);
        }
      });
      continue;
    }
    const tabs = uniqueQualifiers(
      drafts,
      indices,
      (draft) => draft.tabQualifier
    );
    if (tabs) {
      indices.forEach((index, offset) => {
        const draft = drafts[index];
        const qualifier = tabs[offset];
        if (draft && qualifier) {
          menuLabels[index] = withQualifier(draft.baseLabel, qualifier);
        }
      });
      continue;
    }
    for (const index of indices) {
      menuLabels[index] =
        disambiguatedLabels[index] ?? drafts[index]?.baseLabel ?? "";
    }
  }
  return menuLabels;
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

  const menuLabels = computeMenuLabels(drafts, labels);

  return drafts.map((draft, index) => {
    const label = labels[index] ?? draft.baseLabel;
    const menuLabel = menuLabels[index] ?? label;
    const description =
      draft.description && isDistinctQualifier(draft.description, label)
        ? draft.description
        : undefined;
    const disambiguated = label === draft.baseLabel ? undefined : label;
    return {
      id: draft.id,
      label,
      menuLabel,
      recordId: draft.recordId,
      searchTerms: [
        ...draft.searchTerms,
        ...(disambiguated ? [disambiguated] : []),
        ...(menuLabel === label ? [] : [menuLabel]),
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

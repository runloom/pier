/**
 * Human-readable window names for OS title, relocate menus, and Index.
 *
 * Single-line name (menuLabel): workspace leaf. A qualifier is appended only
 * when that leaf collides among ALL live windows, cheapest first: branch,
 * parent folder, stable tab name (file / user pin), then " · N".
 * OSC / cwd-derived tab titles are never a qualifier or a base label.
 */

import type { WindowInfo } from "../contracts/events.ts";
import type { PanelSnapshot } from "../contracts/panel.ts";
import type { WindowDisplayCopy } from "./copy.ts";
import {
  branchOf,
  hasGitAnchor,
  identityPathOf,
  isDistinctQualifier,
  nonEmpty,
  pathBasename,
  stableTabQualifierFromPanel,
} from "./identity.ts";
import { disambiguateWindowLabels } from "./labels.ts";
import type {
  WindowDisplay,
  WindowDisplayDraft,
  WindowIdentityDraft,
} from "./types.ts";

export type { WindowDisplayCopy } from "./copy.ts";
export {
  resolveWindowDisplayCopy,
  windowDisplayCopyForLocale,
  windowDisplayCopyFromI18n,
} from "./copy.ts";
export {
  isDistinctQualifier,
  pathBasename,
  stableTabQualifierFromPanel,
} from "./identity.ts";
export type {
  WindowDisplay,
  WindowDisplayIconKind,
  WindowIdentityDraft,
} from "./types.ts";

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

function buildDraft(
  window: WindowInfo,
  windowPanels: readonly PanelSnapshot[],
  index: number,
  copy: WindowDisplayCopy
): WindowDisplayDraft {
  const active = pickActivePanel(windowPanels);
  const identityPath =
    identityPathOf(active) ?? firstFromPanels(windowPanels, identityPathOf);
  const folderName = identityPath ? pathBasename(identityPath) : "";
  const branchName =
    branchOf(active) ?? firstFromPanels(windowPanels, branchOf);
  const stableTab = stableTabQualifierFromPanel(active, folderName);

  let baseLabel: string;
  if (folderName.length > 0) {
    baseLabel = folderName;
  } else if (stableTab) {
    baseLabel = stableTab;
  } else {
    baseLabel = copy.emptyWindow(index + 1);
  }

  const branch =
    branchName && isDistinctQualifier(branchName, baseLabel)
      ? branchName
      : undefined;
  const tabQualifier = stableTabQualifierFromPanel(active, baseLabel);

  let description: string | undefined = branch ?? tabQualifier;
  if (!description && windowPanels.length === 0) {
    description = copy.emptyWindowDescription;
  }

  let iconKind: WindowDisplay["iconKind"];
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
    ...(tabQualifier ? [tabQualifier] : []),
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

function identityDraftToInternal(
  draft: WindowIdentityDraft,
  index: number,
  copy: WindowDisplayCopy
): WindowDisplayDraft {
  const baseLabel = nonEmpty(draft.baseLabel) ?? copy.emptyWindow(index + 1);
  const branch =
    draft.branch && isDistinctQualifier(draft.branch, baseLabel)
      ? draft.branch
      : undefined;
  const tabQualifier =
    draft.stableTabQualifier &&
    isDistinctQualifier(draft.stableTabQualifier, baseLabel)
      ? draft.stableTabQualifier
      : undefined;
  const description = branch ?? tabQualifier;
  return {
    baseLabel,
    id: draft.id,
    recordId: draft.recordId,
    searchTerms: [
      baseLabel,
      draft.id,
      draft.recordId,
      ...(draft.projectPath ? [draft.projectPath] : []),
      ...(draft.branch ? [draft.branch] : []),
      ...(tabQualifier ? [tabQualifier] : []),
    ],
    ...(branch ? { branch } : {}),
    ...(tabQualifier ? { tabQualifier } : {}),
    ...(description ? { description } : {}),
    ...(draft.iconKind ? { iconKind: draft.iconKind } : {}),
    ...(draft.projectPath
      ? { projectPath: draft.projectPath, detail: draft.projectPath }
      : {}),
  };
}

export function buildWindowDisplaysFromDrafts(
  drafts: readonly WindowIdentityDraft[],
  copy: WindowDisplayCopy
): WindowDisplay[] {
  return disambiguateWindowLabels(
    drafts.map((draft, index) => identityDraftToInternal(draft, index, copy)),
    copy
  );
}

export function buildWindowIdentityDraft(
  window: WindowInfo,
  windowPanels: readonly PanelSnapshot[],
  index: number,
  copy: WindowDisplayCopy
): WindowIdentityDraft {
  const draft = buildDraft(window, windowPanels, index, copy);
  return {
    id: draft.id,
    recordId: draft.recordId,
    ...(draft.baseLabel ? { baseLabel: draft.baseLabel } : {}),
    ...(draft.branch ? { branch: draft.branch } : {}),
    ...(draft.iconKind ? { iconKind: draft.iconKind } : {}),
    ...(draft.projectPath ? { projectPath: draft.projectPath } : {}),
    ...(draft.tabQualifier ? { stableTabQualifier: draft.tabQualifier } : {}),
  };
}

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
